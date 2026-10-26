// ═══════════════════════════════════════════════════════════
//  通用活動報名表產生器 — Code.gs
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
  SCHEMA_VERSION: 3,
  PUBLIC_MODE: true,
  BANK: { bank: '', acct: '', name: '' },
  PAY_OPTIONS: ['現金', '匯款', '刷卡', 'LinePay'],
  PAY_STATUS: ['未處理', '未繳款', '應收', '已繳款'],
  REG_STATUS: ['有效', '已取消'],
  GROUP_DEFAULT: ['本單位', '合作單位', '其他'],
  REGISTRATION_MODES: ['single', 'family'],
  CUSTOM_FIELD_TYPES: ['text', 'select', 'checkbox', 'date'],
  PRICING_MODES: ['fixed', 'donation', 'free', 'minimum'],
  PRESET_PREFIX: 'REG_FORM_PRESET_',
  NOTION_TOKEN_KEY: 'REG_FORM_NOTION_TOKEN',
  NOTION_PARENT_KEY: 'REG_FORM_NOTION_PARENT',
  USAGE_LOG_TOKEN_KEY: 'REG_FORM_USAGE_LOG_NOTION_TOKEN',
  USAGE_LOG_DB_KEY: 'REG_FORM_USAGE_LOG_DATABASE_ID',
  FEEDBACK_DB_ID: '3a48db83bd93805eb572c02b1c9da2c2',
  FEEDBACK_TYPES: ['功能建議', '操作問題', '錯誤回報', '其他'],
  RELEASE: 'public-v1',
  // Notion DB 固定文字/數字欄（品項欄另外動態加）
  TXT_FIELDS: ['地址', '匯款日期', '帳號後五碼', '備註', '報名編號'],
  RESERVED_FIELDS: ['功德主', '聯絡人', '家庭編號', '報名編號', '電話', '地址', '繳款方式', '繳費狀況', '匯款日期', '帳號後五碼',
    '匯款金額', '確認匯款?', '稽核', '個資同意', '備註', '總金額', '報名時間', '報名狀態', '取消時間', 'Email']
};

function doGet(e) {
  var page = String(e && e.parameter && e.parameter.page || '').trim();
  var isFeedback = page === 'feedback';
  var template = HtmlService.createTemplateFromFile(isFeedback ? 'feedback' : 'ui');
  template.APP_URL = ScriptApp.getService().getUrl() || '';
  if (!isFeedback) template.HERO_IMAGE_DATA = HtmlService.createHtmlOutputFromFile('hero_image').getContent().trim();
  return template.evaluate()
    .setTitle(isFeedback ? '意見回饋｜通用活動報名表產生器' : '通用活動報名表產生器')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ── 前端用 google.script.run 呼叫這兩支 ──────────────────────

// 建 Notion DB；活動總資料庫模式會先建立一筆活動頁面，再把報名 DB 建在該頁面底下。
function createDbApi(p) {
  var result;
  try {
    result = createDbCore_(p || {});
  } catch (err) {
    result = { ok: false, error: String(err) };
  }
  return attachUsageLog_(result, '建立資料庫', p);
}

function createDbCore_(p) {
  var savedNotion = GEN.PUBLIC_MODE ? { token: '', parentMode: '', parentTargetId: '' } : getSavedNotionSettings_();
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
    if (GEN.PUBLIC_MODE) return { ok: true, hasToken: false, parentMode: 'activity_database', parentTargetId: '', publicMode: true };
    var saved = getSavedNotionSettings_();
    return { ok: true, hasToken: !!saved.token, parentMode: saved.parentMode, parentTargetId: saved.parentTargetId };
  } catch (err) { return { ok: false, error: String(err) }; }
}

function saveNotionSettingsApi(p) {
  try {
    if (GEN.PUBLIC_MODE) return { ok: false, error: '公開版不會在伺服器儲存 Notion Token；請於本次操作直接輸入' };
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
    if (GEN.PUBLIC_MODE) return { ok: false, error: '公開版沒有共用的 Notion 連線設定可清除' };
    var props = PropertiesService.getUserProperties();
    props.deleteProperty(GEN.NOTION_TOKEN_KEY);
    props.deleteProperty(GEN.NOTION_PARENT_KEY);
    return { ok: true };
  } catch (err) { return { ok: false, error: String(err) }; }
}

// 唯讀檢查 Notion 連線；不建立頁面、不修改資料庫，也不把 token 回傳前端。
function checkNotionConnectionApi(p) {
  try {
    p = p || {};
    var saved = GEN.PUBLIC_MODE ? { token: '', parentMode: '', parentTargetId: '' } : getSavedNotionSettings_();
    var token = String(p.token || saved.token || '').trim();
    var parentMode = String(p.parentMode || saved.parentMode || 'activity_database').trim();
    var targetValue = p.parentTargetId || saved.parentTargetId || '';
    if (!token) return { ok: false, error: '請先輸入或儲存 Notion Integration Token' };
    if (token.length > 500) return { ok: false, error: 'Notion Integration Token 長度不正確' };
    if (parentMode !== 'page' && parentMode !== 'activity_database') return { ok: false, error: 'Notion 建立位置模式不正確' };
    var targetId = extractNotionId_(targetValue);
    if (!isNotionId_(targetId)) return { ok: false, error: parentMode === 'activity_database' ? '活動總資料庫網址或 ID 格式不正確' : '父頁面網址或 ID 格式不正確' };

    var identity = notionRequest_(token, 'get', '/users/me');
    if (!identity.ok) return { ok: false, error: notionConnectionError_(identity, 'Token') };

    var targetPath = parentMode === 'activity_database' ? '/databases/' + targetId : '/pages/' + targetId;
    var target = notionRequest_(token, 'get', targetPath);
    if (!target.ok) {
      // 404 時才唯讀探測另一種物件，讓使用者知道是否選錯「建立位置」。
      if (target.code === 404) {
        var alternatePath = parentMode === 'activity_database' ? '/pages/' + targetId : '/databases/' + targetId;
        var alternate = notionRequest_(token, 'get', alternatePath);
        if (alternate.ok) {
          return { ok: false, error: parentMode === 'activity_database'
            ? '這個目標是一般頁面，請把「建立位置」改成「直接指定父頁面」後再檢查'
            : '這個目標是資料庫，請把「建立位置」改成「活動總資料庫」後再檢查' };
        }
      }
      return { ok: false, error: notionConnectionError_(target, parentMode === 'activity_database' ? '活動總資料庫' : '父頁面') };
    }

    var checks = ['Token 有效' + (identity.data && identity.data.name ? '（Integration：' + identity.data.name + '）' : '')];
    var targetName = notionObjectTitle_(target.data);
    if (parentMode === 'activity_database') {
      var titleProp = findTitleProperty_(target.data && target.data.properties);
      if (!titleProp) return { ok: false, error: '已讀取活動總資料庫，但找不到 title 標題欄，無法新增活動紀錄' };
      var dbIdField = target.data.properties && target.data.properties['報名資料庫 ID'];
      if (dbIdField && dbIdField.type !== 'rich_text') return { ok: false, error: '已讀取活動總資料庫，但「報名資料庫 ID」欄必須是文字（rich_text）' };
      checks.push('已讀取活動總資料庫' + (targetName ? '：' + targetName : ''));
      checks.push('標題欄正常；' + (dbIdField ? '「報名資料庫 ID」欄型別正確' : '建表時會自動新增「報名資料庫 ID」欄'));
    } else {
      if (target.data && (target.data.archived || target.data.in_trash)) return { ok: false, error: '父頁面已封存或移到垃圾桶，請改用可編輯的 Notion 頁面' };
      checks.push('已讀取父頁面' + (targetName ? '：' + targetName : ''));
      checks.push('父頁面讀取權限正常；新增權限會在建表時確認');
    }
    checks.push('本次為唯讀檢查，沒有新增或修改 Notion 資料');
    return {
      ok: true,
      targetId: targetId,
      targetType: parentMode,
      targetName: targetName,
      integrationName: identity.data && identity.data.name ? String(identity.data.name) : '',
      checks: checks,
      note: 'Notion 不提供無寫入的 Insert／Update 權限測試；新增與更新權限會在實際建立資料庫時確認。'
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function notionConnectionError_(result, subject) {
  var code = result && result.code;
  if (code === 401) return subject + ' 驗證失敗：Token 無效、已重新產生或複製不完整，請回 Notion 重新 Copy';
  if (code === 403) return subject + ' 權限不足：請在 Integration 的 Capabilities 開啟 Read content，並確認你有權管理目標內容';
  if (code === 404) return '找不到' + subject + '：請確認已把它分享給這個 Integration，且 Token 與目標位於同一個工作區';
  if (code === 429) return 'Notion API 暫時過於頻繁，請稍候幾秒再檢查';
  return subject + '檢查失敗：' + ((result && result.error) || '未知錯誤');
}

function notionObjectTitle_(obj) {
  var parts = [];
  if (obj && Array.isArray(obj.title)) parts = obj.title;
  else if (obj && obj.properties) {
    var titleName = findTitleProperty_(obj.properties);
    if (titleName && obj.properties[titleName] && Array.isArray(obj.properties[titleName].title)) parts = obj.properties[titleName].title;
  }
  return parts.map(function (part) {
    return String((part && part.plain_text) || (part && part.text && part.text.content) || '');
  }).join('').trim();
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

// ── 產生器使用紀錄（獨立寫入 Notion2；失敗不阻擋主要操作）────
function getUsageLogSettings_() {
  var props = PropertiesService.getScriptProperties();
  return {
    token: String(props.getProperty(GEN.USAGE_LOG_TOKEN_KEY) || '').trim(),
    databaseId: extractNotionId_(props.getProperty(GEN.USAGE_LOG_DB_KEY) || '')
  };
}

function usageLogText_(value, maxLength) {
  value = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return value.slice(0, maxLength || 1000);
}

function usageLogRichText_(value, maxLength) {
  value = usageLogText_(value, maxLength);
  return { rich_text: value ? [{ type: 'text', text: { content: value } }] : [] };
}

function usageActorEmail_() {
  try { return String(Session.getActiveUser().getEmail() || '').trim(); } catch (ignore) { return ''; }
}

function logGeneratorUsage_(action, result, p) {
  try {
    var settings = getUsageLogSettings_();
    if (!settings.token || !isNotionId_(settings.databaseId)) {
      return { ok: false, error: '尚未設定 Notion2 使用紀錄 Token 或資料庫 ID' };
    }
    p = p || {};
    result = result || { ok: false, error: '未知結果' };
    var succeeded = result.ok === true;
    var eventName = usageLogText_(p.eventName || '', 200);
    var orgName = usageLogText_(p.orgName || '', 200);
    var actorEmail = usageActorEmail_();
    var title = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss') + '｜' + action + '｜' + (eventName || orgName || '未命名活動');
    var properties = {
      '紀錄名稱': { title: [{ type: 'text', text: { content: usageLogText_(title, 300) } }] },
      '使用時間': { date: { start: new Date().toISOString() } },
      '使用者 Email': { email: actorEmail || null },
      '主辦單位': usageLogRichText_(orgName, 200),
      '活動名稱': usageLogRichText_(eventName, 200),
      '活動代碼': usageLogRichText_(p.event || '', 100),
      '執行動作': { select: { name: action } },
      '執行結果': { select: { name: succeeded ? '成功' : '失敗' } },
      '產生器版本': usageLogRichText_(GEN.RELEASE, 100),
      '錯誤摘要': usageLogRichText_(succeeded ? '' : (result.error || '未知錯誤'), 1000)
    };
    var created = notionRequest_(settings.token, 'post', '/pages', {
      parent: { database_id: settings.databaseId },
      properties: properties
    });
    return created.ok ? { ok: true, pageId: created.data && created.data.id ? created.data.id : '' } : { ok: false, error: created.error };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function attachUsageLog_(result, action, p) {
  result = result && typeof result === 'object' ? result : { ok: false, error: '未知結果' };
  var logged = logGeneratorUsage_(action, result, p || {});
  if (!logged.ok) result.usageLogWarning = usageLogText_(logged.error || '未知錯誤', 500);
  return result;
}

// 在 Apps Script 編輯器手動執行，用來確認 Script Properties 與 Notion2 DB 權限。
function checkUsageLog() {
  var settings = getUsageLogSettings_();
  if (!settings.token) throw new Error('未設定 Script Property：' + GEN.USAGE_LOG_TOKEN_KEY);
  if (!isNotionId_(settings.databaseId)) throw new Error('未設定或格式錯誤：' + GEN.USAGE_LOG_DB_KEY);
  var checked = notionRequest_(settings.token, 'get', '/databases/' + settings.databaseId);
  if (!checked.ok) throw new Error(checked.error);
  var message = 'Notion2 使用紀錄資料庫連線正常';
  console.log(message);
  return message;
}

// 在 Apps Script 編輯器手動執行，實際寫入一筆可辨識的測試紀錄。
function testUsageLogWrite() {
  var logged = logGeneratorUsage_('產出專案', { ok: true }, {
    orgName: '系統測試',
    eventName: 'USAGE_LOG_GAS_TEST',
    event: 'USAGE_LOG_GAS_TEST'
  });
  if (!logged.ok) throw new Error(logged.error);
  var message = 'Notion2 使用紀錄測試寫入成功：' + (logged.pageId || '已建立');
  console.log(message);
  return message;
}

// ── 意見回饋（寫入指定的 Notion2 資料庫）───────────────────
function feedbackText_(value, maxLength) {
  value = String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .trim();
  return value.slice(0, maxLength || 1800);
}

function feedbackRichText_(value, maxLength) {
  value = feedbackText_(value, maxLength);
  return { rich_text: value ? [{ type: 'text', text: { content: value } }] : [] };
}

function feedbackPropertyType_(property) {
  return property && property.type ? String(property.type) : '';
}

function ensureFeedbackSchema_(token) {
  var checked = notionRequest_(token, 'get', '/databases/' + GEN.FEEDBACK_DB_ID);
  if (!checked.ok) return { ok: false, error: '讀取意見回饋資料庫失敗：' + checked.error };
  var properties = checked.data && checked.data.properties ? checked.data.properties : {};
  var titleProp = findTitleProperty_(properties);
  if (!titleProp) return { ok: false, error: '意見回饋資料庫找不到標題欄（title）' };

  var schema = {
    '回饋類型': { type: 'select', definition: { select: { options: GEN.FEEDBACK_TYPES.map(function (name) { return { name: name }; }) } } },
    '意見內容': { type: 'rich_text', definition: { rich_text: {} } },
    '相關功能': { type: 'rich_text', definition: { rich_text: {} } },
    '聯絡 Email': { type: 'email', definition: { email: {} } },
    '提交者 Email': { type: 'email', definition: { email: {} } },
    '提交時間': { type: 'date', definition: { date: {} } },
    '產生器版本': { type: 'rich_text', definition: { rich_text: {} } },
    '處理狀態': { type: 'select', definition: { select: { options: [{ name: '待處理' }, { name: '處理中' }, { name: '已完成' }] } } }
  };
  var additions = {};
  var names = Object.keys(schema);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    if (!properties[name]) {
      additions[name] = schema[name].definition;
    } else if (feedbackPropertyType_(properties[name]) !== schema[name].type) {
      return { ok: false, error: '意見回饋資料庫的「' + name + '」欄型別應為 ' + schema[name].type };
    }
  }
  if (Object.keys(additions).length) {
    var updated = notionRequest_(token, 'patch', '/databases/' + GEN.FEEDBACK_DB_ID, { properties: additions });
    if (!updated.ok) return { ok: false, error: '新增意見回饋欄位失敗：' + updated.error };
  }
  return { ok: true, titleProp: titleProp, addedFields: Object.keys(additions) };
}

// 在 Apps Script 編輯器手動執行，立即補齊指定 Notion2 回饋資料庫的欄位。
function setupFeedbackDatabase() {
  var settings = getUsageLogSettings_();
  if (!settings.token) throw new Error('未設定 Script Property：' + GEN.USAGE_LOG_TOKEN_KEY);
  var schema = ensureFeedbackSchema_(settings.token);
  if (!schema.ok) throw new Error(schema.error);
  var message = schema.addedFields.length
    ? 'Notion2 意見回饋資料庫欄位設定完成：' + schema.addedFields.join('、')
    : 'Notion2 意見回饋資料庫欄位已完整，無需新增';
  console.log(message);
  return message;
}

function submitFeedbackApi(p) {
  try {
    p = p || {};
    var type = feedbackText_(p.type || '', 20);
    var subject = feedbackText_(p.subject || '', 80);
    var content = feedbackText_(p.content || '', 1800);
    var relatedFeature = feedbackText_(p.relatedFeature || '', 100);
    var contactEmail = feedbackText_(p.contactEmail || '', 200);
    if (GEN.FEEDBACK_TYPES.indexOf(type) < 0) return { ok: false, error: '請選擇有效的回饋類型' };
    if (!content) return { ok: false, error: '請填寫意見內容' };
    if (String(p.content || '').length > 1800) return { ok: false, error: '意見內容最多 1800 字' };
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return { ok: false, error: '聯絡 Email 格式不正確' };

    var settings = getUsageLogSettings_();
    if (!settings.token) return { ok: false, error: '尚未設定 Notion2 使用紀錄 Token' };
    var schema = ensureFeedbackSchema_(settings.token);
    if (!schema.ok) return schema;

    var now = new Date();
    var actorEmail = usageActorEmail_();
    var titleText = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss') + '｜' + type + '｜' + (subject || content.slice(0, 30));
    var properties = {};
    properties[schema.titleProp] = { title: [{ type: 'text', text: { content: feedbackText_(titleText, 300) } }] };
    properties['回饋類型'] = { select: { name: type } };
    properties['意見內容'] = feedbackRichText_(content, 1800);
    properties['相關功能'] = feedbackRichText_(relatedFeature, 100);
    properties['聯絡 Email'] = { email: contactEmail || null };
    properties['提交者 Email'] = { email: actorEmail || null };
    properties['提交時間'] = { date: { start: now.toISOString() } };
    properties['產生器版本'] = feedbackRichText_(GEN.RELEASE, 100);
    properties['處理狀態'] = { select: { name: '待處理' } };
    var created = notionRequest_(settings.token, 'post', '/pages', {
      parent: { database_id: GEN.FEEDBACK_DB_ID },
      properties: properties
    });
    if (!created.ok) return { ok: false, error: '送出意見回饋失敗：' + created.error };
    return { ok: true, pageId: created.data && created.data.id ? created.data.id : '' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// 在 Apps Script 編輯器手動執行，唯讀確認指定的 Notion2 回饋資料庫可存取。
function checkFeedbackDatabase() {
  var settings = getUsageLogSettings_();
  if (!settings.token) throw new Error('未設定 Script Property：' + GEN.USAGE_LOG_TOKEN_KEY);
  var checked = notionRequest_(settings.token, 'get', '/databases/' + GEN.FEEDBACK_DB_ID);
  if (!checked.ok) throw new Error(checked.error);
  var message = 'Notion2 意見回饋資料庫連線正常';
  console.log(message);
  return message;
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
  var result;
  try {
    var cfg = normalizeCfg_(p);
    var validation = validateCfg_(cfg, true);
    if (validation) result = { ok: false, error: validation };
    else if (String(p.dbSchemaKey || '') !== schemaKey_(cfg)) result = { ok: false, error: '報名模式、繳款方式、自訂欄位、品項或所屬單位設定已在建表後變更，請重新建立 Notion DB' };
    else {
      var savedNotion = GEN.PUBLIC_MODE ? { token: '' } : getSavedNotionSettings_();
      var notionToken = String(p.token || savedNotion.token || '').trim();
      if (!notionToken) result = { ok: false, error: '缺 Notion API token：請在上方輸入 token（會內嵌進產出的 Secrets.gs，讓報名表 GAS 直打 Notion）' };
      else {
        cfg.NOTION_TOKEN = notionToken;
        var files = buildFiles_(cfg);
        var blobs = files.map(function (f) { return Utilities.newBlob(f.content, 'text/plain', f.name); });
        var zip = Utilities.zip(blobs, cfg.EVENT + '.zip');
        result = {
          ok: true,
          filename: cfg.EVENT + '.zip',
          zipB64: Utilities.base64Encode(zip.getBytes()),
          checklist: buildChecklist_(cfg)
        };
      }
    }
  } catch (err) {
    result = { ok: false, error: String(err) };
  }
  return attachUsageLog_(result, '產出專案', p);
}

// ── 常用設定範本（依目前 Google 使用者儲存）──────────────────
function listPresetsApi() {
  try {
    if (GEN.PUBLIC_MODE) return { ok: true, presets: [], publicMode: true };
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
    if (GEN.PUBLIC_MODE) return { ok: false, error: '公開版範本儲存在訪客自己的瀏覽器，不使用伺服器共用空間' };
    name = String(name || '').trim();
    if (!name || name.length > 40) return {ok:false,error:'範本名稱需為 1～40 字'};
    p = p || {};
    var cfg = normalizeCfg_(p);
    var data = {
      orgName:cfg.ORG_NAME,
      bankBank:cfg.BANK.bank, bankAcct:cfg.BANK.acct, bankName:cfg.BANK.name,
      themePrimary:cfg.THEME_PRIMARY, themeGold:cfg.THEME_GOLD, themeBg:cfg.THEME_BG, cardRadius:cfg.CARD_RADIUS,
      headerLayout:cfg.UI.HEADER_LAYOUT, fontSize:cfg.UI.FONT_SIZE, cardShadow:cfg.UI.CARD_SHADOW, submitLabel:cfg.UI.SUBMIT_LABEL,
      labels:{ person:cfg.LABELS.PERSON, contact:cfg.LABELS.CONTACT, items:cfg.LABELS.ITEMS, payment:cfg.LABELS.PAYMENT, note:cfg.LABELS.NOTE, total:cfg.LABELS.TOTAL },
      registrationMode:cfg.registrationMode, paymentOptions:cfg.payOptions,
      hasGroup:cfg.hasGroup, groupField:cfg.groupField, groupOptions:cfg.groupOptions,
      totalCapacity:cfg.totalCapacity, items:cfg.items, customFields:cfg.customFields,
      notifyEnabled:cfg.NOTIFY.ENABLED, notifyAdminEmail:cfg.NOTIFY.ADMIN_EMAIL, notifySendUser:cfg.NOTIFY.SEND_USER
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
    if (GEN.PUBLIC_MODE) return { ok: false, error: '公開版範本儲存在訪客自己的瀏覽器，不使用伺服器共用空間' };
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
    '報名時間': { date: {} },
    // 一律建立 Email 欄（通知信未啟用時留空即可）；如此日後在 Config 開啟通知信不需重建 DB。
    'Email': { rich_text: {} }
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
  var adminEmails = String(p.notifyAdminEmail || '').split(/[,，;；\s]+/)
    .map(function (s) { return s.trim(); }).filter(function (s) { return s; });
  var NOTIFY = { ENABLED: !!p.notifyEnabled, ADMIN_EMAIL: adminEmails.join(','), SEND_USER: p.notifySendUser == null ? true : !!p.notifySendUser };
  var rawLabels = p.labels || {};
  function uiLabel_(key, fallback) {
    var value = String(rawLabels[key] || fallback).trim();
    return value ? value.slice(0, 20) : fallback;
  }
  return {
    ORG_NAME: String(p.orgName || '').trim(),
    EVENT: String(p.event || '').trim().toLowerCase(),
    EVENT_NAME: String(p.eventName || '').trim(),
    BANK: bank,
    THEME_PRIMARY: hexColor_(p.themePrimary, '#8B0000'),
    THEME_GOLD: hexColor_(p.themeGold, '#C8922A'),
    THEME_BG: hexColor_(p.themeBg, '#F5F0E8'),
    CARD_RADIUS: [6,12,20].indexOf(Number(p.cardRadius)) >= 0 ? Number(p.cardRadius) : 12,
    UI: {
      HEADER_LAYOUT: ['centered','banner','poster'].indexOf(String(p.headerLayout)) >= 0 ? String(p.headerLayout) : 'centered',
      FONT_SIZE: Math.max(14, Math.min(22, parseInt(p.fontSize, 10) || (String(p.fontScale) === 'large' ? 18 : 16))),
      CARD_SHADOW: ['none','soft','strong'].indexOf(String(p.cardShadow)) >= 0 ? String(p.cardShadow) : 'soft',
      SUBMIT_LABEL: String(p.submitLabel || '送出報名').trim().slice(0,20)
    },
    LABELS: {
      PERSON: uiLabel_('person', '報名人'),
      CONTACT: uiLabel_('contact', '聯絡人'),
      ITEMS: uiLabel_('items', '報名項目'),
      PAYMENT: uiLabel_('payment', '付款方式'),
      NOTE: uiLabel_('note', '備註'),
      TOTAL: uiLabel_('total', '總金額')
    },
    PAGE_TITLE: String(p.pageTitle || (p.eventName + ' 報名')).trim(),
    REPORT_TITLE: [String(p.orgName || '').trim(), String(p.eventName || '活動').trim() + ' 後台'].filter(function(v){ return v; }).join('｜'),
    EVENT_DATE: String(p.eventDate || '').trim(),
    REGISTRATION_START: String(p.registrationStart || '').trim(),
    REGISTRATION_END: String(p.registrationEnd || '').trim(),
    EVENT_PLACE: String(p.eventPlace || '').trim(),
    EVENT_DESC: String(p.eventDesc || '').trim(),
    LOGO: normalizeLogo_(p.logo),
    REMIT_DEADLINE: String(p.remitDeadline || '').trim(),
    CLOSED_MSG: String(p.closedMsg || ('本次' + (p.eventName || '活動') + '報名已截止，<br>感謝您的參與。')).trim(),
    REPORT_PASSWORD: String(p.reportPassword || '').trim(),
    dbId: String(p.dbId || '').trim(),
    registrationMode: registrationMode,
    payOptions: payOptions,
    totalCapacity: Math.max(0, parseInt(p.totalCapacity, 10) || 0),
    customFields: customFields,
    hasGroup: hasGroup,
    groupField: String(p.groupField || '所屬單位').trim(),
    groupOptions: groupOptions,
    items: items,
    NOTIFY: NOTIFY
  };
}

function validateCfg_(cfg, requireDb) {
  if (!cfg.ORG_NAME) return '缺主辦單位名稱';
  if (!cfg.UI.SUBMIT_LABEL) return '送出按鈕文字不可留空';
  var labelKeys = ['PERSON','CONTACT','ITEMS','PAYMENT','NOTE','TOTAL'];
  for (var li=0;li<labelKeys.length;li++) if (!cfg.LABELS[labelKeys[li]]) return '畫面欄位名稱不可留空';
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
  if (cfg.NOTIFY && cfg.NOTIFY.ENABLED) {
    if (!cfg.NOTIFY.ADMIN_EMAIL) return '啟用報名通知信時，請填管理者收件 Email';
    var emails = cfg.NOTIFY.ADMIN_EMAIL.split(',');
    for (var e = 0; e < emails.length; e++) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emails[e].trim())) return '管理者 Email 格式不正確：' + emails[e];
    }
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
    NOTIFY_JS: JSON.stringify(cfg.NOTIFY || { ENABLED: false, ADMIN_EMAIL: '', SEND_USER: true }),
    THEME_PRIMARY: cfg.THEME_PRIMARY,
    THEME_GOLD: cfg.THEME_GOLD,
    THEME_BG: cfg.THEME_BG,
    CARD_RADIUS: String(cfg.CARD_RADIUS) + 'px',
    HEADER_LAYOUT: cfg.UI.HEADER_LAYOUT,
    FONT_SIZE: String(cfg.UI.FONT_SIZE) + 'px',
    CARD_SHADOW: cfg.UI.CARD_SHADOW,
    SUBMIT_LABEL_HTML: html_(cfg.UI.SUBMIT_LABEL),
    UI_JS: JSON.stringify(cfg.UI),
    LABELS_JS: JSON.stringify(cfg.LABELS),
    PERSON_LABEL_HTML: html_(cfg.LABELS.PERSON),
    CONTACT_LABEL_HTML: html_(cfg.LABELS.CONTACT),
    ITEMS_LABEL_HTML: html_(cfg.LABELS.ITEMS),
    PAYMENT_LABEL_HTML: html_(cfg.LABELS.PAYMENT),
    NOTE_LABEL_HTML: html_(cfg.LABELS.NOTE),
    TOTAL_LABEL_HTML: html_(cfg.LABELS.TOTAL),
    EVENT_NAME_HTML: html_(cfg.EVENT_NAME),
    CLOSED_MSG_HTML: closedHtml_(cfg.CLOSED_MSG),
    DEFAULT_HERO_IMAGE: tpl_('hero_image').trim(),
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
    '| 備註 | rich_text |', '| 總金額 | number |', '| 報名時間 | date |',
    '| Email | rich_text（報名確認信收件人；未啟用通知信時留空即可） |', '',
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
  if (cfg.NOTIFY && cfg.NOTIFY.ENABLED) {
    lines.push('', '## 報名確認信', '',
      '- 已啟用：報名成功後由 GAS（`MailApp`，以部署擁有者身分）寄出確認信。',
      '- 管理者收件：`' + cfg.NOTIFY.ADMIN_EMAIL + '`',
      '- 是否同時寄給報名人：`' + (cfg.NOTIFY.SEND_USER ? '是（報名人有填 Email 才寄）' : '否') + '`',
      '- 後台可對單筆一鍵重寄（寄給報名人／管理者／兩者）；報名人亦可在查詢頁自助重寄。',
      '- ⚠️ 首次部署後請由部署擁有者在 Apps Script 編輯器執行 `authorizeApp()` 並允許權限；同一次授權會涵蓋 Notion 外部連線與 Gmail 寄信。Web App 不會可靠地自行跳出授權視窗。');
  }
  lines.push('', '## 報名時間與取消', '',
    '- 自動開放：' + (cfg.REGISTRATION_START ? cfg.REGISTRATION_START + '（台北時間）' : '未設定，部署後立即開放'),
    '- 自動截止：' + (cfg.REGISTRATION_END ? cfg.REGISTRATION_END + '（台北時間）' : '未設定'),
    '- `CONFIG.CLOSED = true` 是最高優先的手動截止開關。',
    '- 報名人取消時不刪除頁面；改為「報名狀態＝已取消」並寫入取消時間。已取消資料不計入名額與採購統計。');
  return lines.join('\n') + '\n';
}

function buildProjectClaudeMd_(cfg) {
  return [
    '# ' + cfg.EVENT_NAME + ' — 專案備忘（開專案先讀）',
    '',
    '由「通用活動報名表產生器」產出（數量×固定單價；' + (cfg.registrationMode === 'family' ? '家庭代報型' : '單人報名型') + '）。技術棧 GAS 直打 Notion（不經 n8n）。',
    '',
    '- EVENT：`' + cfg.EVENT + '`',
    '- 主辦單位：`' + cfg.ORG_NAME + '`',
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
    '- doGet：無參數 → `CLOSED ? close : index`；`?page=form` 強制報名表；`?page=lookup` 報名人查詢／修改；`?page=close` 結束頁；`?page=report` 後台。',
    '- 活動結束：雙擊 `自動部署.bat` 選第 5 項一鍵切換截止／重新開放（自動改 `CONFIG.CLOSED` 並更新部署）；或手動改 `Config.gs` 的 `CONFIG.CLOSED = true` → `clasp push -f` → redeploy。',
    '',
    '## 首次授權（每個新 Apps Script 專案必做一次）',
    '- 產生器本體的授權不會繼承到本專案；首次部署後必須由本專案的部署擁有者，在 Apps Script 編輯器執行一次 `authorizeApp()`。',
    '- `authorizeApp()` 已內建 `ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL)`，不用手動貼授權程式碼。細分授權畫面須允許全部必要權限，尤其是「連線至外部服務」。',
    '- 第一次執行可能停在授權流程；允許後回到編輯器，再執行一次 `authorizeApp()`，直到顯示「執行完畢」，再重新整理後台。',
    '- 同一專案日後 push／重新部署通常不用重做；只有新增 OAuth scope、換部署擁有者／Google 帳號、或曾撤銷授權時才需要再次授權。',
    '- 不需要另建 Google Cloud 專案、API Key，也不需要重新上傳整包檔案。',
    '- 大眾操作入口：首次部署成功後會自動開啟正確的 Apps Script 編輯器；若關掉或日後需要重授權，雙擊 `自動部署.bat` → 輸入 `6`，即可再次自動開啟正確專案並看到三步驟提示。不需要輸入程式碼；只有 Google 的「允許」必須由帳號本人點擊。',
    '',
    '## 收尾（見同資料夾產出時附的清單，或本檔下方）',
    buildChecklist_(cfg)
  ].join('\n') + '\n';
}

function buildChecklist_(cfg) {
  var mailNote = (cfg.NOTIFY && cfg.NOTIFY.ENABLED)
    ? ['7. **報名確認信**：本活動已啟用通知信（管理者 `' + cfg.NOTIFY.ADMIN_EMAIL + '`' + (cfg.NOTIFY.SEND_USER ? '，並寄報名人' : '') + '）。首次部署後務必由部署擁有者在 Apps Script 編輯器執行 `authorizeApp()` 並允許權限；同一次授權會涵蓋 Notion 外部連線與 Gmail 寄信。未授權時寄信會失敗（但不影響報名落地）。寄信有每日配額（一般帳號約 100 封／日）。']
    : [];
  return [
    '### 人工收尾清單',
    '1. **解壓**到你自己的活動專案資料夾。',
    '2. **Notion**：DB 已由產生器建立（ID `' + (cfg.dbId || '待建') + '`）；沒建成就照 `Notion建表規格.md` 手動建、把 ID 填進 `Secrets.gs` 的 `NOTION_DB_ID_FALLBACK`。此版使用相容的單一 data source 模型，請勿在同一 DB 新增第二個 data source。**確認該 integration（token 對應的）已在此 DB 的 Connections 加入**，否則 GAS 打 Notion 會 401/404。',
    '3. **機密（Secrets.gs）**：Notion token 與 DB ID 已由產生器內嵌進 `Secrets.gs`（純後端、不注入前端）。若沒填成或要換：改 `NOTION_TOKEN_FALLBACK` / `NOTION_DB_ID_FALLBACK` 後重新 push。要更嚴格（不把 token 寫在原始碼）→ 部署後在 GAS 編輯器執行一次 `setupSecrets()` 把值搬進 Script Properties，再清空兩個 FALLBACK 常數重新部署。',
    '4. **GAS 部署（一鍵）**：解壓後**雙擊 `自動部署.bat`** → 選單選「首次建立並部署」；第一次會自動 `clasp create` + push + deploy 並記住部署 ID。要換 Google 帳號用選單第 2 項；每個帳號的 Script ID／部署 ID／網址會分開保存在 `.deploy-accounts/`，不會誤用上一個帳號。🔴 **每個新 Apps Script 專案首次部署後都必須授權一次**：開啟 `網址清單.txt` 內的編輯器網址，選 `authorizeApp` →「執行」→在細分授權畫面允許全部必要權限（尤其「連線至外部服務」）→回編輯器再執行一次，直到顯示「執行完畢」。母版已內建 `requireAllScopes`，不用再貼程式碼；同一專案日後重新部署通常不用重做。未授權時後台讀取 Notion 會失敗。報名／查詢修改／後台網址會顯示並存到 `報名表網址.txt`／`報名查詢網址.txt`／`後台網址.txt`／`網址清單.txt`；選單第 5 項可切換截止／重新開放。🔴 對外部署一律自己確認過再上。',
    '5. **驗收**：submit 落地並回傳報名編號／重複報名被阻擋／免費、隨喜、最低金額計算正確／`?page=lookup` 可用編號＋電話查詢修改／report 超過 100 筆仍全量（伺服器端自動翻頁）／後台需密碼才進得去／`?page=close`、`?page=lookup`、`?page=report` 皆 200。',
    '6. 測試資料姓名一律填「測試資料請刪」，測完刪列。'
  ].concat(mailNote).join('\n');
}

// 從貼上的 Notion 頁面網址或 ID 擷取 32 碼 id（含/不含 dash 都可）
function extractNotionId_(s) {
  s = String(s || '').trim();
  var m = s.match(/[0-9a-fA-F]{32}/) || s.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  return m ? m[0] : s;
}
