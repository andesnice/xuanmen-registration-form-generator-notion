const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const utilsSource = fs.readFileSync(path.join(root, 'tmpl_Utils.html'), 'utf8').replaceAll('{{EVENT_NAME}}', '測試活動');
const codeSource = fs.readFileSync(path.join(root, 'tmpl_Code.html'), 'utf8').replaceAll('{{EVENT_NAME}}', '測試活動');
const generatorSource = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');

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

console.log('notion template safety tests: OK');
