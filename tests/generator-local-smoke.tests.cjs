const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const baseUrl = process.env.GAS_LOCAL_URL || 'http://127.0.0.1:3100';
const generatorSource = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
const context = { console, Date, Math, JSON, Object, Array, String, Number, RegExp, isFinite, parseInt };
vm.createContext(context);
vm.runInContext(generatorSource, context, { filename: 'Code.gs' });

async function callGas(functionName, args = []) {
  const response = await fetch(baseUrl + '/__gas/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ function: functionName, arguments: args })
  });
  const payload = await response.json();
  assert.equal(response.status, 200, functionName + ' HTTP status');
  assert.equal(payload.ok, true, payload.error || functionName + ' failed');
  return payload.result;
}

function assertZipContains(zipBuffer, name) {
  assert.ok(zipBuffer.includes(Buffer.from(name, 'utf8')), 'ZIP missing entry: ' + name);
}

async function testGenerate(sample) {
  sample.dbSchemaKey = context.schemaKey_(context.normalizeCfg_(sample));
  const generated = await callGas('generateApi', [sample]);
  assert.equal(generated.ok, true, generated.error || sample.registrationMode + ' generation failed');
  assert.equal(generated.filename, sample.event + '.zip');
  assert.ok(generated.checklist && generated.checklist.length > 20, 'checklist should not be empty');

  const zip = Buffer.from(generated.zipB64, 'base64');
  assert.ok(zip.length > 10000, 'ZIP is unexpectedly small');
  assert.equal(zip.subarray(0, 2).toString('ascii'), 'PK', 'ZIP signature');
  [
    'Config.gs', 'Code.gs', 'Utils.gs', 'Secrets.gs',
    'index.html', 'report.html', 'lookup.html', 'close.html',
    'appsscript.json', 'CLAUDE.md'
  ].forEach((name) => assertZipContains(zip, name));

  return {
    mode: sample.registrationMode,
    filename: generated.filename,
    zipBytes: zip.length,
    checklist: 'OK',
    usageLog: generated.usageLogWarning ? 'warning (expected in safe mode)' : 'OK'
  };
}

(async () => {
  const health = await (await fetch(baseUrl + '/__gas/health')).json();
  assert.equal(health.ok, true);
  assert.equal(health.network, false, 'Refusing to run with network enabled');

  const settings = await callGas('loadNotionSettingsApi');
  assert.equal(settings.ok, true);
  assert.equal(settings.publicMode, true);
  assert.equal(settings.hasToken, false, 'Public mode must not expose a saved server-side token');

  const single = {
    token: 'ntn_local_test',
    orgName: '測試主辦單位', event: 'generator-single-test', eventName: '產生器單人測試',
    reportPassword: 'testpass123', registrationMode: 'single', paymentOptions: ['現金'],
    items: [{ name: '固定品項', pricingMode: 'fixed', price: 100, unit: '份', limit: 3 }],
    dbId: '0123456789abcdef0123456789abcdef',
    registrationStart: '2026-10-01T08:00', registrationEnd: '2026-10-31T18:00'
  };
  const family = {
    token: 'ntn_local_test',
    orgName: '測試主辦單位', event: 'generator-family-test', eventName: '產生器家庭測試',
    reportPassword: 'testpass123', registrationMode: 'family',
    paymentOptions: ['現金', '匯款', '刷卡', 'LinePay'],
    bankBank: '測試銀行', bankAcct: '0000012345', bankName: '測試戶名',
    hasGroup: true, groupField: '所屬單位', groupOptions: ['甲單位', '乙單位'],
    items: [
      { name: '固定品項', pricingMode: 'fixed', price: 300, unit: '份', limit: 5 },
      { name: '隨喜品項', pricingMode: 'donation', unit: '份' },
      { name: '免費品項', pricingMode: 'free', unit: '份', limit: 2 },
      { name: '最低金額品項', pricingMode: 'minimum', minAmount: 500, unit: '份' }
    ],
    customFields: [
      { name: '文字欄', type: 'text', required: true },
      { name: '下拉欄', type: 'select', options: ['選項一', '選項二'] },
      { name: '勾選欄', type: 'checkbox' },
      { name: '日期欄', type: 'date' },
      { name: '連動欄', type: 'text', showWhenItem: '固定品項' }
    ],
    dbId: 'fedcba9876543210fedcba9876543210',
    registrationStart: '2026-10-01T08:00', registrationEnd: '2026-10-31T18:00'
  };

  const results = [await testGenerate(single), await testGenerate(family)];
  console.table(results);
  console.log('generator local smoke tests: OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
