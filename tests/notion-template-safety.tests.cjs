const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const utilsSource = fs.readFileSync(path.join(root, 'tmpl_Utils.html'), 'utf8').replaceAll('{{EVENT_NAME}}', '測試活動');
const codeSource = fs.readFileSync(path.join(root, 'tmpl_Code.html'), 'utf8').replaceAll('{{EVENT_NAME}}', '測試活動');
const generatorSource = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
const uiSource = fs.readFileSync(path.join(root, 'ui.html'), 'utf8');
const feedbackSource = fs.readFileSync(path.join(root, 'feedback.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8'));
assert.equal(manifest.webapp.access, 'ANYONE_ANONYMOUS');
assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');

function htmlServiceEncodeLike(source) {
  return source.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function rawTplDecodeLike(source) {
  return source.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'").replaceAll('&amp;', '&');
}

const events = [];
let lockAvailable = true;
let pages = [];

const context = {
  console,
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Number,
  RegExp,
  isFinite,
  isNaN,
  CONFIG: {
    CLOSED: false,
    REGISTRATION_START: '',
    REGISTRATION_END: '',
    REG_STATUS: ['有效', '已取消'],
    REGISTRATION_MODE: 'single',
    QTY_ITEMS: [{ id: '供品', pricingMode: 'fixed', price: 100, minAmount: 0 }],
    CUSTOM_FIELDS: [],
    PAY_OPTIONS: ['現金', '匯款'],
    PAY_STATUS: ['未處理', '未繳款', '應收', '已繳款'],
    GROUP_FIELD: '',
    GROUP_OPTIONS: [],
    CAPACITY: { total: 1, items: { '供品': 1 } },
    REPORT_PASSWORD: 'test-password',
    LABELS: { PERSON: '報名人', CONTACT: '聯絡人', ITEMS: '報名項目', PAYMENT: '付款方式', NOTE: '備註', TOTAL: '總金額' }
  },
  NOTION_VERSION: '2022-06-28',
  notionToken_: () => 'test-token',
  notionDbId_: () => '0123456789abcdef0123456789abcdef',
  Utilities: { sleep: () => undefined },
  HtmlService: {},
  LockService: {
    getScriptLock: () => ({
      tryLock: () => {
        events.push('lock');
        return lockAvailable;
      },
      releaseLock: () => events.push('release')
    })
  }
};

vm.createContext(context);
vm.runInContext(utilsSource, context, { filename: 'Utils.gs' });
vm.runInContext(codeSource, context, { filename: 'Code.gs' });

context.notionQueryAll_ = () => {
  events.push('query');
  return { ok: true, pages };
};
context.notionApi_ = (method, apiPath) => {
  if (method === 'post' && apiPath === '/pages') events.push('write');
  return { ok: true, data: { id: 'new-page' } };
};

function payload(overrides = {}) {
  return Object.assign({
    '功德主': '王大德',
    '電話': '０９１２-３４５-６７８',
    '地址': '',
    '繳款方式': '現金',
    '個資同意': '__YES__',
    '備註': '',
    '供品': 1
  }, overrides);
}

assert.equal(context.normalizePhone_('+886 912-345-678'), '0912345678');
assert.equal(context.cleanPhone_('０９１２-３４５-６７８'), '0912345678');
assert.throws(() => context.cleanPhone_('123'), /8～15/);
assert.throws(() => context.safeInteger_(Infinity, '供品數量', 9999), /0～9999/);
assert.throws(() => context.safeInteger_(true, '供品數量', 9999), /0～9999/);
assert.throws(() => context.safeMoney_('1e309', '隨喜金額', true), /99999999/);
assert.throws(() => context.safeMoney_([100], '隨喜金額', true), /99999999/);
assert.throws(() => context.assertSafeTotal_(100000000), /總金額/);
assert.throws(() => context.cleanText_('甲'.repeat(61), '功德主', 60, true), /60 字/);
assert.throws(() => context.cleanText_({}, '功德主', 60, true), /格式不正確/);
assert.equal(context.cleanRemitDate_('8/12', true), '8/12');
assert.equal(context.cleanRemitDate_('2026-08-12', true), '2026-08-12');
assert.throws(() => context.cleanRemitDate_('2026-99-99', true), /不正確/);

events.length = 0;
pages = [];
lockAvailable = true;
const ok = context.submitApi(payload());
assert.equal(ok.ok, true);
assert.equal(ok.registrationId.startsWith('R-'), true);
assert.deepEqual(events, ['lock', 'query', 'write', 'release']);

events.length = 0;
pages = [{
  properties: {
    '功德主': { title: [{ plain_text: '既有資料' }] },
    '電話': { phone_number: '0900000000' },
    '供品': { number: 1 }
  }
}];
const full = context.submitApi(payload({ '功德主': '另一位', '電話': '0911111111' }));
assert.equal(full.ok, false);
assert.match(full.error, /名額/);
assert.deepEqual(events, ['lock', 'query', 'release']);

events.length = 0;
pages = [];
const invalidAmount = context.submitApi(payload({ '供品': '1e309' }));
assert.equal(invalidAmount.ok, false);
assert.match(invalidAmount.error, /0～9999/);
assert.deepEqual(events, []);

const invalidRemitDate = context.submitApi(payload({
  '繳款方式': '匯款',
  '匯款日期': '2026-99-99',
  '帳號後五碼': '01234',
  '匯款金額': 100
}));
assert.equal(invalidRemitDate.ok, false);
assert.match(invalidRemitDate.error, /匯款日期不正確/);
assert.deepEqual(events, []);

events.length = 0;
lockAvailable = false;
const busy = context.submitApi(payload());
assert.equal(busy.ok, false);
assert.match(busy.error, /同時報名人數較多/);
assert.deepEqual(events, ['lock']);

const currentId = '01234567-89ab-cdef-0123-456789abcdef';
const invalidAdminAmount = context.reportUpdateApi('test-password', currentId, { '供品': Infinity });
assert.equal(invalidAdminAmount.ok, false);
assert.match(invalidAdminAmount.error, /0～9999/);
const longAddress = context.reportUpdateApi('test-password', currentId, { '地址': '甲'.repeat(301) });
assert.equal(longAddress.ok, false);
assert.match(longAddress.error, /300 字/);
const incompleteTransfer = context.reportUpdateApi('test-password', currentId, { '繳款方式': '匯款' });
assert.equal(incompleteTransfer.ok, false);
assert.match(incompleteTransfer.error, /匯款日期/);
const clearedLastFive = context.reportUpdateApi('test-password', currentId, { '帳號後五碼': '' });
assert.equal(clearedLastFive.ok, false);
assert.match(clearedLastFive.error, /有效的付款方式/);
const blankPaymentWithLastFive = context.reportUpdateApi('test-password', currentId, { '繳款方式': '', '帳號後五碼': '12345' });
assert.equal(blankPaymentWithLastFive.ok, false);
assert.match(blankPaymentWithLastFive.error, /有效的付款方式/);

events.length = 0;
lockAvailable = true;
context.publicLookupApi = () => {
  events.push('lookup');
  return { ok: true, data: [{ pageId: currentId, '功德主': '王大德', '電話': '0912345678', '供品': 1 }] };
};
context.loadAllRows_ = () => {
  events.push('load');
  return { ok: true, data: [{ pageId: currentId, '功德主': '王大德', '電話': '0912345678', '供品': 1 }] };
};
context.reportUpdateApi = () => {
  events.push('patch');
  return { ok: true };
};
const updateOk = context.publicUpdateApi('R-TEST', '0912-345-678', {
  shared: { '地址': '' },
  people: [{ pageId: currentId, '功德主': '王大德', '供品': 1 }]
});
assert.equal(updateOk.ok, true);
assert.deepEqual(events, ['lock', 'lookup', 'load', 'patch', 'patch', 'release']);

events.length = 0;
const updateOverCapacity = context.publicUpdateApi('R-TEST', '0912345678', {
  shared: {},
  people: [{ pageId: currentId, '功德主': '王大德', '供品': 2 }]
});
assert.equal(updateOverCapacity.ok, false);
assert.match(updateOverCapacity.error, /剩餘數量不足/);
assert.deepEqual(events, ['lock', 'lookup', 'load', 'release']);

events.length = 0;
context.CONFIG.REGISTRATION_MODE = 'family';
context.CONFIG.CAPACITY.items['供品'] = 100;
const secondId = 'fedcba98-7654-3210-fedc-ba9876543210';
context.publicLookupApi = () => {
  events.push('lookup');
  return { ok: true, data: [
    { pageId: currentId, '功德主': '甲', '電話': '0912345678', '供品': 1 },
    { pageId: secondId, '功德主': '乙', '電話': '0912345678', '供品': 99 }
  ] };
};
context.loadAllRows_ = () => {
  events.push('load');
  return { ok: true, data: [] };
};
const duplicatePageId = context.publicUpdateApi('R-TEST', '0912345678', {
  shared: {},
  people: [
    { pageId: currentId, '功德主': '甲', '供品': 50 },
    { pageId: currentId, '功德主': '甲', '供品': 50 }
  ]
});
assert.equal(duplicatePageId.ok, false);
assert.match(duplicatePageId.error, /資料不一致/);
assert.deepEqual(events, ['lock', 'lookup', 'release']);

assert.match(generatorSource, /Utils\.gs'.*rawTpl_\('tmpl_Utils'\)/);
assert.doesNotMatch(utilsSource, /&(lt|gt);/);
assert.doesNotMatch(codeSource, /\b(async|await|Promise)\b/);
assert.equal(rawTplDecodeLike(htmlServiceEncodeLike(utilsSource)), utilsSource);

// 報名排程固定依台北時間（UTC+8）判斷，且手動 CLOSED 優先。
assert.equal(context.registrationTimeMs_('2026-08-10T09:30'), Date.UTC(2026, 7, 10, 1, 30));
assert.equal(context.registrationTimeMs_('2026-02-30T09:30'), null);
context.CONFIG.REGISTRATION_START = '2026-08-10T09:00';
context.CONFIG.REGISTRATION_END = '2026-08-10T17:00';
assert.equal(context.registrationState_(Date.UTC(2026, 7, 10, 0, 59)).code, 'upcoming');
assert.equal(context.registrationState_(Date.UTC(2026, 7, 10, 1, 0)).code, 'open');
assert.equal(context.registrationState_(Date.UTC(2026, 7, 10, 9, 0)).code, 'closed');
context.CONFIG.REGISTRATION_END = '2026-08-10T08:59';
assert.equal(context.registrationState_(Date.UTC(2026, 7, 10, 1, 0)).code, 'invalid_schedule');
context.CONFIG.REGISTRATION_END = '2026-08-10T17:00';
context.CONFIG.CLOSED = true;
assert.equal(context.registrationState_(Date.UTC(2026, 7, 10, 1, 0)).code, 'manual_closed');
context.CONFIG.CLOSED = false;

events.length = 0;
context.CONFIG.REGISTRATION_START = '2999-01-01T00:00';
context.CONFIG.REGISTRATION_END = '';
const scheduledOut = context.submitApi(payload());
assert.equal(scheduledOut.ok, false);
assert.match(scheduledOut.error, /尚未開放|已截止/);
assert.deepEqual(events, []);
context.CONFIG.REGISTRATION_START = '';
context.CONFIG.REGISTRATION_END = '';

// 已取消資料不占總名額、不占品項名額，也不觸發重複報名。
events.length = 0;
context.CONFIG.REGISTRATION_MODE = 'single';
context.CONFIG.CAPACITY.total = 1;
context.CONFIG.CAPACITY.items['供品'] = 1;
pages = [{
  properties: {
    '功德主': { title: [{ plain_text: '王大德' }] },
    '電話': { phone_number: '0912345678' },
    '供品': { number: 1 },
    '報名狀態': { select: { name: '已取消' } }
  }
}];
const reuseCancelledSlot = context.submitApi(payload());
assert.equal(reuseCancelledSlot.ok, true);
assert.deepEqual(events, ['lock', 'query', 'write', 'release']);

context.loadAllRows_ = () => ({ ok: true, data: [
  { pageId: currentId, '供品': 1, '報名狀態': '有效' },
  { pageId: secondId, '供品': 99, '報名狀態': '已取消' }
] });
context.CONFIG.CAPACITY.total = 2;
context.CONFIG.CAPACITY.items['供品'] = 2;
const remaining = context.capacityLoadApi();
assert.equal(remaining.totalRemaining, 1);
assert.equal(remaining.itemRemaining['供品'], 1);

// 取消整筆家庭報名時，鎖內 PATCH 全部資料；再次取消為冪等成功。
events.length = 0;
context.publicLookupApi = () => {
  events.push('lookup');
  return { ok: true, data: [
    { pageId: currentId, '報名狀態': '有效' },
    { pageId: secondId, '報名狀態': '有效' }
  ] };
};
context.notionApi_ = (method, apiPath, body) => {
  if (method === 'patch') {
    events.push('cancel-patch');
    assert.equal(body.properties['報名狀態'].select.name, '已取消');
    assert.ok(body.properties['取消時間'].date.start);
  }
  return { ok: true, data: { id: apiPath } };
};
const cancelled = context.publicCancelApi('R-TEST', '0912345678');
assert.equal(cancelled.ok, true);
assert.equal(cancelled.count, 2);
assert.deepEqual(events, ['lock', 'lookup', 'cancel-patch', 'cancel-patch', 'release']);

events.length = 0;
context.publicLookupApi = () => {
  events.push('lookup');
  return { ok: true, data: [{ pageId: currentId, '報名狀態': '已取消' }] };
};
const cancelledAgain = context.publicCancelApi('R-TEST', '0912345678');
assert.equal(cancelledAgain.ok, true);
assert.equal(cancelledAgain.alreadyCancelled, true);
assert.deepEqual(events, ['lock', 'lookup', 'release']);

events.length = 0;
context.publicLookupApi = () => {
  events.push('lookup');
  return { ok: true, data: [
    { pageId: currentId, '報名狀態': '已取消' },
    { pageId: secondId, '報名狀態': '有效' }
  ] };
};
const completedPartialCancel = context.publicCancelApi('R-TEST', '0912345678');
assert.equal(completedPartialCancel.ok, true);
assert.equal(completedPartialCancel.count, 1);
assert.deepEqual(events, ['lock', 'lookup', 'cancel-patch', 'release']);

events.length = 0;
context.notionApi_ = (method) => {
  if (method === 'patch') events.push('cancel-patch-failed');
  return { ok: false, error: 'forced' };
};
const failedPartialRetry = context.publicCancelApi('R-TEST', '0912345678');
assert.equal(failedPartialRetry.ok, false);
assert.equal(failedPartialRetry.partial, true);
assert.equal(failedPartialRetry.count, 0);
assert.deepEqual(events, ['lock', 'lookup', 'cancel-patch-failed', 'release']);

events.length = 0;
context.publicLookupApi = () => {
  events.push('lookup');
  return { ok: true, data: [{ pageId: currentId, '報名狀態': '已取消' }] };
};
const updateCancelled = context.publicUpdateApi('R-TEST', '0912345678', { people: [] });
assert.equal(updateCancelled.ok, false);
assert.match(updateCancelled.error, /已取消/);
assert.deepEqual(events, ['lock', 'lookup', 'release']);

assert.match(generatorSource, /'報名狀態': \{ select: \{ options: GEN\.REG_STATUS/);
assert.match(generatorSource, /REGISTRATION_START_JS/);
assert.match(fs.readFileSync(path.join(root, 'tmpl_report.html'), 'utf8'), /ROWS\.filter\(isActive\)/);
new vm.Script(generatorSource, { filename: 'generator-Code.gs' });
const uiScripts = [...uiSource.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
assert.ok(uiScripts.length > 0, 'ui.html should contain an inline script');
const uiIds = [...uiSource.matchAll(/\sid=["']([^"']+)["']/g)].map((match) => match[1]);
assert.equal(new Set(uiIds).size, uiIds.length, 'ui.html should not contain duplicate ids');
['flowConfig','flowNotion','flowDb','flowZip','progressText','progressFill','nextAction'].forEach((id) => {
  assert.ok(uiIds.includes(id), 'ui.html missing workflow control: ' + id);
});
['notionApiGuide','notionGuideChecklist'].forEach((id) => {
  assert.ok(uiIds.includes(id), 'ui.html missing Notion API tutorial control: ' + id);
});
['btnCheckNotion','notionCheckStatus'].forEach((id) => {
  assert.ok(uiIds.includes(id), 'ui.html missing Notion connection check control: ' + id);
});
assert.match(generatorSource, /function checkNotionConnectionApi\(p\)/);
assert.match(uiSource, /\.checkNotionConnectionApi\(/);
assert.match(generatorSource, /function submitFeedbackApi\(p\)/);
assert.match(generatorSource, /FEEDBACK_DB_ID: '3a48db83bd93805eb572c02b1c9da2c2'/);
assert.match(generatorSource, /PUBLIC_MODE: true/);
assert.match(generatorSource, /String\(p\.token \|\| savedNotion\.token \|\| ''\)/);
assert.match(uiSource, /function submitSuggest\(\)/);
assert.match(uiSource, /\.submitFeedbackApi\(/);
assert.match(feedbackSource, /\.submitFeedbackApi\(/);
assert.match(uiSource, /REG_FORM_PUBLIC_PRESETS_V1/);
assert.match(uiSource, /localStorage\.setItem\(LOCAL_PRESET_KEY/);
assert.match(uiSource, /p\.token = val\('token'\)/);
assert.match(uiSource, /公開版不會儲存 Token/);
assert.match(uiSource, /公開使用・免登入 Google/);
assert.match(uiSource, /https:\/\/www\.notion\.so\/profile\/integrations\/internal/);
assert.match(uiSource, /https:\/\/developers\.notion\.com\/guides\/get-started\/internal-connections/);
assert.match(uiSource, /新連線預設沒有任何頁面權限/);
assert.match(uiSource, /class="table-scroll"[^>]*role="region"/);
assert.match(uiSource, /function updateWorkspaceState\(\)/);
assert.match(uiSource, /function applyTerminologyPreset\(\)/);
assert.match(uiSource, /function usageLogWarning\(r\)/);
assert.match(uiSource, /使用紀錄未寫入/);
assert.doesNotMatch(generatorSource, /功德系統/);
assert.doesNotMatch(uiSource, /功德系統/);
assert.match(uiSource, /id="btnApplyTerminology"/);
assert.match(uiSource, /input\[type=datetime-local\]/);
const uiDeleteHandlers = [...uiSource.matchAll(/tr\.querySelector\('\.del'\)\.onclick = function\(\)\{([^}]*)\};/g)];
assert.equal(uiDeleteHandlers.length, 2, 'both dynamic row types should have a delete handler');
uiDeleteHandlers.forEach((match) => assert.match(match[1], /updateWorkspaceState\(\)/));
assert.match(uiSource, /setAttribute\('aria-current','step'\)/);
assert.match(uiSource, /class="i-name" aria-label="品項名稱"/);
assert.match(uiSource, /class="c-name" aria-label="自訂欄位名稱"/);
uiScripts.forEach((match, index) => {
  const js = match[1].replace(/<\?!=[\s\S]*?\?>/g, '[]').trim();
  if (js) new vm.Script(js, { filename: 'ui.html#script-' + index });
});
const feedbackIds = [...feedbackSource.matchAll(/\sid=["']([^"']+)["']/g)].map((match) => match[1]);
assert.equal(new Set(feedbackIds).size, feedbackIds.length, 'feedback.html should not contain duplicate ids');
const feedbackScripts = [...feedbackSource.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
feedbackScripts.forEach((match, index) => {
  const js = match[1].replace(/<\?!=[\s\S]*?\?>/g, "''").trim();
  if (js) new vm.Script(js, { filename: 'feedback.html#script-' + index });
});

const generatorContext = {
  console, Date, Math, JSON, Object, Array, String, Number, RegExp, isFinite, parseInt,
  HtmlService: {
    createHtmlOutputFromFile(name) {
      return { getContent: () => fs.readFileSync(path.join(root, name + '.html'), 'utf8') };
    }
  }
};
vm.createContext(generatorContext);
vm.runInContext(generatorSource, generatorContext, { filename: 'generator-Code.gs' });
const servedTemplates = [];
generatorContext.ScriptApp = { getService: () => ({ getUrl: () => 'https://example.test/generator' }) };
generatorContext.HtmlService.createTemplateFromFile = (name) => {
  servedTemplates.push(name);
  return {
    APP_URL: '',
    evaluate() {
      return {
        title: '', metaTags: [],
        setTitle(value) { this.title = value; return this; },
        addMetaTag(name, value) { this.metaTags.push([name, value]); return this; }
      };
    }
  };
};
const generatorPage = generatorContext.doGet({ parameter: {} });
const feedbackPage = generatorContext.doGet({ parameter: { page: 'feedback' } });
assert.deepEqual(servedTemplates, ['ui', 'feedback']);
assert.equal(generatorPage.title, '通用活動報名表產生器');
assert.equal(feedbackPage.title, '意見回饋｜通用活動報名表產生器');
const legacyPaymentCfg = generatorContext.normalizeCfg_({ paymentOptions: ['現金', '功德系統', '匯款'] });
assert.deepEqual(Array.from(legacyPaymentCfg.payOptions), ['現金', '匯款']);

const notionCheckResponses = [];
const notionCheckCalls = [];
const notionSettingStore = {};
const scriptPropertyStore = {};
generatorContext.PropertiesService = { getUserProperties: () => ({
  getProperty: (key) => notionSettingStore[key] || '',
  setProperty: (key, value) => { notionSettingStore[key] = String(value); },
  deleteProperty: (key) => { delete notionSettingStore[key]; },
  getProperties: () => Object.assign({}, notionSettingStore)
}), getScriptProperties: () => ({
  getProperty: (key) => scriptPropertyStore[key] || '',
  setProperty: (key, value) => { scriptPropertyStore[key] = String(value); },
  getProperties: () => Object.assign({}, scriptPropertyStore)
}) };
generatorContext.Session = { getActiveUser: () => ({ getEmail: () => 'operator@example.com' }) };
generatorContext.Utilities = { formatDate: () => '2026-09-20 12:34:56' };
generatorContext.UrlFetchApp = { fetch: (url, options) => {
  notionCheckCalls.push({ url, options });
  const next = notionCheckResponses.shift();
  assert.ok(next, 'unexpected Notion check request: ' + url);
  return { getResponseCode: () => next.code, getContentText: () => JSON.stringify(next.data || {}) };
} };
function queueNotionCheck(...responses) { notionCheckResponses.push(...responses); }

notionSettingStore.REG_FORM_NOTION_TOKEN = 'owner-token-must-not-be-used';
notionSettingStore.REG_FORM_NOTION_PARENT = JSON.stringify({ parentMode: 'page', parentTargetId: 'dddddddddddddddddddddddddddddddd' });
const publicSettings = generatorContext.loadNotionSettingsApi();
assert.equal(publicSettings.ok, true);
assert.equal(publicSettings.publicMode, true);
assert.equal(publicSettings.hasToken, false);
assert.equal(publicSettings.parentTargetId, '');
assert.equal(generatorContext.saveNotionSettingsApi({ token: 'visitor-token', parentMode: 'page', parentTargetId: 'dddddddddddddddddddddddddddddddd' }).ok, false);
assert.equal(generatorContext.listPresetsApi().publicMode, true);
const publicNoTokenCreate = generatorContext.createDbCore_({
  parentMode: 'page', parentTargetId: 'dddddddddddddddddddddddddddddddd',
  orgName: '公開測試', event: 'public-test', eventName: '公開測試', reportPassword: 'password123',
  registrationMode: 'single', paymentOptions: ['現金'], items: [{ name: '品項', pricingMode: 'fixed', price: 100 }]
});
assert.equal(publicNoTokenCreate.ok, false);
assert.match(publicNoTokenCreate.error, /缺 Notion API token/);

const notionTargetId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
queueNotionCheck(
  { code: 200, data: { object: 'user', name: '通用報名表產生器' } },
  { code: 200, data: { object: 'database', title: [{ plain_text: '活動總表' }], properties: { 活動名稱: { type: 'title', title: {} } } } }
);
const notionCheckOk = generatorContext.checkNotionConnectionApi({ token: 'ntn_test', parentMode: 'activity_database', parentTargetId: notionTargetId });
assert.equal(notionCheckOk.ok, true);
assert.equal(notionCheckOk.targetId, notionTargetId);
assert.equal(notionCheckOk.integrationName, '通用報名表產生器');
assert.match(notionCheckOk.checks.join('\n'), /活動總表/);
assert.match(notionCheckOk.note, /無寫入/);
assert.deepEqual(notionCheckCalls.slice(-2).map((call) => call.options.method), ['get', 'get']);

queueNotionCheck({ code: 401, data: { message: 'API token is invalid.' } });
const notionCheck401 = generatorContext.checkNotionConnectionApi({ token: 'bad', parentMode: 'activity_database', parentTargetId: notionTargetId });
assert.equal(notionCheck401.ok, false);
assert.match(notionCheck401.error, /Token 無效/);

queueNotionCheck(
  { code: 200, data: { object: 'user', name: '通用報名表產生器' } },
  { code: 404, data: { message: 'not found' } },
  { code: 200, data: { object: 'page', properties: { 標題: { type: 'title', title: [{ plain_text: '一般頁面' }] } } } }
);
const notionWrongMode = generatorContext.checkNotionConnectionApi({ token: 'ntn_test', parentMode: 'activity_database', parentTargetId: notionTargetId });
assert.equal(notionWrongMode.ok, false);
assert.match(notionWrongMode.error, /一般頁面/);

queueNotionCheck(
  { code: 200, data: { object: 'user', name: '通用報名表產生器' } },
  { code: 404, data: { message: 'not found' } },
  { code: 404, data: { message: 'not found' } }
);
const notionCheck404 = generatorContext.checkNotionConnectionApi({ token: 'ntn_test', parentMode: 'activity_database', parentTargetId: notionTargetId });
assert.equal(notionCheck404.ok, false);
assert.match(notionCheck404.error, /分享給這個 Integration/);

queueNotionCheck(
  { code: 200, data: { object: 'user', name: '通用報名表產生器' } },
  { code: 200, data: { object: 'page', archived: false, properties: { 標題: { type: 'title', title: [{ plain_text: '活動父頁' }] } } } }
);
const notionPageCheck = generatorContext.checkNotionConnectionApi({ token: 'ntn_test', parentMode: 'page', parentTargetId: notionTargetId });
assert.equal(notionPageCheck.ok, true);
assert.match(notionPageCheck.checks.join('\n'), /活動父頁/);
assert.match(notionPageCheck.checks.join('\n'), /新增權限會在建表時確認/);

queueNotionCheck(
  { code: 200, data: { object: 'user', name: '通用報名表產生器' } },
  { code: 200, data: { object: 'database', properties: {
    活動名稱: { type: 'title', title: {} }, '報名資料庫 ID': { type: 'number', number: {} }
  } } }
);
const notionWrongField = generatorContext.checkNotionConnectionApi({ token: 'ntn_test', parentMode: 'activity_database', parentTargetId: notionTargetId });
assert.equal(notionWrongField.ok, false);
assert.match(notionWrongField.error, /rich_text/);

const createDbPayload = {
  token: 'ntn_test', parentMode: 'page', parentTargetId: notionTargetId,
  orgName: '測試主辦', event: 'create-db-test', eventName: '建表測試', reportPassword: 'password123',
  registrationMode: 'family', paymentOptions: ['現金', '匯款'],
  bankBank: '測試銀行', bankAcct: '0000012345', bankName: '測試戶名',
  hasGroup: true, groupField: '所屬單位', groupOptions: ['甲單位', '乙單位'],
  items: [
    { name: '固定品項', pricingMode: 'fixed', price: 300 },
    { name: '隨喜品項', pricingMode: 'donation' }
  ],
  customFields: [{ name: '梯次', type: 'select', options: ['上午', '下午'] }]
};
queueNotionCheck({ code: 200, data: { id: 'registration-db-direct', url: 'https://notion.test/direct' } });
const directCreate = generatorContext.createDbCore_(createDbPayload);
assert.equal(directCreate.ok, true);
assert.equal(directCreate.dbId, 'registration-db-direct');
const directCreateCall = notionCheckCalls.at(-1);
assert.equal(directCreateCall.options.method, 'post');
assert.match(directCreateCall.url, /\/databases$/);
const directCreateBody = JSON.parse(directCreateCall.options.payload);
assert.equal(directCreateBody.parent.page_id, notionTargetId);
assert.ok(directCreateBody.properties['帳號後五碼'].rich_text);
assert.ok(directCreateBody.properties['聯絡人'].rich_text);
assert.ok(directCreateBody.properties['固定品項'].number);
assert.ok(directCreateBody.properties['梯次'].select);
assert.equal(Object.hasOwn(directCreateBody.properties, '功德系統'), false);

const activityDbId = 'cccccccccccccccccccccccccccccccc';
queueNotionCheck(
  { code: 200, data: { id: activityDbId, properties: { 活動名稱: { type: 'title', title: {} } } } },
  { code: 200, data: { id: activityDbId } },
  { code: 200, data: { id: 'activity-page-created', url: 'https://notion.test/activity' } },
  { code: 200, data: { id: 'registration-db-child', url: 'https://notion.test/child' } },
  { code: 200, data: { id: 'activity-page-created' } }
);
const activityCreate = generatorContext.createDbCore_(Object.assign({}, createDbPayload, {
  parentMode: 'activity_database', parentTargetId: activityDbId
}));
assert.equal(activityCreate.ok, true);
assert.equal(activityCreate.dbId, 'registration-db-child');
assert.equal(activityCreate.activityPageId, 'activity-page-created');
const activityCalls = notionCheckCalls.slice(-5);
assert.deepEqual(activityCalls.map((call) => call.options.method), ['get', 'patch', 'post', 'post', 'patch']);
assert.ok(JSON.parse(activityCalls[1].options.payload).properties['報名資料庫 ID'].rich_text);
assert.equal(JSON.parse(activityCalls[2].options.payload).parent.database_id, activityDbId);
assert.equal(JSON.parse(activityCalls[3].options.payload).parent.page_id, 'activity-page-created');
assert.equal(JSON.parse(activityCalls[4].options.payload).properties['報名資料庫 ID'].rich_text[0].text.content, 'registration-db-child');
assert.equal(notionCheckResponses.length, 0);

const usageDbId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
scriptPropertyStore.REG_FORM_USAGE_LOG_NOTION_TOKEN = 'ntn_usage_secret';
scriptPropertyStore.REG_FORM_USAGE_LOG_DATABASE_ID = usageDbId;
queueNotionCheck({ code: 200, data: { id: 'usage-page-success' } });
const usageSuccess = generatorContext.logGeneratorUsage_('建立資料庫', { ok: true }, {
  orgName: '測試主辦', eventName: '測試活動', event: 'test-event', token: 'must-not-leak', reportPassword: 'must-not-leak'
});
assert.equal(usageSuccess.ok, true);
const usageSuccessCall = notionCheckCalls.at(-1);
assert.equal(usageSuccessCall.url, 'https://api.notion.com/v1/pages');
const usageSuccessBody = JSON.parse(usageSuccessCall.options.payload);
assert.equal(usageSuccessBody.parent.database_id, usageDbId);
assert.equal(usageSuccessBody.properties['執行動作'].select.name, '建立資料庫');
assert.equal(usageSuccessBody.properties['執行結果'].select.name, '成功');
assert.equal(usageSuccessBody.properties['使用者 Email'].email, 'operator@example.com');
assert.equal(usageSuccessBody.properties['活動名稱'].rich_text[0].text.content, '測試活動');
assert.doesNotMatch(usageSuccessCall.options.payload, /must-not-leak|ntn_usage_secret/);

queueNotionCheck({ code: 200, data: { id: 'usage-page-failure' } });
const usageFailure = generatorContext.logGeneratorUsage_('產出專案', { ok: false, error: '產出失敗' }, {
  orgName: '測試主辦', eventName: '測試活動', event: 'test-event'
});
assert.equal(usageFailure.ok, true);
const usageFailureBody = JSON.parse(notionCheckCalls.at(-1).options.payload);
assert.equal(usageFailureBody.properties['執行結果'].select.name, '失敗');
assert.equal(usageFailureBody.properties['錯誤摘要'].rich_text[0].text.content, '產出失敗');

queueNotionCheck({ code: 500, data: { message: 'temporary failure' } });
const primaryResult = generatorContext.attachUsageLog_({ ok: true, value: 1 }, '產出專案', { eventName: '測試活動' });
assert.equal(primaryResult.ok, true, 'usage log failure must not change the primary operation result');
assert.match(primaryResult.usageLogWarning, /Notion API 500/);

queueNotionCheck({ code: 200, data: { id: usageDbId, title: [{ plain_text: '報名表產生器使用紀錄' }] } });
assert.equal(generatorContext.checkUsageLog(), 'Notion2 使用紀錄資料庫連線正常');

const feedbackDbId = '3a48db83bd93805eb572c02b1c9da2c2';
queueNotionCheck(
  { code: 200, data: { id: feedbackDbId, properties: { 名稱: { type: 'title', title: {} } } } },
  { code: 200, data: { id: feedbackDbId } }
);
const feedbackSetup = generatorContext.setupFeedbackDatabase();
assert.match(feedbackSetup, /欄位設定完成/);
const feedbackSetupPatch = JSON.parse(notionCheckCalls.at(-1).options.payload);
assert.ok(feedbackSetupPatch.properties['回饋類型'].select);
assert.ok(feedbackSetupPatch.properties['意見內容'].rich_text);

queueNotionCheck(
  { code: 200, data: { id: feedbackDbId, properties: { 名稱: { type: 'title', title: {} } } } },
  { code: 200, data: { id: feedbackDbId } },
  { code: 200, data: { id: 'feedback-page-success' } }
);
const feedbackResult = generatorContext.submitFeedbackApi({
  type: '功能建議', subject: '希望更好操作', relatedFeature: '活動設定',
  content: '請增加快速套用功能。', contactEmail: 'owner@example.com'
});
assert.equal(feedbackResult.ok, true);
assert.equal(feedbackResult.pageId, 'feedback-page-success');
const feedbackCalls = notionCheckCalls.slice(-3);
assert.deepEqual(feedbackCalls.map((call) => call.options.method), ['get', 'patch', 'post']);
const feedbackPatch = JSON.parse(feedbackCalls[1].options.payload);
assert.ok(feedbackPatch.properties['意見內容'].rich_text);
const feedbackBody = JSON.parse(feedbackCalls[2].options.payload);
assert.equal(feedbackBody.parent.database_id, feedbackDbId);
assert.equal(feedbackBody.properties['回饋類型'].select.name, '功能建議');
assert.equal(feedbackBody.properties['意見內容'].rich_text[0].text.content, '請增加快速套用功能。');
assert.equal(feedbackBody.properties['提交者 Email'].email, 'operator@example.com');
assert.equal(feedbackBody.properties['處理狀態'].select.name, '待處理');
assert.equal(generatorContext.submitFeedbackApi({ type: '錯誤回報', content: '' }).ok, false);
assert.equal(generatorContext.submitFeedbackApi({ type: '其他', content: '測試', contactEmail: 'bad-email' }).ok, false);
assert.equal(notionCheckResponses.length, 0);

assert.equal(generatorContext.fill_('A {{KNOWN}} Z', { KNOWN: '{{VIP}}' }), 'A {{VIP}} Z');
assert.throws(() => generatorContext.fill_('A {{MISSING}} Z', {}), /模板缺少替換值：MISSING/);
const generatedCfg = generatorContext.normalizeCfg_({
  orgName: '測試宮', event: 'schedule-test', eventName: '測試活動', reportPassword: 'password123',
  themePrimary: '#176B5B', themeGold: '#B38A3E', themeBg: '#F1F6F2', cardRadius: 20,
  headerLayout: 'poster', fontSize: 21, cardShadow: 'strong', submitLabel: '立即完成登記',
  labels: { person: '學員', contact: '課程聯絡人', items: '課程方案', payment: '付款方式', note: '學習需求', total: '應付金額' },
  registrationStart: '2026-08-10T09:00', registrationEnd: '2026-08-10T17:00',
  registrationMode: 'single', paymentOptions: ['現金'], items: [{ name: '供品', pricingMode: 'fixed', price: 100 }],
  dbId: '0123456789abcdef0123456789abcdef'
});
assert.equal(generatorContext.validateCfg_(generatedCfg, true), '');
assert.equal(generatedCfg.THEME_BG, '#F1F6F2');
assert.equal(generatedCfg.CARD_RADIUS, 20);
assert.deepEqual(JSON.parse(JSON.stringify(generatedCfg.UI)), {
  HEADER_LAYOUT: 'poster', FONT_SIZE: 21, CARD_SHADOW: 'strong', SUBMIT_LABEL: '立即完成登記'
});
assert.equal(generatorContext.normalizeCfg_({ fontSize: 8 }).UI.FONT_SIZE, 14);
assert.equal(generatorContext.normalizeCfg_({ fontSize: 99 }).UI.FONT_SIZE, 22);
assert.equal(generatorContext.normalizeCfg_({ fontScale: 'large' }).UI.FONT_SIZE, 18, 'legacy large preset should migrate to 18px');
assert.deepEqual(JSON.parse(JSON.stringify(generatedCfg.LABELS)), {
  PERSON: '學員', CONTACT: '課程聯絡人', ITEMS: '課程方案', PAYMENT: '付款方式', NOTE: '學習需求', TOTAL: '應付金額'
});
assert.match(generatorContext.validateCfg_(Object.assign({}, generatedCfg, { REGISTRATION_END: '2026-08-10T08:59' }), true), /晚於/);
const schema = generatorContext.buildDbProperties_(generatedCfg);
assert.ok(schema['報名狀態'].select);
assert.ok(schema['取消時間'].date);
assert.equal(JSON.parse(generatorContext.schemaKey_(generatedCfg)).schemaVersion, 3);
const generatedFiles = generatorContext.buildFiles_(Object.assign({}, generatedCfg, { NOTION_TOKEN: 'secret' }));
const courseFamilyCfg = generatorContext.normalizeCfg_({
  orgName: '測試主辦單位', event: 'course-family', eventName: '測試課程', reportPassword: 'password123',
  labels: { person: '學員', contact: '課程聯絡人', items: '課程方案', payment: '付款方式', note: '學習需求', total: '應付金額' },
  registrationMode: 'family', paymentOptions: ['現金'], items: [{ name: '課程方案 A', pricingMode: 'fixed', price: 100 }],
  dbId: '0123456789abcdef0123456789abcdef'
});
assert.equal(generatorContext.validateCfg_(courseFamilyCfg, true), '');
const courseFamilySchema = generatorContext.buildDbProperties_(courseFamilyCfg);
for (const fixedKey of ['功德主', '聯絡人', '繳款方式', '備註', '總金額']) {
  assert.ok(Object.hasOwn(courseFamilySchema, fixedKey), 'fixed Notion schema key missing: ' + fixedKey);
}
const courseFamilyFiles = generatorContext.buildFiles_(Object.assign({}, courseFamilyCfg, { NOTION_TOKEN: 'secret' }));
const courseFamilyRuntime = {
  console, Date, Math, JSON, Object, Array, String, Number, RegExp, isFinite, isNaN, parseInt
};
vm.createContext(courseFamilyRuntime);
vm.runInContext(courseFamilyFiles.find((f) => f.name === 'Config.gs').content, courseFamilyRuntime, { filename: 'course-family-Config.gs' });
vm.runInContext(courseFamilyFiles.find((f) => f.name === 'Utils.gs').content, courseFamilyRuntime, { filename: 'course-family-Utils.gs' });
vm.runInContext(courseFamilyFiles.find((f) => f.name === 'Code.gs').content, courseFamilyRuntime, { filename: 'course-family-Code.gs' });
const emptyCourseFamily = courseFamilyRuntime.submitApi({
  '聯絡人': '王老師', '電話': '0912345678', '繳款方式': '現金', '個資同意': '__YES__', '備註': '', '功德主清單': []
});
assert.equal(emptyCourseFamily.ok, false);
assert.equal(emptyCourseFamily.error, '至少要有一位學員');
assert.doesNotMatch(emptyCourseFamily.error, /功德主/);
const courseNoteError = courseFamilyRuntime.reportUpdateApi(
  'password123', '01234567-89ab-cdef-0123-456789abcdef', { '備註': '甲'.repeat(2001) }
);
assert.equal(courseNoteError.ok, false);
assert.match(courseNoteError.error, /學習需求/);
const courseMail = courseFamilyRuntime.buildConfirmationMail_({
  registrationId: 'R-COURSE', contact: '王老師', phone: '0912345678', pay: '現金', mode: 'family',
  rows: [{ '功德主': '王同學', '課程方案 A': 1 }]
});
for (const visibleLabel of ['課程聯絡人', '學員人數', '付款方式', '【課程方案】', '應付金額']) {
  assert.match(courseMail.adminBody, new RegExp(visibleLabel));
}
const legalBracesCfg = generatorContext.normalizeCfg_({
  orgName: '測試宮', event: 'legal-braces', eventName: '合法 {{VIP}} 活動',
  eventDesc: '可合法顯示 {{SALE_2026}} 文字', reportPassword: 'password123',
  registrationMode: 'single', paymentOptions: ['現金'],
  items: [{ name: '供品', pricingMode: 'fixed', price: 100 }],
  dbId: '0123456789abcdef0123456789abcdef'
});
const legalBracesFiles = generatorContext.buildFiles_(Object.assign({}, legalBracesCfg, { NOTION_TOKEN: 'secret' }));
const legalBracesConfig = legalBracesFiles.find((f) => f.name === 'Config.gs').content;
assert.match(legalBracesConfig, /合法 \{\{VIP\}\} 活動/);
assert.match(legalBracesConfig, /可合法顯示 \{\{SALE_2026\}\} 文字/);
const generatedConfig = generatedFiles.find((f) => f.name === 'Config.gs').content;
const generatedServerCode = generatedFiles.find((f) => f.name === 'Code.gs').content;
const generatedClose = generatedFiles.find((f) => f.name === 'close.html').content;
const themedGeneratedIndex = generatedFiles.find((f) => f.name === 'index.html').content;
const themedGeneratedLookup = generatedFiles.find((f) => f.name === 'lookup.html').content;
const themedGeneratedReport = generatedFiles.find((f) => f.name === 'report.html').content;
for (const themedPage of [themedGeneratedIndex, themedGeneratedLookup, themedGeneratedReport, generatedClose]) {
  assert.match(themedPage, /#F1F6F2/);
  assert.match(themedPage, /20px/);
  assert.match(themedPage, /21px/);
  assert.doesNotMatch(themedPage, /\{\{(?:THEME_BG|CARD_RADIUS|FONT_SIZE)\}\}/);
}
assert.match(themedGeneratedIndex, /class="layout-poster shadow-strong"/);
assert.match(themedGeneratedIndex, /id="btnSubmit">立即完成登記</);
assert.match(themedGeneratedIndex, /<label>學員 <span class="req">/);
assert.match(themedGeneratedIndex, /<h2 id="itemsTitle">課程方案<\/h2>/);
assert.match(themedGeneratedLookup, /<h2>學員與課程方案<\/h2>/);
assert.match(themedGeneratedReport, /PERSON:'報名人'/);
assert.match(themedGeneratedLookup, /class="shadow-strong"/);
assert.match(themedGeneratedReport, /class="shadow-strong"/);
assert.match(generatedClose, /class="shadow-strong"/);
assert.match(generatedConfig, /REGISTRATION_START: "2026-08-10T09:00"/);
assert.match(generatedConfig, /REG_STATUS: \["有效","已取消"\]/);
const closedMatches = generatedConfig.match(/^\s*CLOSED:\s*(true|false)\s*,/gm) || [];
assert.equal(closedMatches.length, 1);
const toggledConfig = generatedConfig.replace(/^(\s*CLOSED:\s*)(true|false)(\s*,)/m, '$1true$3');
assert.match(toggledConfig, /^\s*CLOSED:\s*true\s*,/m);
new vm.Script(toggledConfig, { filename: 'generated-Config-toggled.gs' });
assert.match(generatedClose, /getClientConfig\('close'\)/);
assert.doesNotMatch(generatedClose, /\{\{CFG_INJECT\}\}/);
let requireAllScopesCalls = 0;
const runtimeConfigContext = { console, Date, Math, JSON, Object, Array, String, Number, RegExp, isFinite,
  NOTION_VERSION: '2022-06-28',
  ScriptApp: {
    AuthMode: { FULL: 'FULL' },
    requireAllScopes: (mode) => {
      assert.equal(mode, 'FULL');
      requireAllScopesCalls += 1;
    },
    getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' })
  },
  UrlFetchApp: { fetch: () => ({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify({ id: 'integration-user' })
  }) },
  MailApp: { getRemainingDailyQuota: () => 88 } };
vm.createContext(runtimeConfigContext);
vm.runInContext(generatedConfig, runtimeConfigContext, { filename: 'generated-Config.gs' });
vm.runInContext(generatedServerCode, runtimeConfigContext, { filename: 'generated-Code.gs' });
runtimeConfigContext.notionToken_ = () => 'secret';
assert.equal(runtimeConfigContext.authorizeApp(), '授權完成；Notion 連線正常；目前可寄信額度 88');
assert.equal(requireAllScopesCalls, 1);
runtimeConfigContext.UrlFetchApp.fetch = () => { throw new Error('您沒有呼叫「UrlFetchApp.fetch」的權限。必要權限：script.external_request'); };
assert.match(runtimeConfigContext.notionApi_('get', '/users/me').error, /authorizeApp/);
runtimeConfigContext.CONFIG.REGISTRATION_START = '2000-01-01T09:00';
runtimeConfigContext.CONFIG.REGISTRATION_END = '2000-01-01T17:00';
const closeClientConfig = runtimeConfigContext.getClientConfig('close');
assert.equal(closeClientConfig.REGISTRATION_STATE.code, 'closed');
assert.equal(Object.hasOwn(closeClientConfig, 'REPORT_PASSWORD'), false);
assert.equal(JSON.stringify(closeClientConfig).includes('password123'), false);
assert.equal(closeClientConfig.WEB_APP_URL, 'https://script.google.com/macros/s/TEST/exec');
const generatedIndex = generatedFiles.find((f) => f.name === 'index.html').content;
assert.doesNotMatch(generatedIndex, /href=["']\?page=/);
assert.match(generatedIndex, /CFG\.WEB_APP_URL[\s\S]*\?page=lookup/);
const generatedManifest = JSON.parse(generatedFiles.find((f) => f.name === 'appsscript.json').content);
assert.equal(generatedManifest.timeZone, 'Asia/Taipei');
assert.equal(generatedManifest.runtimeVersion, 'V8');
assert.equal(generatedManifest.webapp.access, 'ANYONE_ANONYMOUS');
assert.equal(generatedManifest.webapp.executeAs, 'USER_DEPLOYING');
const generatedDeploy = generatedFiles.find((f) => f.name === 'deploy.ps1').content;
assert.match(generatedDeploy, /Invoke-ActivityPreflight/);
const activityPreflightCall = generatedDeploy.search(/\r?\nInvoke-ActivityPreflight\r?\n/);
assert.ok(activityPreflightCall >= 0, 'generated deploy script should invoke its preflight');
assert.ok(activityPreflightCall < generatedDeploy.indexOf('if ($Login)'));
assert.ok(activityPreflightCall < generatedDeploy.indexOf('clasp create'));
assert.match(generatedDeploy, /clasp push -f[\s\S]*Assert-ClaspSuccess/);
assert.match(generatedDeploy, /clasp deploy -i \$deployId[\s\S]*Assert-ClaspSuccess/);
assert.match(generatedDeploy, /Apps Script 編輯器：\$editorUrl/);
assert.match(generatedDeploy, /authorizeApp/);
assert.match(generatedDeploy, /\$isFirstDeployment/);
assert.match(generatedDeploy, /Start-Process -FilePath \$editorUrl/);
const generatedMenu = generatedFiles.find((f) => f.name === 'deployment-menu.ps1').content;
assert.match(generatedMenu, /function Open-AuthorizationGuide/);
assert.match(generatedMenu, /'6' \{ Open-AuthorizationGuide \}/);
assert.match(generatedMenu, /首次授權／重新授權（自動打開正確頁面）/);
assert.match(generatedMenu, /Start-Process -FilePath \$editorUrl/);
const generatedBat = generatedFiles.find((f) => f.name === '自動部署.bat').content;
assert.doesNotMatch(generatedBat, /(?<!\r)\n/);

generatedFiles.filter((f) => /\.html$/.test(f.name)).forEach((f) => {
  const scripts = [...f.content.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  scripts.forEach((match, index) => {
    const js = match[1].replace(/<\?!=[\s\S]*?\?>/g, '{}').trim();
    if (js) new vm.Script(js, { filename: f.name + '#script-' + index });
  });
});

// 使用假的 clasp 完整走一次「既有部署更新」；不連外、不碰真實 GAS。
const deploySmokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xuanmen-generated-deploy-'));
try {
  generatedFiles.forEach((f) => fs.writeFileSync(path.join(deploySmokeRoot, f.name), f.content, 'utf8'));
  fs.writeFileSync(path.join(deploySmokeRoot, '.clasp.json'), JSON.stringify({ scriptId: 'SCRIPT_TEST', rootDir: '.' }), 'utf8');
  fs.writeFileSync(path.join(deploySmokeRoot, '.deploy-id.txt'), 'DEPLOY_TEST', 'utf8');
  fs.writeFileSync(path.join(deploySmokeRoot, '.active-deploy-account.txt'), 'test@example.com', 'utf8');
  const fakeBin = path.join(deploySmokeRoot, 'fake-bin');
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, 'clasp.cmd'), [
    '@echo off',
    'echo %*>>"%~dp0calls.txt"',
    'if "%1"=="--version" echo 3.3.0',
    'if "%1 %2"=="--json show-authorized-user" goto auth',
    'if "%1"=="list-deployments" echo Found 1 deployments.&& echo - DEPLOY_TEST @1 - smoke',
    'if "%1"=="create" echo {"scriptId":"SCRIPT_NEW","rootDir":"fake"}>"%CD%\\.clasp.json"',
    'if "%1"=="push" echo Pushed files.',
    'if "%1"=="deploy" echo Deployed AKfycbSMOKE123 @2',
    'exit /b 0',
    ':auth',
    'if defined CLASP_UNKNOWN echo {"loggedIn":true}',
    'if not defined CLASP_UNKNOWN echo {"loggedIn":true,"email":"test@example.com"}',
    'exit /b 0',
    ''
  ].join('\r\n'), 'utf8');
  const deploySmoke = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(deploySmokeRoot, 'deploy.ps1')], {
    cwd: deploySmokeRoot,
    encoding: 'utf8',
    timeout: 60000,
    env: Object.assign({}, process.env, { PATH: fakeBin + path.delimiter + process.env.PATH })
  });
  assert.equal(deploySmoke.status, 0, (deploySmoke.stdout || '') + (deploySmoke.stderr || ''));
  // Windows 多層 cmd/pwsh 管線可能把中文 stdout 解碼成亂碼；功能以 exit code 與 clasp 呼叫紀錄驗證。
  const claspCalls = fs.readFileSync(path.join(fakeBin, 'calls.txt'), 'utf8');
  assert.match(claspCalls, /^push -f$/m);
  assert.match(claspCalls, /^deploy -i DEPLOY_TEST -d /m);

  // clasp 已登入但拿不到 email 時，選單手動確認的帳號必須能傳進子部署程序。
  fs.writeFileSync(path.join(fakeBin, 'calls.txt'), '', 'utf8');
  const unknownUserDeploy = spawnSync('pwsh', [
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(deploySmokeRoot, 'deploy.ps1'),
    '-AccountEmail', 'test@example.com'
  ], {
    cwd: deploySmokeRoot,
    encoding: 'utf8',
    timeout: 60000,
    env: Object.assign({}, process.env, { PATH: fakeBin + path.delimiter + process.env.PATH, CLASP_UNKNOWN: '1' })
  });
  assert.equal(unknownUserDeploy.status, 0, (unknownUserDeploy.stdout || '') + (unknownUserDeploy.stderr || ''));
  assert.match(unknownUserDeploy.stdout, /test@example\.com/);
  const unknownClaspCalls = fs.readFileSync(path.join(fakeBin, 'calls.txt'), 'utf8');
  assert.match(unknownClaspCalls, /^push -f$/m);
  assert.match(unknownClaspCalls, /^deploy -i DEPLOY_TEST -d /m);

  // 同一份產物再走首次建置路徑：create → push → create deployment。
  fs.rmSync(path.join(deploySmokeRoot, '.clasp.json'));
  fs.rmSync(path.join(deploySmokeRoot, '.deploy-id.txt'));
  fs.writeFileSync(path.join(fakeBin, 'calls.txt'), '', 'utf8');
  const firstDeploySmoke = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(deploySmokeRoot, 'deploy.ps1'), '-SkipOpenAuthorization'], {
    cwd: deploySmokeRoot,
    encoding: 'utf8',
    input: 'y\r\n',
    timeout: 60000,
    env: Object.assign({}, process.env, { PATH: fakeBin + path.delimiter + process.env.PATH })
  });
  assert.equal(firstDeploySmoke.status, 0, (firstDeploySmoke.stdout || '') + (firstDeploySmoke.stderr || ''));
  assert.equal(fs.readFileSync(path.join(deploySmokeRoot, '.deploy-id.txt'), 'utf8').trim(), 'AKfycbSMOKE123');
  const firstClaspCalls = fs.readFileSync(path.join(fakeBin, 'calls.txt'), 'utf8');
  assert.match(firstClaspCalls, /^create --type standalone --title .* --rootDir /m);
  assert.match(firstClaspCalls, /^push -f$/m);
  assert.match(firstClaspCalls, /^deploy -d /m);
} finally {
  const resolvedSmokeRoot = path.resolve(deploySmokeRoot);
  const resolvedTempRoot = path.resolve(os.tmpdir()) + path.sep;
  assert.ok(resolvedSmokeRoot.startsWith(resolvedTempRoot) && path.basename(resolvedSmokeRoot).startsWith('xuanmen-generated-deploy-'));
  fs.rmSync(resolvedSmokeRoot, { recursive: true, force: true });
}

console.log('notion template safety tests: OK');
