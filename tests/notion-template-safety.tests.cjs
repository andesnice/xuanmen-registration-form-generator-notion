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
    REPORT_PASSWORD: 'test-password'
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
assert.match(clearedLastFive.error, /有效的繳款方式/);
const blankPaymentWithLastFive = context.reportUpdateApi('test-password', currentId, { '繳款方式': '', '帳號後五碼': '12345' });
assert.equal(blankPaymentWithLastFive.ok, false);
assert.match(blankPaymentWithLastFive.error, /有效的繳款方式/);

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
assert.match(uiSource, /class="table-scroll"[^>]*role="region"/);
assert.match(uiSource, /function updateWorkspaceState\(\)/);
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
assert.equal(generatorContext.fill_('A {{KNOWN}} Z', { KNOWN: '{{VIP}}' }), 'A {{VIP}} Z');
assert.throws(() => generatorContext.fill_('A {{MISSING}} Z', {}), /模板缺少替換值：MISSING/);
const generatedCfg = generatorContext.normalizeCfg_({
  orgName: '測試宮', event: 'schedule-test', eventName: '測試活動', reportPassword: 'password123',
  registrationStart: '2026-08-10T09:00', registrationEnd: '2026-08-10T17:00',
  registrationMode: 'single', paymentOptions: ['現金'], items: [{ name: '供品', pricingMode: 'fixed', price: 100 }],
  dbId: '0123456789abcdef0123456789abcdef'
});
assert.equal(generatorContext.validateCfg_(generatedCfg, true), '');
assert.match(generatorContext.validateCfg_(Object.assign({}, generatedCfg, { REGISTRATION_END: '2026-08-10T08:59' }), true), /晚於/);
const schema = generatorContext.buildDbProperties_(generatedCfg);
assert.ok(schema['報名狀態'].select);
assert.ok(schema['取消時間'].date);
assert.equal(JSON.parse(generatorContext.schemaKey_(generatedCfg)).schemaVersion, 2);
const generatedFiles = generatorContext.buildFiles_(Object.assign({}, generatedCfg, { NOTION_TOKEN: 'secret' }));
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
assert.match(generatedConfig, /REGISTRATION_START: "2026-08-10T09:00"/);
assert.match(generatedConfig, /REG_STATUS: \["有效","已取消"\]/);
const closedMatches = generatedConfig.match(/^\s*CLOSED:\s*(true|false)\s*,/gm) || [];
assert.equal(closedMatches.length, 1);
const toggledConfig = generatedConfig.replace(/^(\s*CLOSED:\s*)(true|false)(\s*,)/m, '$1true$3');
assert.match(toggledConfig, /^\s*CLOSED:\s*true\s*,/m);
new vm.Script(toggledConfig, { filename: 'generated-Config-toggled.gs' });
assert.match(generatedClose, /getClientConfig\('close'\)/);
assert.doesNotMatch(generatedClose, /\{\{CFG_INJECT\}\}/);
const runtimeConfigContext = { console, Date, Math, JSON, Object, Array, String, Number, RegExp, isFinite,
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }) } };
vm.createContext(runtimeConfigContext);
vm.runInContext(generatedConfig, runtimeConfigContext, { filename: 'generated-Config.gs' });
vm.runInContext(generatedServerCode, runtimeConfigContext, { filename: 'generated-Code.gs' });
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
    'if "%1"=="show-authorized-user" echo Logged in as test@example.com',
    'if "%1"=="list-deployments" echo Found 1 deployments.&& echo - DEPLOY_TEST @1 - smoke',
    'if "%1"=="create" echo {"scriptId":"SCRIPT_NEW","rootDir":"fake"}>"%CD%\\.clasp.json"',
    'if "%1"=="push" echo Pushed files.',
    'if "%1"=="deploy" echo Deployed AKfycbSMOKE123 @2',
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
  assert.match(deploySmoke.stdout, /部署前檢查通過/);
  const claspCalls = fs.readFileSync(path.join(fakeBin, 'calls.txt'), 'utf8');
  assert.match(claspCalls, /^push -f$/m);
  assert.match(claspCalls, /^deploy -i DEPLOY_TEST -d /m);

  // 同一份產物再走首次建置路徑：create → push → create deployment。
  fs.rmSync(path.join(deploySmokeRoot, '.clasp.json'));
  fs.rmSync(path.join(deploySmokeRoot, '.deploy-id.txt'));
  fs.writeFileSync(path.join(fakeBin, 'calls.txt'), '', 'utf8');
  const firstDeploySmoke = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(deploySmokeRoot, 'deploy.ps1')], {
    cwd: deploySmokeRoot,
    encoding: 'utf8',
    input: 'y\r\n',
    timeout: 60000,
    env: Object.assign({}, process.env, { PATH: fakeBin + path.delimiter + process.env.PATH })
  });
  assert.equal(firstDeploySmoke.status, 0, (firstDeploySmoke.stdout || '') + (firstDeploySmoke.stderr || ''));
  assert.match(firstDeploySmoke.stdout, /部署前檢查通過/);
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
