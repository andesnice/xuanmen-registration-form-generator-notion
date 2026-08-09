# 玄門報名表產生器 — 專案備忘（開工先讀）

**這不是活動報名表，是「產生活動報名表的工具台」。** 私人用（access=MYSELF），部署一次長期重複用。
填活動標題／品項費用／Notion token → 建 Notion DB → 產出一整包可部署的活動專案（zip 下載）。

> **本產生器是 Notion 版（唯一版本）。** 產出的活動專案由 **GAS 直打 Notion API**（`UrlFetchApp`），新增／查詢／更新全在 GAS 伺服器端，**不再經 n8n**（2026-08-04 改版）。
> Sheets 後端已於 2026-07-23 整包移除；若需 Sheets 版，另見獨立專案 `_報名表產生器_Sheets版\`。

## 目前進度（最後更新：2026-08-05）

- **狀態**：**已 `clasp push -f` ＋ redeploy 到當前部署 `AKfycbx9…` @2（網址不變），含：tmpl_Code 產出改走 `rawTpl_`（修正 `<`/`>` 被 getContent 轉義的嚴重 bug）＋後台重整回饋＋活動說明欄。gas-test 已過。⚠️ 換 logo 仍待圖檔；仍尚未實際產出過 zip 端到端驗證。**
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
- **進行中／卡在哪**：換 logo 卡在使用者尚未給圖檔（見今日改動第 3 項）；程式面皆已完成並上線。
- **下一步（接手就從這裡開始）**：
  1. （logo 圖檔到位後）完成 3 處 🏮 換圖 → `clasp push -f` → `create-version` → `redeploy AKfycbx9UMfie4J0KNXudOD0yyEjmdkVT8c7T1MsYs0D--EVc0mjW2sP9P3ZzaApy11cPhmK2Q --versionNumber N`（**對外 redeploy 前先問使用者**）。或雙擊 `部署選單.bat` 選 1。
  2. 開產生器網址（`AKfycbx9…/exec`）實跑一次：建 DB → 填一段活動說明 → 產出 zip → 解壓確認 **產出的 `Code.gs` 裡沒有 `&lt;`/`&gt;`（本次修正重點）**、含 `Secrets.gs`、無 `n8n-*.json`、`Config.gs` 有 `EVENT_DESC`、報名表標題下方出現說明卡。
  3. 部署產出專案（雙擊 `自動部署.bat`），照中元四項驗收：submit 落地／後五碼前導 0 不掉／update 回讀／三頁 200；另測 lookup 查詢修改、名額限制、重複報名擋下、後台重新整理有時間戳回饋。測試資料填「測試資料請刪」測完刪列。
- **人工收尾（AI 做不到）**：使用者提供 logo 圖檔；產生器與產出專案的 `clasp push`／redeploy、首開授權、實打 Notion 驗證、對外網址發佈。

## 部署資訊（2026-08-05 更正為當前 clasp 專案）
- **Script ID**：`16xE0nz3Kg0hwxlz4iQ4ulZx41mZCZ46e-noAaSW-icqqzn-QsB4ifSy_`（`.clasp.json`）
- **部署 ID**：`AKfycbx9UMfie4J0KNXudOD0yyEjmdkVT8c7T1MsYs0D--EVc0mjW2sP9P3ZzaApy11cPhmK2Q`（**現為 @2**：tmpl_Code 走 rawTpl_＋後台重整回饋＋活動說明欄；@1 2026-08-05 10:33 GAS 直打 Notion 改版首發）
- **網址**：`https://script.google.com/macros/s/AKfycbx9UMfie4J0KNXudOD0yyEjmdkVT8c7T1MsYs0D--EVc0mjW2sP9P3ZzaApy11cPhmK2Q/exec`
- **access=MYSELF**：只有 `chms277@chms.org.tw` 開得了；首開要授權（用 `UrlFetchApp` 打 Notion）。
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
4. GAS：**雙擊解壓出來的 `自動部署.bat` → 選 1**（自動 `clasp push -f` + 部署、印出前台／後台網址）；或手動 `clasp create-script` → `clasp push -f`。首開需授權（`UrlFetchApp` 打 Notion）。對外正式上線前先問人。
5. 驗收照中元四項（submit 落地／後五碼前導 0／update 回讀／三頁 200），另測 lookup 查詢修改、名額限制、重複報名擋下。

## 待辦
- [ ] 使用者首次開網址授權 → 實跑一次產出 zip 驗證（目前只做過靜態審查，尚未實際產出過）。
- [ ] 產出後由 GAS 直打 Notion（含建 DB）端到端跑通一個真活動，才算 v1 驗收完成。
- [ ] Sheets 後端移除 ＋ 自動部署移植（2026-07-23）：碼已改、母版與本體部署檔已建，**尚未 `clasp push -f`／redeploy 到對外部署（等使用者授權後一起做）**。
