// ═══════════════════════════════════════════════════════════
//  宮廟共用報名表產生器 — Code.gs
//  GAS Web App：填標題/品項/費用/Notion token → 建 Notion DB
//  → 產出可部署的活動專案（Config/Code/Utils/Secrets/index/report/
//     lookup/close ＋ 建表規格 ＋ CLAUDE.md），打包成 zip 下載。
//
//  品項支援固定單價、隨喜、免費與最低金額；支援單人報名與家庭代報。
//  新增／查詢／更新一律由產出專案的 GAS 用 UrlFetchApp 直打 Notion API
//  （不經 n8n）。Notion token 與 DB ID 內嵌進產出專案的 Secrets.gs（純
//  後端、不注入前端），產生器同一顆 token 也用來建 DB。
// ═══════════════════════════════════════════════════════════

var GEN = {
  SCHEMA_VERSION: 2,
  BANK: { bank: '', acct: '', name: '' },
  PAY_OPTIONS: ['現金', '匯款', '刷卡', 'LinePay', '功德系統'],
  PAY_STATUS: ['未處理', '未繳款', '應收', '已繳款'],
  REG_STATUS: ['有效', '已取消'],
  GROUP_DEFAULT: ['本宮', '友宮', '其他'],
  REGISTRATION_MODES: ['single', 'family'],
  CUSTOM_FIELD_TYPES: ['text', 'select', 'checkbox', 'date'],
  PRICING_MODES: ['fixed', 'donation', 'free', 'minimum'],
  PRESET_PREFIX: 'REG_FORM_PRESET_',
  NOTION_TOKEN_KEY: 'REG_FORM_NOTION_TOKEN',
  NOTION_PARENT_KEY: 'REG_FORM_NOTION_PARENT',
  // Notion DB 固定文字/數字欄（品項欄另外動態加）
  TXT_FIELDS: ['地址', '匯款日期', '帳號後五碼', '備註', '報名編號'],
  RESERVED_FIELDS: ['功德主', '聯絡人', '家庭編號', '報名編號', '電話', '地址', '繳款方式', '繳費狀況', '匯款日期', '帳號後五碼',
    '匯款金額', '確認匯款?', '稽核', '個資同意', '備註', '總金額', '報名時間', '報名狀態', '取消時間']
};

function doGet() {
  return HtmlService.createTemplateFromFile('ui').evaluate()
    .setTitle('宮廟共用報名表產生器')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ── 前端用 google.script.run 呼叫這兩支 ──────────────────────

// 建 Notion DB；活動總資料庫模式會先建立一筆活動頁面，再把報名 DB 建在該頁面底下。
function createDbApi(p) {
  try {
    p = p || {};
    var savedNotion = getSavedNotionSettings_();
    var notionToken = String(p.token || savedNotion.token || '').trim();
    if (!notionToken) return { ok: false, error: '缺 Notion API token，請輸入或先儲存 Notion 連線設定' };
    var parentMode = String(p.parentMode || savedNotion.parentMode || 'activity_database').trim();
    var targetValue = p.parentTargetId || p.parentPageId || savedNotion.parentTargetId || '';
    if (parentMode !== 'page' && parentMode !== 'activity_database') return { ok: false, error: 'Notion 建立位置模式不正確' };
    if (!targetValue) return { ok: false, error: parentMode === 'activity_database' ? '缺活動總資料庫 ID' : '缺 Notion 父頁面 ID' };
    var cfg = normalizeCfg_(p);
    var validation = validateCfg_(cfg, false);
    if (validation) return { ok: false, error: validation };
    var targetId = extractNotionId_(targetValue);
    if (!isNotionId_(targetId)) return { ok: false, error: parentMode === 'activity_database' ? '活動總資料庫 ID 格式不正確' : 'Notion 父頁面 ID 格式不正確' };

    if (parentMode === 'page') {
      var directDb = createRegistrationDb_(notionToken, targetId, cfg);
      if (!directDb.ok) return directDb;
      return { ok: true, dbId: directDb.data.id, url: directDb.data.url || '', schemaKey: schemaKey_(cfg), parentMode: parentMode };
    }

    var parentDb = notionRequest_(notionToken, 'get', '/databases/' + targetId);
    if (!parentDb.ok) return { ok: false, error: '讀取活動總資料庫失敗：' + parentDb.error };
    var titleProp = findTitleProperty_(parentDb.data && parentDb.data.properties);
    if (!titleProp) return { ok: false, error: '活動總資料庫找不到 title 標題欄，無法建立活動紀錄' };
    var dbIdField = parentDb.data.properties && parentDb.data.properties['報名資料庫 ID'];
    if (dbIdField && dbIdField.type !== 'rich_text') return { ok: false, error: '活動總資料庫的「報名資料庫 ID」欄必須是文字（rich_text）' };
    if (!dbIdField) {
      var addField = notionRequest_(notionToken, 'patch', '/databases/' + targetId, { properties: { '報名資料庫 ID': { rich_text: {} } } });
      if (!addField.ok) return { ok: false, error: '新增「報名資料庫 ID」欄失敗：' + addField.error };
    }

    var pageProps = {};
    pageProps[titleProp] = { title: [{ type: 'text', text: { content: cfg.ORG_NAME + '－' + cfg.EVENT_NAME } }] };
    var activityPage = notionRequest_(notionToken, 'post', '/pages', {
      parent: { database_id: targetId },
      properties: pageProps
    });
    if (!activityPage.ok) return { ok: false, error: '建立活動紀錄失敗：' + activityPage.error };

    var childDb = createRegistrationDb_(notionToken, activityPage.data.id, cfg);
    if (!childDb.ok) return { ok: false, error: '活動紀錄已建立，但報名資料庫建立失敗：' + childDb.error + (activityPage.data.url ? '\n活動頁面：' + activityPage.data.url : '') };

    var idProp = { '報名資料庫 ID': { rich_text: [{ type: 'text', text: { content: childDb.data.id } }] } };
    var writeBack = notionRequest_(notionToken, 'patch', '/pages/' + activityPage.data.id, { properties: idProp });
    return {
      ok: true,
      dbId: childDb.data.id,
      url: childDb.data.url || '',
      activityPageId: activityPage.data.id,
      activityPageUrl: activityPage.data.url || '',
      schemaKey: schemaKey_(cfg),
      parentMode: parentMode,
      warning: writeBack.ok ? '' : '報名資料庫已建立，但 ID 回填失敗：' + writeBack.error
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Notion 連線設定（Token 僅存伺服器端，不回傳前端）──────────
function getSavedNotionSettings_() {
  var props = PropertiesService.getUserProperties();
  var token = String(props.getProperty(GEN.NOTION_TOKEN_KEY) || '').trim();
  var parent = {};
  try { parent = JSON.parse(props.getProperty(GEN.NOTION_PARENT_KEY) || '{}'); } catch (ignore) {}
  return {
    token: token,
    parentMode: parent.parentMode === 'page' ? 'page' : 'activity_database',
    parentTargetId: String(parent.parentTargetId || '').trim()
  };
}

function loadNotionSettingsApi() {
  try {
    var saved = getSavedNotionSettings_();
    return { ok: true, hasToken: !!saved.token, parentMode: saved.parentMode, parentTargetId: saved.parentTargetId };
  } catch (err) { return { ok: false, error: String(err) }; }
}

function saveNotionSettingsApi(p) {
  try {
    p = p || {};
    var saved = getSavedNotionSettings_();
    var token = String(p.token || '').trim();
    var parentMode = String(p.parentMode || 'activity_database').trim();
    var targetId = extractNotionId_(p.parentTargetId || '');
    if (!token && !saved.token) return { ok: false, error: '第一次儲存請輸入 Notion API token' };
    if (token.length > 500) return { ok: false, error: 'Notion API token 長度不正確' };
    if (parentMode !== 'page' && parentMode !== 'activity_database') return { ok: false, error: 'Notion 建立位置模式不正確' };
    if (!isNotionId_(targetId)) return { ok: false, error: parentMode === 'activity_database' ? '活動總資料庫 ID 格式不正確' : '父頁面 ID 格式不正確' };
    var props = PropertiesService.getUserProperties();
    if (token) props.setProperty(GEN.NOTION_TOKEN_KEY, token);
    props.setProperty(GEN.NOTION_PARENT_KEY, JSON.stringify({ parentMode: parentMode, parentTargetId: targetId }));
    return { ok: true, hasToken: true, parentMode: parentMode, parentTargetId: targetId };
  } catch (err) { return { ok: false, error: String(err) }; }
}

function clearNotionSettingsApi() {
  try {
    var props = PropertiesService.getUserProperties();
    props.deleteProperty(GEN.NOTION_TOKEN_KEY);
    props.deleteProperty(GEN.NOTION_PARENT_KEY);
    return { ok: true };
  } catch (err) { return { ok: false, error: String(err) }; }
}

function notionRequest_(token, method, path, body) {
  try {
    var options = {
      method: method,
      headers: { 'Authorization': 'Bearer ' + token, 'Notion-Version': '2022-06-28' },
      muteHttpExceptions: true
    };
    if (body != null) {
      options.contentType = 'application/json';
      options.payload = JSON.stringify(body);
    }
    var res = UrlFetchApp.fetch('https://api.notion.com/v1' + path, options);
    var code = res.getResponseCode();
    var text = res.getContentText() || '';
    var data = {};
    try { data = JSON.parse(text || '{}'); } catch (ignore) {}
    if (code >= 200 && code < 300) return { ok: true, data: data, code: code };
    return { ok: false, code: code, data: data, error: 'Notion API ' + code + '：' + (data.message || text || '未知錯誤') };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function createRegistrationDb_(token, parentPageId, cfg) {
  return notionRequest_(token, 'post', '/databases', {
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: cfg.ORG_NAME + '－' + cfg.EVENT_NAME + ' 報名' } }],
    properties: buildDbProperties_(cfg)
  });
}

function findTitleProperty_(properties) {
  var names = Object.keys(properties || {});
  for (var i = 0; i < names.length; i++) {
    if (properties[names[i]] && properties[names[i]].type === 'title') return names[i];
  }
  return '';
}

function isNotionId_(value) {
  return /^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/.test(String(value || ''));
}

// 產出整包檔案 → 回 { ok, filename, zipB64, checklist }
function generateApi(p) {
  try {
    var cfg = normalizeCfg_(p);
    var validation = validateCfg_(cfg, true);
    if (validation) return { ok: false, error: validation };
    if (String(p.dbSchemaKey || '') !== schemaKey_(cfg)) return { ok: false, error: '報名模式、繳款方式、自訂欄位、品項或所屬單位設定已在建表後變更，請重新建立 Notion DB' };
    var notionToken = String(getSavedNotionSettings_().token || '').trim();
    if (!notionToken) return { ok: false, error: '缺 Notion API token：請先在上方「Notion 連線設定」儲存 token（會內嵌進產出的 Secrets.gs，讓報名表 GAS 直打 Notion）' };
    cfg.NOTION_TOKEN = notionToken;
    var files = buildFiles_(cfg);
    var blobs = files.map(function (f) { return Utilities.newBlob(f.content, 'text/plain', f.name); });
    var zip = Utilities.zip(blobs, cfg.EVENT + '.zip');
    return {
      ok: true,
      filename: cfg.EVENT + '.zip',
      zipB64: Utilities.base64Encode(zip.getBytes()),
      checklist: buildChecklist_(cfg)
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── 常用設定範本（依目前 Google 使用者儲存）──────────────────
function listPresetsApi() {
  try {
    var all = PropertiesService.getUserProperties().getProperties();
    var presets = [];
    Object.keys(all).forEach(function(k){
      if (k.indexOf(GEN.PRESET_PREFIX) !== 0) return;
      try {
        var x = JSON.parse(all[k]);
        if (x && x.name && x.data) presets.push(x);
      } catch (ignore) {}
    });
    presets.sort(function(a,b){return String(b.updatedAt||'').localeCompare(String(a.updatedAt||''));});
    return {ok:true,presets:presets};
  } catch (err) { return {ok:false,error:String(err)}; }
}

function savePresetApi(name, p) {
  try {
    name = String(name || '').trim();
    if (!name || name.length > 40) return {ok:false,error:'範本名稱需為 1～40 字'};
    p = p || {};
    var cfg = normalizeCfg_(p);
    var data = {
      orgName:cfg.ORG_NAME,
      bankBank:cfg.BANK.bank, bankAcct:cfg.BANK.acct, bankName:cfg.BANK.name,
      themePrimary:cfg.THEME_PRIMARY, themeGold:cfg.THEME_GOLD,
      registrationMode:cfg.registrationMode, paymentOptions:cfg.payOptions,
      hasGroup:cfg.hasGroup, groupField:cfg.groupField, groupOptions:cfg.groupOptions,
      totalCapacity:cfg.totalCapacity, items:cfg.items, customFields:cfg.customFields
    };
    var itemSeen = {}, customSeen = {};
    for (var i=0;i<data.items.length;i++) {
      var it=data.items[i];
      if (!it.name || itemSeen[it.name] || GEN.RESERVED_FIELDS.indexOf(it.name)>=0) return {ok:false,error:'品項名稱不正確或重複：'+it.name};
      if (GEN.PRICING_MODES.indexOf(it.pricingMode)<0) return {ok:false,error:'品項計價模式不正確：'+it.name};
      itemSeen[it.name]=true;
    }
    for (var c=0;c<data.customFields.length;c++) {
      var cf=data.customFields[c];
      if (!cf.name || customSeen[cf.name] || itemSeen[cf.name] || GEN.RESERVED_FIELDS.indexOf(cf.name)>=0) return {ok:false,error:'自訂欄位名稱不正確或重複：'+cf.name};
      if (cf.showWhenItem && !itemSeen[cf.showWhenItem]) return {ok:false,error:'連動品項不存在：'+cf.name};
      customSeen[cf.name]=true;
    }
    var record = {name:name,data:data,updatedAt:new Date().toISOString()};
    var json = JSON.stringify(record);
    if (json.length > 7000) return {ok:false,error:'範本內容過大，請減少品項或自訂欄位'};
    var props = PropertiesService.getUserProperties();
    var existing = props.getProperties(), count = Object.keys(existing).filter(function(k){return k.indexOf(GEN.PRESET_PREFIX)===0;}).length;
    var key = GEN.PRESET_PREFIX + encodeURIComponent(name);
    if (!existing[key] && count >= 30) return {ok:false,error:'最多儲存 30 組範本'};
    props.setProperty(key,json);
    return listPresetsApi();
  } catch (err) { return {ok:false,error:String(err)}; }
}

function deletePresetApi(name) {
  try {
    name=String(name||'').trim();
    if (!name) return {ok:false,error:'缺範本名稱'};
    PropertiesService.getUserProperties().deleteProperty(GEN.PRESET_PREFIX + encodeURIComponent(name));
    return listPresetsApi();
  } catch (err) { return {ok:false,error:String(err)}; }
}

// ── Notion DB properties（建表用）────────────────────────────
function buildDbProperties_(p) {
  var props = {
    '功德主': { title: {} },
    '電話': { phone_number: {} },
    '地址': { rich_text: {} },
    '報名編號': { rich_text: {} },
    '報名狀態': { select: { options: GEN.REG_STATUS.map(nameOpt_) } },
    '取消時間': { date: {} },
    '繳款方式': { select: { options: p.payOptions.map(nameOpt_) } },
    '繳費狀況': { select: { options: GEN.PAY_STATUS.map(nameOpt_) } },
    '匯款日期': { rich_text: {} },
    '帳號後五碼': { rich_text: {} }, // 🔴 絕不可 number（會吃前導 0）
    '匯款金額': { number: {} },
    '確認匯款?': { checkbox: {} },
    '稽核': { checkbox: {} },
    '個資同意': { checkbox: {} },
    '備註': { rich_text: {} },
    '總金額': { number: {} },
    '報名時間': { date: {} }
  };
  if (p.registrationMode === 'family') {
    props['聯絡人'] = { rich_text: {} };
    props['家庭編號'] = { rich_text: {} };
  }
  if (p.hasGroup) {
    props[p.groupField] = { select: { options: p.groupOptions.map(nameOpt_) } };
  }
  (p.items || []).forEach(function (it) {
    var name = String(it.name || '').trim();
    if (name) props[name] = { number: {} };
  });
  (p.customFields || []).forEach(function (f) {
    if (f.type === 'select') props[f.name] = { select: { options: f.options.map(nameOpt_) } };
    else if (f.type === 'checkbox') props[f.name] = { checkbox: {} };
    else if (f.type === 'date') props[f.name] = { date: {} };
    else props[f.name] = { rich_text: {} };
  });
  return props;
}
function nameOpt_(n) { return { name: String(n) }; }

// Logo 只接受內嵌 base64 圖片 data URL（png/jpg/gif/webp/svg）；空或不合法一律回 ''（產出端會退回 🏮）
// base64 字元集只有 A-Za-z0-9+/= 與空白，不含 < > &，故存進 Config.gs 走純 tpl_ 不會被轉義
function normalizeLogo_(v) {
  v = String(v || '').replace(/\s+/g, '').trim();
  if (!v) return '';
  return /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : '';
}

// 只接受 #RRGGBB（含縮寫 #RGB），其餘一律回退預設，避免奇怪字串注進 CSS
function hexColor_(v, fallback) {
  v = String(v || '').trim();
  if (v && v[0] !== '#') v = '#' + v;
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : fallback;
}

// ── 正規化輸入 ───────────────────────────────────────────────
function normalizeCfg_(p) {
  p = p || {};
  var items = (p.items || []).map(function (it) {
    var mode = String(it.pricingMode || 'fixed').trim();
    return { name: String(it.name || '').trim(), unit: String(it.unit || '份').trim(), pricingMode:mode,
      price: mode === 'fixed' ? (Number(it.price) || 0) : 0,
      minAmount: mode === 'minimum' ? (Number(it.minAmount) || 0) : 0,
      limit: (mode === 'fixed' || mode === 'free') ? Math.max(0, parseInt(it.limit, 10) || 0) : 0 };
  }).filter(function (it) { return it.name; });
  var customFields = (p.customFields || []).map(function (f) {
    var opts = f.options || [];
    if (typeof opts === 'string') opts = opts.split(/[\n,，、]+/);
    var cleanOpts = [];
    (opts || []).forEach(function(v){ v=String(v||'').trim(); if(v && cleanOpts.indexOf(v)<0) cleanOpts.push(v); });
    return { name:String(f.name||'').trim(), type:String(f.type||'text').trim(), options:cleanOpts, required:!!f.required,
      showWhenItem:String(f.showWhenItem||'').trim() };
  }).filter(function(f){ return f.name; });
  var bank = {
    bank: String((p.bankBank != null ? p.bankBank : GEN.BANK.bank)).trim(),
    acct: String((p.bankAcct != null ? p.bankAcct : GEN.BANK.acct)).trim(),
    name: String((p.bankName != null ? p.bankName : GEN.BANK.name)).trim()
  };
  var hasGroup = !!p.hasGroup;
  var registrationMode = String(p.registrationMode || 'single').trim().toLowerCase();
  var rawPayOptions = p.paymentOptions == null ? GEN.PAY_OPTIONS : p.paymentOptions;
  if (typeof rawPayOptions === 'string') rawPayOptions = rawPayOptions.split(/[\n,，、]+/);
  var payOptions = [];
  (rawPayOptions || []).forEach(function(v){
    v = String(v || '').trim();
    if (GEN.PAY_OPTIONS.indexOf(v) >= 0 && payOptions.indexOf(v) < 0) payOptions.push(v);
  });
  var rawGroupOptions = p.groupOptions || GEN.GROUP_DEFAULT;
  if (typeof rawGroupOptions === 'string') rawGroupOptions = rawGroupOptions.split(/[\n,，、]+/);
  var groupOptions = (rawGroupOptions || []).map(function(v){ return String(v || '').trim(); }).filter(function(v){ return v; });
  return {
    ORG_NAME: String(p.orgName || '').trim(),
    EVENT: String(p.event || '').trim().toLowerCase(),
    EVENT_NAME: String(p.eventName || '').trim(),
    BANK: bank,
    THEME_PRIMARY: hexColor_(p.themePrimary, '#8B0000'),
    THEME_GOLD: hexColor_(p.themeGold, '#C8922A'),
    PAGE_TITLE: String(p.pageTitle || (p.eventName + ' 報名')).trim(),
    REPORT_TITLE: [String(p.orgName || '').trim(), String(p.eventName || '活動').trim() + ' 後台'].filter(function(v){ return v; }).join('｜'),
    EVENT_DATE: String(p.eventDate || '').trim(),
    REGISTRATION_START: String(p.registrationStart || '').trim(),
    REGISTRATION_END: String(p.registrationEnd || '').trim(),
    EVENT_PLACE: String(p.eventPlace || '').trim(),
    EVENT_DESC: String(p.eventDesc || '').trim(),
    LOGO: normalizeLogo_(p.logo),
    REMIT_DEADLINE: String(p.remitDeadline || '').trim(),
    CLOSED_MSG: String(p.closedMsg || ('感恩十方大德護持，<br>本次' + (p.eventName || '活動') + '報名已圓滿截止。')).trim(),
    REPORT_PASSWORD: String(p.reportPassword || '').trim(),
    dbId: String(p.dbId || '').trim(),
    registrationMode: registrationMode,
    payOptions: payOptions,
    totalCapacity: Math.max(0, parseInt(p.totalCapacity, 10) || 0),
    customFields: customFields,
    hasGroup: hasGroup,
    groupField: String(p.groupField || '所屬宮廟／單位').trim(),
    groupOptions: groupOptions,
    items: items
  };
}

function validateCfg_(cfg, requireDb) {
  if (!cfg.ORG_NAME) return '缺宮廟／主辦單位名稱';
  if (!cfg.EVENT_NAME) return '缺活動全名';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cfg.EVENT)) return '活動代碼 EVENT 只能使用英文小寫、數字與單一連字號';
  if (cfg.REPORT_PASSWORD.length < 8) return '後台密碼至少需要 8 碼';
  if (!cfg.payOptions.length) return '請至少選擇一種繳款方式';
  if (cfg.payOptions.indexOf('匯款') >= 0 && (!cfg.BANK.bank || !cfg.BANK.acct || !cfg.BANK.name)) return '選擇匯款時，請填完整匯款銀行、帳號與戶名';
  if (!cfg.items.length) return '至少要一個品項';
  if (GEN.REGISTRATION_MODES.indexOf(cfg.registrationMode) < 0) return '報名模式不正確';
  if (cfg.LOGO && cfg.LOGO.length > 7500000) return 'Logo 圖片過大（上限約 5MB），請換小一點的圖或先壓縮';
  var startMs = cfg.REGISTRATION_START ? registrationLocalMs_(cfg.REGISTRATION_START) : null;
  var endMs = cfg.REGISTRATION_END ? registrationLocalMs_(cfg.REGISTRATION_END) : null;
  if (cfg.REGISTRATION_START && startMs == null) return '報名開放時間格式不正確';
  if (cfg.REGISTRATION_END && endMs == null) return '報名截止時間格式不正確';
  if (startMs != null && endMs != null && endMs <= startMs) return '報名截止時間必須晚於開放時間';
  if (cfg.hasGroup) {
    if (!cfg.groupField) return '缺所屬單位欄位名稱';
    if (cfg.groupField.length > 30) return '所屬單位欄位名稱不可超過 30 字';
    if (GEN.RESERVED_FIELDS.indexOf(cfg.groupField) >= 0) return '所屬單位欄位不可與固定欄位重複：' + cfg.groupField;
    if (!cfg.groupOptions.length) return '請至少設定一個所屬單位選項';
    var groupSeen = {};
    for (var g = 0; g < cfg.groupOptions.length; g++) {
      if (groupSeen[cfg.groupOptions[g]]) return '所屬單位選項不可重複：' + cfg.groupOptions[g];
      groupSeen[cfg.groupOptions[g]] = true;
    }
  }
  var seen = {};
  for (var i = 0; i < cfg.items.length; i++) {
    var it = cfg.items[i];
    if (it.name.length > 60) return '品項名稱不可超過 60 字：' + it.name;
    if (GEN.RESERVED_FIELDS.indexOf(it.name) >= 0) return '品項名稱不可與固定欄位重複：' + it.name;
    if (cfg.hasGroup && it.name === cfg.groupField) return '品項名稱不可與所屬單位欄位重複：' + it.name;
    if (seen[it.name]) return '品項名稱不可重複：' + it.name;
    if (GEN.PRICING_MODES.indexOf(it.pricingMode) < 0) return '品項計價模式不正確：' + it.name;
    if (it.pricingMode === 'fixed' && (!isFinite(it.price) || it.price <= 0)) return '固定單價必須大於 0：' + it.name;
    if (it.pricingMode === 'minimum' && (!isFinite(it.minAmount) || it.minAmount <= 0)) return '最低金額必須大於 0：' + it.name;
    seen[it.name] = true;
  }
  var customSeen = {};
  for (var c = 0; c < cfg.customFields.length; c++) {
    var cf = cfg.customFields[c];
    if (cf.name.length > 60) return '自訂欄位名稱不可超過 60 字：' + cf.name;
    if (GEN.CUSTOM_FIELD_TYPES.indexOf(cf.type) < 0) return '自訂欄位型別不正確：' + cf.name;
    if (GEN.RESERVED_FIELDS.indexOf(cf.name) >= 0 || seen[cf.name] || (cfg.hasGroup && cf.name === cfg.groupField)) return '自訂欄位名稱不可與固定欄位、所屬單位或品項重複：' + cf.name;
    if (customSeen[cf.name]) return '自訂欄位名稱不可重複：' + cf.name;
    if (cf.type === 'select' && !cf.options.length) return '下拉欄位至少需要一個選項：' + cf.name;
    if (cf.showWhenItem && !seen[cf.showWhenItem]) return '連動品項不存在：' + cf.name;
    customSeen[cf.name] = true;
  }
  if (requireDb && !/^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/.test(cfg.dbId)) return 'Notion DB ID 格式不正確';
  return '';
}

// datetime-local 一律視為台北時間（UTC+8），並嚴格檢查日曆日期。
function registrationLocalMs_(value) {
  var m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4]), mi = Number(m[5]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  var utc = Date.UTC(y, mo - 1, d, h - 8, mi);
  var check = new Date(utc + 8 * 60 * 60 * 1000);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d ||
      check.getUTCHours() !== h || check.getUTCMinutes() !== mi) return null;
  return utc;
}

function schemaKey_(cfg) {
  return JSON.stringify({ schemaVersion: GEN.SCHEMA_VERSION, registrationMode: cfg.registrationMode, payOptions: cfg.payOptions, hasGroup: cfg.hasGroup, groupField: cfg.hasGroup ? cfg.groupField : '', groupOptions: cfg.hasGroup ? cfg.groupOptions : [],
    items: cfg.items.map(function (it) { return {name:it.name, pricingMode:it.pricingMode}; }), customFields: cfg.customFields });
}

function html_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function closedHtml_(s) {
  return html_(String(s || '')).replace(/&lt;br\s*\/?\s*&gt;/gi, '<br>');
}

function comment_(s) { return String(s || '').replace(/[\r\n]/g, ' ').replace(/\*\//g, '* /'); }

// ── 組所有輸出檔 ─────────────────────────────────────────────
function buildFiles_(cfg) {
  var map = {
    ORG_NAME_JS: JSON.stringify(cfg.ORG_NAME),
    ORG_NAME_HTML: html_(cfg.ORG_NAME),
    EVENT_NAME: comment_(cfg.EVENT_NAME),
    EVENT_JS: JSON.stringify(cfg.EVENT),
    EVENT_NAME_JS: JSON.stringify(cfg.EVENT_NAME),
    PAGE_TITLE_JS: JSON.stringify(cfg.PAGE_TITLE),
    REPORT_TITLE_JS: JSON.stringify(cfg.REPORT_TITLE),
    EVENT_DATE_JS: JSON.stringify(cfg.EVENT_DATE),
    REGISTRATION_START_JS: JSON.stringify(cfg.REGISTRATION_START),
    REGISTRATION_END_JS: JSON.stringify(cfg.REGISTRATION_END),
    EVENT_PLACE_JS: JSON.stringify(cfg.EVENT_PLACE),
    EVENT_DESC_JS: JSON.stringify(cfg.EVENT_DESC),
    REMIT_DEADLINE_JS: JSON.stringify(cfg.REMIT_DEADLINE),
    CLOSED_MSG_JS: JSON.stringify(cfg.CLOSED_MSG),
    REPORT_PASSWORD_JS: JSON.stringify(cfg.REPORT_PASSWORD),
    NOTION_TOKEN_JS: JSON.stringify(cfg.NOTION_TOKEN || ''),
    NOTION_DB_ID_JS: JSON.stringify(cfg.dbId || ''),
    BANK_JS: JSON.stringify(cfg.BANK),
    REGISTRATION_MODE_JS: JSON.stringify(cfg.registrationMode),
    QTY_ITEMS_JS: itemsToJs_(cfg.items),
    CUSTOM_FIELDS_JS: JSON.stringify(cfg.customFields),
    CAPACITY_JS: JSON.stringify({ total: cfg.totalCapacity, items: cfg.items.reduce(function(o,it){ o[it.name]=it.limit||0; return o; }, {}) }),
    GROUP_FIELD_JS: cfg.hasGroup ? JSON.stringify(cfg.groupField) : 'null',
    GROUP_OPTIONS_JS: cfg.hasGroup ? jsArr_(cfg.groupOptions) : 'null',
    PAY_OPTIONS_JS: JSON.stringify(cfg.payOptions),
    PAY_STATUS_JS: JSON.stringify(GEN.PAY_STATUS),
    REG_STATUS_JS: JSON.stringify(GEN.REG_STATUS),
    THEME_PRIMARY: cfg.THEME_PRIMARY,
    THEME_GOLD: cfg.THEME_GOLD,
    EVENT_NAME_HTML: html_(cfg.EVENT_NAME),
    CLOSED_MSG_HTML: closedHtml_(cfg.CLOSED_MSG),
    // LOGO：base64 data URL（無 < > & " '），可直接嵌 HTML 屬性；空則 close 頁退回 🏮
    LOGO_JS: JSON.stringify(cfg.LOGO || ''),
    LOGO_TAG: cfg.LOGO ? ('<img src="' + cfg.LOGO + '" alt="" class="lampimg">') : '🏮'
  };
  var idxInject = "var CFG = <?!= JSON.stringify(getClientConfig('index')) ?>;";
  var repInject = "var CFG = <?!= JSON.stringify(getClientConfig('report')) ?>;";
  var closeInject = "var CFG = <?!= JSON.stringify(getClientConfig('close')) ?>;";

  return [
    { name: 'Config.gs', content: fill_(tpl_('tmpl_Config'), map) },
    // tmpl_Code 是整支裸 JS（無 HTML 標籤包裹），比較運算子的 < > 會被 getContent() 轉成 &lt;/&gt;，必須用 rawTpl_ 還原
    { name: 'Code.gs', content: fill_(rawTpl_('tmpl_Code'), map) },
    // Utils 含 < / > 比較運算子，必須走 rawTpl_，否則 HtmlService 會轉成 &lt; / &gt;。
    { name: 'Utils.gs', content: fill_(rawTpl_('tmpl_Utils'), map) },
    { name: 'Secrets.gs', content: fill_(tpl_('tmpl_Secrets'), map) },
    { name: 'appsscript.json', content: tpl_('tmpl_appsscript') },
    { name: 'index.html', content: fill_(tpl_('tmpl_index'), extend_(map, { CFG_INJECT: idxInject })) },
    { name: 'report.html', content: fill_(tpl_('tmpl_report'), extend_(map, { CFG_INJECT: repInject })) },
    { name: 'lookup.html', content: fill_(tpl_('tmpl_lookup'), extend_(map, { CFG_INJECT: idxInject })) },
    { name: 'close.html', content: fill_(tpl_('tmpl_close'), extend_(map, { CFG_INJECT: closeInject })) },
    // 一鍵部署（雙擊 .bat → 選單 → deploy.ps1）；每個 Google 帳號隔離 Script/部署 ID，bat 需 CRLF
    { name: '自動部署.bat', content: rawTpl_('tmpl_auto_deploy_bat').replace(/\r?\n/g, '\r\n') },
    { name: 'deployment-account.ps1', content: rawTpl_('tmpl_auto_deploy_account') },
    { name: 'deployment-menu.ps1', content: rawTpl_('tmpl_auto_deploy_menu') },
    { name: 'deploy.ps1', content: rawTpl_('tmpl_auto_deploy_ps1') },
    { name: 'Notion建表規格.md', content: buildSchemaDoc_(cfg) },
    { name: 'CLAUDE.md', content: buildProjectClaudeMd_(cfg) }
  ];
}

function tpl_(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }
// 非 HTML 產物（.gs/.bat/.ps1）含 < > & 比較運算子與重導向，HtmlService 讀取時會轉義，必須還原成原始文字。
function rawTpl_(name) {
  return tpl_(name)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
function fill_(s, map) {
  return String(s || '').replace(/\{\{([A-Z0-9_]+)\}\}/g, function (token, key) {
    if (!Object.prototype.hasOwnProperty.call(map, key)) {
      throw new Error('模板缺少替換值：' + key);
    }
    return String(map[key]);
  });
}
function extend_(a, b) { var o = {}; Object.keys(a).forEach(function (k) { o[k] = a[k]; }); Object.keys(b).forEach(function (k) { o[k] = b[k]; }); return o; }
function qstr_(s) { return JSON.stringify(String(s)); }
function jsArr_(arr) { return '[' + arr.map(qstr_).join(', ') + ']'; }
function itemsToJs_(items) {
  return '[\n' + items.map(function (it) {
    return '  { id: ' + qstr_(it.name) + ', unit: ' + qstr_(it.unit) + ', pricingMode: ' + qstr_(it.pricingMode) +
      ', price: ' + it.price + ', minAmount: ' + (it.minAmount || 0) + ', limit: ' + (it.limit || 0) + ' }';
  }).join(',\n') + '\n]';
}

// 是否有名額限制（用於建表規格文件）
function hasCapacity_(cfg) {
  if (Number(cfg.totalCapacity || 0) > 0) return true;
  return cfg.items.some(function(it){ return Number(it.limit || 0) > 0; });
}

// ── Notion 建表規格 + 專案 CLAUDE.md + 收尾清單 ──────────────
function buildSchemaDoc_(cfg) {
  var lines = ['# ' + cfg.EVENT_NAME + ' — Notion 建表規格', '',
    'DB ID：`' + (cfg.dbId || '（尚未建，請用產生器建或手動建）') + '`', '',
    '報名模式：`' + (cfg.registrationMode === 'family' ? '家庭代報' : '單人報名') + '`', '',
    '> 此版採單一 data source 模型；請勿在同一 DB 新增第二個 data source。', '',
    '## 固定欄', '',
    '| 欄位 | 型別 |', '|------|------|',
    '| 功德主 | title |', '| 報名編號 | rich_text |', '| 報名狀態 | select（有效／已取消） |', '| 取消時間 | date |', '| 電話 | phone_number |', '| 地址 | rich_text |'];
  if (cfg.registrationMode === 'family') {
    lines.push('| 聯絡人 | rich_text |', '| 家庭編號 | rich_text（同次送出的功德主共用） |');
  }
  if (cfg.hasGroup) lines.push('| ' + cfg.groupField + ' | select（' + cfg.groupOptions.join('／') + '） |');
  lines = lines.concat([
    '| 繳款方式 | select（' + cfg.payOptions.join('／') + '） |',
    '| 繳費狀況 | select（' + GEN.PAY_STATUS.join('／') + '，後台改） |',
    '| 匯款日期 | rich_text |',
    '| 帳號後五碼 | **rich_text**（絕不可 number，會吃前導 0） |',
    '| 匯款金額 | number |',
    '| 確認匯款? | checkbox |', '| 稽核 | checkbox |', '| 個資同意 | checkbox |',
    '| 備註 | rich_text |', '| 總金額 | number |', '| 報名時間 | date |', '',
    '## 品項欄（每項一個 Number）', '']);
  cfg.items.forEach(function (it) {
    var desc = it.pricingMode === 'free' ? '免費／數量' : (it.pricingMode === 'donation' ? '隨喜金額' :
      (it.pricingMode === 'minimum' ? '最低 ' + it.minAmount + ' 元' : it.price + ' 元／' + it.unit));
    lines.push('- ' + it.name + '（' + desc + '）→ Number');
  });
  if (cfg.customFields.length) {
    lines.push('', '## 自訂欄位', '');
    cfg.customFields.forEach(function(f){
      var notionType = f.type === 'text' ? 'rich_text' : f.type;
      lines.push('- ' + f.name + ' → ' + notionType + (f.required ? '（必填）' : '') +
        (f.type === 'select' ? '；選項：' + f.options.join('／') : ''));
    });
  }
  if (hasCapacity_(cfg)) {
    lines.push('', '## 名額限制', '', '- 總名額：' + (cfg.totalCapacity || '不限'));
    cfg.items.forEach(function(it){ if(it.limit) lines.push('- ' + it.name + '：上限 ' + it.limit + ' ' + it.unit); });
  }
  lines.push('', '## 報名時間與取消', '',
    '- 自動開放：' + (cfg.REGISTRATION_START ? cfg.REGISTRATION_START + '（台北時間）' : '未設定，部署後立即開放'),
    '- 自動截止：' + (cfg.REGISTRATION_END ? cfg.REGISTRATION_END + '（台北時間）' : '未設定'),
    '- `CONFIG.CLOSED = true` 是最高優先的手動截止開關。',
    '- 信眾取消時不刪除頁面；改為「報名狀態＝已取消」並寫入取消時間。已取消資料不計入名額與採購統計。');
  return lines.join('\n') + '\n';
}

function buildProjectClaudeMd_(cfg) {
  return [
    '# ' + cfg.EVENT_NAME + ' — 專案備忘（開專案先讀）',
    '',
    '由「宮廟共用報名表產生器」產出（數量×固定單價；' + (cfg.registrationMode === 'family' ? '家庭代報型' : '單人報名型') + '）。技術棧 GAS 直打 Notion（不經 n8n）。',
    '',
    '- EVENT：`' + cfg.EVENT + '`',
    '- 宮廟／主辦單位：`' + cfg.ORG_NAME + '`',
    '- 報名模式：`' + (cfg.registrationMode === 'family' ? '家庭代報（聯絡人＋多位功德主）' : '單人報名（一位功德主）') + '`',
    '- 繳款方式：`' + cfg.payOptions.join('／') + '`',
    '- 總名額：`' + (cfg.totalCapacity || '不限') + '`',
    '- 自訂欄位：`' + (cfg.customFields.length ? cfg.customFields.map(function(f){return f.name;}).join('／') : '無') + '`',
    '- Notion DB ID：`' + (cfg.dbId || '待建') + '`（存於 `Secrets.gs`，不注入前端）',
    '- 資料流：`index/report` → `google.script.run` → 伺服器端 `Code.gs` → `UrlFetchApp` 直打 Notion API。**不經 n8n**。',
    '- Script ID / 部署 ID：**待 clasp 建立後補**（若切換 Google 帳號，每個帳號各有一組，保存在 `.deploy-accounts/`）',
    '- 🔴 機密：`Secrets.gs` 放 Notion token 與 DB ID（純後端），`Config.gs` 放後台密碼；三者都只在伺服器端，index/report 前端一律不注入。',
    '',
    '## 品項（固定單價，唯一來源＝Config.gs 的 QTY_ITEMS）',
    cfg.items.map(function (it) { return '- ' + it.name + '：' + (it.pricingMode === 'free' ? '免費' : (it.pricingMode === 'donation' ? '隨喜金額' : (it.pricingMode === 'minimum' ? '最低 ' + it.minAmount + ' 元' : it.price + ' 元／' + it.unit))); }).join('\n'),
    '',
    '## 三頁 / 開關',
    '- doGet：無參數 → `CLOSED ? close : index`；`?page=form` 強制報名表；`?page=lookup` 信眾查詢／修改；`?page=close` 結束頁；`?page=report` 後台。',
    '- 活動結束：雙擊 `自動部署.bat` 選第 5 項一鍵切換截止／重新開放（自動改 `CONFIG.CLOSED` 並更新部署）；或手動改 `Config.gs` 的 `CONFIG.CLOSED = true` → `clasp push -f` → redeploy。',
    '',
    '## 收尾（見同資料夾產出時附的清單，或本檔下方）',
    buildChecklist_(cfg)
  ].join('\n') + '\n';
}

function buildChecklist_(cfg) {
  return [
    '### 人工收尾清單',
    '1. **解壓**到你自己的活動專案資料夾。',
    '2. **Notion**：DB 已由產生器建立（ID `' + (cfg.dbId || '待建') + '`）；沒建成就照 `Notion建表規格.md` 手動建、把 ID 填進 `Secrets.gs` 的 `NOTION_DB_ID_FALLBACK`。此版使用相容的單一 data source 模型，請勿在同一 DB 新增第二個 data source。**確認該 integration（token 對應的）已在此 DB 的 Connections 加入**，否則 GAS 打 Notion 會 401/404。',
    '3. **機密（Secrets.gs）**：Notion token 與 DB ID 已由產生器內嵌進 `Secrets.gs`（純後端、不注入前端）。若沒填成或要換：改 `NOTION_TOKEN_FALLBACK` / `NOTION_DB_ID_FALLBACK` 後重新 push。要更嚴格（不把 token 寫在原始碼）→ 部署後在 GAS 編輯器執行一次 `setupSecrets()` 把值搬進 Script Properties，再清空兩個 FALLBACK 常數重新部署。',
    '4. **GAS 部署（一鍵）**：解壓後**雙擊 `自動部署.bat`** → 選單選「首次建立並部署」；第一次會自動 `clasp create` + push + deploy 並記住部署 ID。要換 Google 帳號用選單第 2 項；每個帳號的 Script ID／部署 ID／網址會分開保存在 `.deploy-accounts/`，不會誤用上一個帳號。首次開網址會要求授權（因為 `UrlFetchApp` 打 Notion）。報名／查詢修改／後台網址會顯示並存到 `報名表網址.txt`／`報名查詢網址.txt`／`後台網址.txt`／`網址清單.txt`；選單第 5 項可切換截止／重新開放。🔴 對外部署一律自己確認過再上。',
    '5. **驗收**：submit 落地並回傳報名編號／重複報名被阻擋／免費、隨喜、最低金額計算正確／`?page=lookup` 可用編號＋電話查詢修改／report 超過 100 筆仍全量（伺服器端自動翻頁）／後台需密碼才進得去／`?page=close`、`?page=lookup`、`?page=report` 皆 200。',
    '6. 測試資料姓名一律填「測試資料請刪」，測完刪列。'
  ].join('\n');
}

// 從貼上的 Notion 頁面網址或 ID 擷取 32 碼 id（含/不含 dash 都可）
function extractNotionId_(s) {
  s = String(s || '').trim();
  var m = s.match(/[0-9a-fA-F]{32}/) || s.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  return m ? m[0] : s;
}
