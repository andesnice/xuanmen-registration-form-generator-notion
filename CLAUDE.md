# 玄門報名表產生器 — 專案備忘（開工先讀）

**這不是活動報名表，是「產生活動報名表的工具台」。** 私人用（access=MYSELF），部署一次長期重複用。
填活動標題／品項費用／Notion token → 建 Notion DB → 產出一整包可部署的活動專案（zip 下載）。

> **本產生器是 Notion 版（唯一版本）。** 產出的活動專案由 **GAS 直打 Notion API**（`UrlFetchApp`），新增／查詢／更新全在 GAS 伺服器端，**不再經 n8n**（2026-08-04 改版）。
> Sheets 後端已於 2026-07-23 整包移除；若需 Sheets 版，另見獨立專案 `_報名表產生器_Sheets版\`。

## 目前進度（最後更新：2026-09-20）

- **狀態**：2026-09-20 實查 `andesnice@gmail.com` 正式部署為 `AKfycbx9…` **@6**；修改前 16 個可部署檔與 @6 逐檔雜湊完全相同。這輪新增「產生器使用紀錄寫入 Notion2」程式與測試，**尚未 push／未 redeploy，正式版仍是 @6、尚未包含使用紀錄**。
- **2026-09-20 Notion2 使用紀錄（本機完成、外部設定未完成）**：`createDbApi` 與 `generateApi` 現在不論成功／失敗都嘗試寫入獨立的「報名表產生器使用紀錄」DB；記錄時間、使用者 Email、主辦單位、活動、動作、結果、版本與錯誤摘要，不保存 Token／後台密碼／ZIP。紀錄寫入失敗不阻擋主要操作，前端會顯示警告。憑證固定讀 Script Properties `REG_FORM_USAGE_LOG_NOTION_TOKEN`／`REG_FORM_USAGE_LOG_DATABASE_ID`，不沿用操作人輸入的活動 Token。回歸測試已覆蓋成功、失敗、機密不外洩及記錄失敗不影響主要結果。建表規格與設定見 `Notion2使用紀錄設定.md`。
- **目前卡點**：Codex 可用的 Notion 連線實際登入「玄門真宗」工作區，不是 Notion2／MyLife；讀取 MyLife 專案 data source `collection://3078db83-bd93-8069-ac23-000b7552909b` 回傳 404，因此未建立 DB、未填 Script Properties、未做真實寫入。必須先把 Notion 連線切到 Notion2，避免誤建到玄門工作區。
- **2026-08-28 新產出專案授權修正（靜態完成、未 push／未 redeploy）**：實際產出的「claude 開源社團」後台讀取 Notion 時出現 `UrlFetchApp.fetch` 缺少 `script.external_request` 權限。根因已確認為新 GAS 專案部署後，部署擁有者未在編輯器手動授權；Web App 不會可靠地自行跳授權視窗。`tmpl_Code.html` 已新增公開 `authorizeApp()`（唯讀 GET `/users/me`，並觸發 MailApp scope）及友善錯誤；產出的 `deploy.ps1`／`網址清單.txt` 已列 Apps Script 編輯器網址與「選 authorizeApp → 執行 → 允許」步驟；`Code.gs` 產出清單同步更正；回歸測試已覆蓋授權成功與缺權限訊息。現有已產出的專案仍須人工進 GAS 編輯器執行一次授權，重新產出前不會自動取得此函式。
- **2026-08-30 現場複驗**：舊產物執行 `checkSecrets()` 的執行記錄雖顯示完成，但沒有取得 `script.external_request`；改執行直接呼叫 `UrlFetchApp` 的 `authorizeApp()` 後，仍因先前細分授權漏授外部連線而直接報權限錯誤、未重開授權畫面。依 Google 官方 granular consent 做法，`tmpl_Code.html` 的 `authorizeApp()` 已改為先呼叫 `ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL)`，從 IDE 強制要求所有缺少權限，再做 Notion 唯讀連線。此修正已加回歸測試，仍未 push／未 redeploy；現有「claude」產物需人工在其 `authorizeApp()` 補同一行後再執行。使用者截圖亦露出完整 Notion token，該 token 必須輪替，且後續截圖不得包含 `Secrets.gs` 的 fallback 值。
- **2026-08-30 大眾化授權入口（靜態完成、未 push／未 redeploy）**：產出專案首次部署成功後，`deploy.ps1` 會自動開啟該專案的 Apps Script 編輯器；`自動部署.bat` 選單新增 `6. 首次授權／重新授權`，可隨時重開正確專案並顯示三步驟提示。客戶不用輸入或貼上程式碼，只需選 `authorizeApp`、按執行並由本人完成 Google「允許」。回歸測試與 PowerShell 語法／部署流程測試均已通過。
- **本次改動（2026-08-12，報名成功通知信；靜態完成、未 push）**：
  - **需求（使用者定案）**：submit 成功後寄確認信給**廟方＋信眾兩方**；並做「小優化」讓廟方與信眾**都能自選是否重寄**。Email 儲存採「加 Email 欄（rich_text，選填）」。
  - 🔴 **隔離約束「不要影響到原本可以驗證的部分」全程遵守**：① 寄信只在 submit 全部 Notion 寫入成功「之後」、包在**獨立 try/catch**、非阻擋（`tmpl_Code.html:312-314`）；② 預設 OFF；③ **NOTIFY 不進 `schemaKey_`**（開關通知信不需重建 DB）；④ **Email 欄一律建立**（`Code.gs:303`，`buildDbProperties_`），但 runtime 讀寫**gated 在 `CONFIG.NOTIFY.ENABLED`**（`fixedTxtFields_`）→ 未啟用時產出行為與改版前逐位元一致，中元四項驗收不受影響；⑤ SCHEMA_VERSION 2→3（加 Email 欄屬 schema 變更）。
  - **產生器端（`Code.gs`）**：`GEN.SCHEMA_VERSION:3`、`RESERVED_FIELDS`＋`Email`、`buildDbProperties_` 一律建 `Email` rich_text、`normalizeCfg_` 產 `NOTIFY:{ENABLED,ADMIN_EMAIL(逗號多筆),SEND_USER}`、`validateCfg_` 啟用時強制廟方 Email＋格式檢查、`buildFiles_` map 加 `NOTIFY_JS`、`savePresetApi` 存 `notifyEnabled/notifyAdminEmail/notifySendUser`、`buildSchemaDoc_`＋Email 列與「報名確認信」段、`buildChecklist_` 加第 7 項 Gmail 授權提醒。
  - **產出母版**：`tmpl_Config`（CONFIG.NOTIFY＋report/index 兩分支都注入 `NOTIFY_ON` 布林、ADMIN_EMAIL 絕不外流；用三元避免 `&` 被 tpl_ 轉義）、`tmpl_Utils`（`cleanEmail_`／`fmtMoney_`）、`tmpl_Code`（`notifyOnSubmit_`／`buildConfirmationMail_`／`sendMailSafe_`／`reportResendMailApi`／`publicResendMailApi`；submit 尾端呼叫；Email 併入 `fixedTxtFields_`／`reportUpdateApi`／`publicUpdateApi` 皆 gated）、`tmpl_index`（選填 Email 欄＋格式擋送）、`tmpl_report`（欄位＋編輯 Modal Email＋「寄給信眾／寄給廟方／兩者都寄」按鈕）、`tmpl_lookup`（信眾自助重寄卡，改 Email 會存回 Notion）。
  - **產生器 UI（`ui.html`）**：`notifyCard`（啟用 checkbox＋廟方 Email＋「同時寄給信眾」）＋`toggleNotify()`＋`basePayload/validatePayload/applyPreset` 串接。
  - **gas-test**：僅**靜態審查**（未實跑 `/exec`／未實打 Notion／MailApp），無嚴重問題；轉義坑已逐檔核對 rawTpl_/tpl_ 對應無誤；未發現新坑故未追加 PITFALLS。
- 🔴 **部署 ID（2026-08-05 更正）**：當前 clasp 專案 Script ID `16xE0nz3Kg0hwxlz4iQ4ulZx41mZCZ46e-noAaSW-icqqzn-QsB4ifSy_`、部署 `AKfycbx9UMfie4J0KNXudOD0yyEjmdkVT8c7T1MsYs0D--EVc0mjW2sP9P3ZzaApy11cPhmK2Q`。舊 `1NeweBw…`／`AKfycbylGbWP…` 是 n8n 舊版、**已作廢**。以 `.clasp.json`／`.deploy-id.txt`／`部署網址.txt` 為準。
- 🔴 **部署 ID 已更正（2026-08-05）**：8/04–8/05 改版時建了**全新 clasp 專案**（Script ID `16xE0nz3Kg0hwxlz4iQ4ulZx41mZCZ46e-noAaSW-icqqzn-QsB4ifSy_`、部署 `AKfycbx9UMfie4J0KNXudOD0yyEjmdkVT8c7T1MsYs0D--EVc0mjW2sP9P3ZzaApy11cPhmK2Q`），下方「部署資訊」舊記的 `1NeweBw…`／`AKfycbylGbWP…` 是 n8n 舊版、**已作廢**。以 `.clasp.json`／`.deploy-id.txt`／`部署網址.txt` 為準。
- **今日改動（2026-08-05，靜態改完、gas-test 過、未 push）**：
  1. **後台重新整理回饋**（`tmpl_report.html`）：`load()` 加 loading 態——按下「🔄 重新整理」→ 按鈕變灰＋文字「⏳ 讀取中…」＋`disabled` 防連按；完成還原按鈕，右側 `#lastSync` 顯示「✅ 已更新 HH:MM:SS（共 N 筆）」時間戳（時間戳每次跳動，資料沒變也看得出重整過）。失敗兩路都還原按鈕。
  2. **活動說明欄**（新功能，串 11 接點）：產生器 UI 加多行「活動說明」textarea（`id=eventDesc`，maxlength 1000），顯示在產出報名表標題下方一張說明卡（`#descCard`，`textContent`＋`white-space:pre-wrap` 保留換行、防 XSS）。改動檔：`ui.html`（欄位＋payload＋即時預覽 `#pvDesc`＋輸入監聽）、`Code.gs`（`normalizeCfg_` 收 `EVENT_DESC`、`buildFiles_` map 加 `EVENT_DESC_JS`）、`tmpl_Config.html`（`CONFIG.EVENT_DESC` ＋ **只在 index 分支**注入，後台不需要）、`tmpl_index.html`（說明卡＋顯示 JS）。非必填、不寫進 Notion（存 Config.gs）、`fill_()` 為 split/join 對特殊字元安全。preset 行為與 `eventDate/eventPlace` 對稱（存但不回填）。
  3. **換 logo 圖片（🏮→圖檔）——未動工，等圖檔**：已與使用者定案「只換 🏮 燈籠 logo、用使用者提供的圖檔轉 Base64 內嵌」。要換 3 處：`ui.html`（h1 標題＋預覽 `.pv-lamp`）、`tmpl_index.html`（`.lamp`）、`tmpl_close.html`（`.lamp`）。**卡在：使用者尚未提供 logo 圖檔**（建議 SVG 或 ≤30KB PNG）。拿到圖檔才動工。
- **8/04 改版已完成（附證據）**：
  - 新增 `tmpl_Secrets.html`（產出專案的機密元件，純後端）：`notionToken_()`／`notionDbId_()` 混合式取值（Script Properties 優先，回退產生器內嵌的 `NOTION_TOKEN_FALLBACK`／`NOTION_DB_ID_FALLBACK`）＋`setupSecrets()`／`checkSecrets()`。
  - `tmpl_Code.html` 整支改寫：`notionApi_`（UrlFetchApp 打 Notion）／`notionQueryAll_`（自動翻頁）／`formatRows_`／`submitApi`（移植原 n8n submit 全部驗證：功德主/電話/繳款/個資/所屬單位、逐人小計與必選、自訂欄位、匯款三欄、重複與名額檢查）／`reportUpdateApi`（PATCH，含家庭多筆）／`publicLookupApi`／`publicUpdateApi`／`capacityLoadApi`。移除 `n8nAdminCall_`。已加 `Utilities.sleep(350)` 節流避 429。
  - `tmpl_Utils.html` 加 Notion 屬性建構器 `p*_`／讀值器 `g*_`；`tmpl_Config.html` 移除 `N8N_BASE`／`N8N_ADMIN_KEY`／`SUBMIT_URL`；`tmpl_index.html` 送出改 `google.script.run.submitApi()`；`tmpl_report.html` 註解更新（呼叫點本來就走 `google.script.run`）。
  - 產出專案 `appsscript.json`＝`ANYONE_ANONYMOUS`＋`USER_DEPLOYING`（匿名可 `google.script.run`，`UrlFetchApp` 以擁有者跑）。
  - 產生器 `Code.gs`：`generateApi` 改由已存 Notion token 注入 `Secrets.gs`；`buildFiles_` 加 `Secrets.gs`、拿掉三支 `n8n-*.json`；刪 `buildSubmitWf_/buildReportWf_/buildUpdateWf_` 及 n8n helper；`normalizeCfg_/validateCfg_` 移除 n8n 檢查；`buildChecklist_/buildProjectClaudeMd_` 改成 GAS 直打 Notion＋Secrets.gs 收尾。
  - `ui.html`：移除「n8n Webhook Base」欄位／驗證／payload；token 說明更正為「會內嵌進 Secrets.gs、請用低權限 integration」。
- **🔴 修正 tmpl_Code getContent 轉義 bug（2026-08-05，已 push＋redeploy）**：`buildFiles_` 產出 `Code.gs` 原走 `fill_(tpl_('tmpl_Code'), map)`，但 `tmpl_Code` 是整支裸 JS（41 個 `<`、25 個 `>`），`getContent()` 會把裸 `<`/`>` 轉成 `&lt;`/`&gt;` → 產出的 `Code.gs` 整支 SyntaxError。改成 `fill_(rawTpl_('tmpl_Code'), map)`（`Code.gs:488`，Sheets 版早有此設計，改版漏帶）。已確認 `tmpl_Code` 無字面 entity、Utils/Config/Secrets 無裸 `<`/`>`（純 tpl_ 安全）、HTML 母版標籤/script 不受影響。已跑 gas-test（無嚴重問題）、補進 `gas-test\PITFALLS.md`。
- **進行中／卡在哪**：報名通知信程式面全部改完但**未 push／未 redeploy**（等使用者授權一起做）；換 logo 卡在使用者尚未給圖檔。
- **下一步（接手就從這裡開始）**：
  1. **產生器本體上線**：`clasp push -f` → `create-version "報名成功通知信＋產出專案授權引導"` → `redeploy AKfycbx9UMfie4J0KNXudOD0yyEjmdkVT8c7T1MsYs0D--EVc0mjW2sP9P3ZzaApy11cPhmK2Q --versionNumber N`（**對外 redeploy 前先問使用者**；或雙擊 `部署選單.bat` 選 1）。產生器只是把 `MailApp` 寫進產物文字，本體不會因此新增 Gmail scope；需要授權的是新產出的活動專案。
  2. 開產生器網址實跑：勾「報名成功後自動寄送確認信」、填廟方 Email →建 DB（確認新 DB 有 `Email` 欄）→產出 zip →解壓確認：`Config.gs` 有 `NOTIFY:{...}`＋`getClientConfig` 兩分支都有 `NOTIFY_ON`、`Code.gs` 有 `notifyOnSubmit_`／resend 兩支、`ui`/index/report/lookup 皆帶 Email 欄。並回歸確認 `Code.gs` 仍無 `&lt;`/`&gt;`。
  3. 部署產出專案並照中元四項驗收（submit 落地／後五碼前導 0／update 回讀／三頁 200）；**新增驗收**：submit 後廟方＋信眾各收到一封信；後台編輯視窗「寄給信眾／廟方／兩者都寄」三顆按鈕可用；lookup 信眾自助重寄且改 Email 會存回 Notion；**關閉通知信的活動產出行為與舊版一致**（Email 欄留空、不寄信）。測試資料填「測試資料請刪」測完刪列。
  4. （logo 圖檔到位後）完成 3 處 🏮 換圖，一併 push＋redeploy。
- **人工收尾（AI 做不到）**：每支新產出的活動專案須由部署擁有者在 Apps Script 編輯器執行 `authorizeApp()` 並允許權限；使用者提供 logo 圖檔；產生器 `clasp push`／redeploy、實打 Notion／MailApp 驗證、對外網址發佈。寄信有每日配額（一般帳號約 100 封／日）。

## 部署資訊（2026-08-05 更正為當前 clasp 專案）
- **Script ID**：`16xE0nz3Kg0hwxlz4iQ4ulZx41mZCZ46e-noAaSW-icqqzn-QsB4ifSy_`（`.clasp.json`）
- **部署 ID**：`AKfycbx9UMfie4J0KNXudOD0yyEjmdkVT8c7T1MsYs0D--EVc0mjW2sP9P3ZzaApy11cPhmK2Q`（2026-09-20 實查正式部署為 **@6**：`報名表產生器 2026-09-09 13:52`）
- **網址**：`https://script.google.com/macros/s/AKfycbx9UMfie4J0KNXudOD0yyEjmdkVT8c7T1MsYs0D--EVc0mjW2sP9P3ZzaApy11cPhmK2Q/exec`
- **access=MYSELF**：正式 @6 由 `andesnice@gmail.com` 擁有且只有擁有者能開；本體使用 `UrlFetchApp` 打 Notion，若 scope 有變更需在 GAS 編輯器手動執行函式完成授權，不能依賴首開 Web App 自動提示。
- 改版重新部署：`clasp push -f` → `clasp create-version "說明"`（得版本 N）→ `clasp redeploy AKfycbx9UMfie4J0KNXudOD0yyEjmdkVT8c7T1MsYs0D--EVc0mjW2sP9P3ZzaApy11cPhmK2Q --versionNumber N --description "說明"`（部署 ID 亦存於 `.deploy-id.txt`）
- ⚠️ **舊版（已作廢）**：n8n 版 Script `1NeweBw_7JKMpZePUr5WXG2Nxm10cX8uuTK6AS1aXSEIF-r_EJMivrWA7`／部署 `AKfycbylGbWP…`（@1–@4，2026-07-17～）——改版換了新 clasp 專案後不再使用，勿再 redeploy。
- **一鍵自動部署（推薦）**：雙擊 `部署選單.bat` → 選 1，會自動 `clasp push -f` + 重新部署到既有部署 ID（網址不變），完成後把網址寫進 `部署網址.txt`。詳見下方「自動部署」。

## 自動部署（bat/ps1，2026-07-23 從 Sheets 版移植）

兩層都有一鍵部署，都靠 `.deploy-id.txt` 記住部署 ID 來「網址不變地重新部署」：

**① 產生器本體（這個資料夾）**——給我自己更新產生器用：
| 檔 | 角色 |
|----|------|
| `部署選單.bat` | 啟動器（CRLF）：檢查 pwsh → 跑 `deployment-menu.ps1` |
| `deployment-menu.ps1` | 4 選單：1 部署／2 換帳號／3 看登入帳號／4 顯示網址 |
| `deploy.ps1` | 首次 `clasp create` standalone→改回 rootDir→`push -f`→`deploy -i <既有ID>`；網址寫入 `部署網址.txt` |
| `.deploy-id.txt` | 產生器自己的部署 ID（`AKfycbylGbWP...`）；選 1 會沿用它 redeploy、網址不變 |

> ⚠️ `.bat`/`.ps1`/`.txt` clasp 預設不推（只推 `.gs`/`.html`/`appsscript.json`），不影響產出。

**② 產出的活動專案（zip 內）**——由 3 支母版產生，給宮廟同工雙擊部署新報名表用：
| 產出檔 | 來源母版 | 角色 |
|--------|----------|------|
| `自動部署.bat` | `tmpl_auto_deploy_bat.html` | 啟動器 |
| `deployment-menu.ps1` | `tmpl_auto_deploy_menu.html` | 5 選單（多第 5 項：讀 `Config.gs` `CLOSED:`，一鍵截止／重開報名並 redeploy） |
| `deploy.ps1` | `tmpl_auto_deploy_ps1.html` | 同上部署流程；網址寫入 `報名表網址.txt`／`報名查詢網址.txt`／`後台網址.txt`／`網址清單.txt` |

> ⚠️ 3 支母版含 `<`／`>`／`&`／`2>&1`／`<#…#>`，`getContent()` 會 HTML 轉義，Code.gs 用 `rawTpl_()` 還原 5 種 entity（`&amp;` 最後還原）再輸出，故這 3 支也**必須 push 上 GAS**。

## 檔案結構
| 檔 | 角色 |
|----|------|
| `Code.gs` | 產生器本體：`doGet`(serve ui) ＋ `createDbApi`(打 Notion 建 DB) ＋ `generateApi`(組檔＋zip；把已存 Notion token 注入產出的 `Secrets.gs`)。**不再有 n8n workflow 產生器** |
| `ui.html` | 操作介面（`google.script.run` 呼叫上面兩支；base64→Blob 下載 zip） |
| `tmpl_Config/Code/Utils/Secrets/appsscript.html` | 產出專案的 5 個 `.gs`/json 母版（`{{TOKEN}}` 佔位；`Secrets` 放 Notion token＋DB ID，純後端） |
| `tmpl_index/report/close.html` | 資料驅動的報名表／後台／結束頁母版 |
| `tmpl_auto_deploy_bat/menu/ps1.html` | 產出專案的一鍵部署母版（bat＋5 選單 ps1＋deploy ps1，用 `rawTpl_()` 還原轉義） |
| `部署選單.bat`／`deployment-menu.ps1`／`deploy.ps1`／`.deploy-id.txt` | **產生器本體自己的**一鍵部署（見上方「自動部署」，clasp 不推） |
| `appsscript.json` | access=MYSELF、Asia/Taipei、V8 |
| `PLAYBOOK.md` | 產生 SOP（人工參考，clasp 不推） |

> ⚠️ 母版是用 `HtmlService.createHtmlOutputFromFile('tmpl_xxx').getContent()` 讀「原始內容」（**不 evaluate**），再 `{{TOKEN}}` 字串替換。所以 **12 支 `tmpl_*.html`**（`Config`／`Code`／`Utils`／`Secrets`／`appsscript` ＋ `index`／`lookup`／`report`／`close` ＋ `auto_deploy_bat`／`auto_deploy_menu`／`auto_deploy_ps1`）都必須 push 上 GAS，缺一支產出就少一檔。（改版後已無 n8n workflow 產生器，新增／查詢／更新全由產出的 `tmpl_Code` 內函式直打 Notion）

## 目前功能邊界
- 品項支援固定單價、隨喜金額、免費品項與最低金額，可選「一人一份」或「家庭代報」；家庭模式每位功德主一列，使用共同家庭編號與報名編號串連。
- 支援文字／下拉／勾選／日期自訂欄位、總名額與品項上限、家庭後台折疊分組。
- 支援以品項為條件顯示連動欄位、重複報名偵測，以及報名編號＋電話的自助查詢／修改。
- 產生器可用 `PropertiesService.getUserProperties()` 保存常用設定範本；嚴禁保存活動密碼、Notion token 或活動代碼。（Notion token 另存於獨立的「Notion 連線設定」，產出時注入 `Secrets.gs`。）
- 產出的活動專案沿用中元基準結構：三頁 index/report/close、匯款三必填欄＋確認匯款?/稽核、個資同意、繳款方式由 5 種共用選項中複選／繳款狀況 4 種、常數注入式。

## 產出後的人工收尾（產生器產的 zip 內 CLAUDE.md 也有一份）
1. 解壓到 `玄門\<活動名>\`。
2. Notion DB 已由產生器建好（沒建成才照 `Notion建表規格.md` 手動建、回填到 `Secrets.gs` 的 `NOTION_DB_ID_FALLBACK`）。**確認 token 對應的 integration 已加進該 DB 的 Connections**，否則 GAS 打 Notion 會 401/404。
3. 機密：Notion token 與 DB ID 已由產生器內嵌進 `Secrets.gs`（純後端）；要更嚴格可部署後執行一次 `setupSecrets()` 搬進 Script Properties，再清空兩個 FALLBACK 重新部署。**不再需要 n8n**。
4. GAS：**雙擊解壓出來的 `自動部署.bat` → 選 1**（自動 `clasp push -f` + 部署、印出前台／後台與 Apps Script 編輯器網址）；或手動 `clasp create-script` → `clasp push -f`。首次部署後依下方「首次授權規則」完成授權，再開報名表。對外正式上線前先問人。
5. 驗收照中元四項（submit 落地／後五碼前導 0／update 回讀／三頁 200），另測 lookup 查詢修改、名額限制、重複報名擋下。

### 每支產出專案的首次授權規則（必做）

- **每個新產出的 Apps Script 專案都要由該專案的部署擁有者授權一次**；產生器本體的授權不會繼承到產出的新專案。
- 修正版母版已在 `authorizeApp()` 內建 `ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL)`，所以日後產出的檔案**不用再手動貼授權程式碼**；但首次部署後仍必須在 Apps Script 編輯器選 `authorizeApp` →「執行」。
- 細分授權畫面須允許全部必要權限，尤其是「連線至外部服務」。第一次執行可能停在授權流程；允許後回到編輯器，再執行一次 `authorizeApp()`，直到顯示「執行完畢」，再重新整理後台。
- **同一專案日後 push／重新部署通常不用再授權**；只有新增 OAuth scope、換部署擁有者／Google 帳號、或曾撤銷授權時才需要重做。
- 不需要另建 Google Cloud 專案、API Key，也不需要重新上傳整包檔案。舊產物若尚未內建 `requireAllScopes`，才需在其 `authorizeApp()` 第一行手動補上。
- 大眾操作入口：首次部署成功後會自動開啟正確的 Apps Script 編輯器；若關掉或日後需要重授權，雙擊 `自動部署.bat` → 輸入 `6`，即可再次自動開啟正確專案並看到三步驟提示。使用者不需要輸入程式碼；只有 Google 的「允許」必須由帳號本人點擊。

## 待辦
- [ ] 產出一份新 zip，部署後由使用者在 GAS 編輯器執行 `authorizeApp()` 完成授權，再做端到端驗證（目前只做過靜態審查）。
- [ ] 產出後由 GAS 直打 Notion（含建 DB）端到端跑通一個真活動，才算 v1 驗收完成。
- [ ] Sheets 後端移除 ＋ 自動部署移植（2026-07-23）：碼已改、母版與本體部署檔已建，**尚未 `clasp push -f`／redeploy 到對外部署（等使用者授權後一起做）**。
