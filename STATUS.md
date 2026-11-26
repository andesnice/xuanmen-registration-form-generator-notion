# 報名表產生器（Notion 版）目前進度

最後核對：2026-11-25。此檔依 `D:/temples/玄門/_AI共用架構紀錄.md` 〇之五，是本專案的單一現況入口；專案 `CLAUDE.md` 開頭的舊版號／舊進度只是歷史紀錄，衝突時以本檔為準。

## 目前狀態：三層資料模型改版＋商品管理後台已 redeploy 上線 @13（尚未實打 Notion 驗證）

- **線上現況**：對外正式部署 **2026-11-26 已 redeploy 至 @13（三層資料模型＋商品管理後台）**，網址不變（`AKfycbx9…/exec`、access=MYSELF 只有擁有者能開）。commit `cc2e947` 已 push 到私有 repo `xuanmen-registration-form-generator-notion` 的 main。clasp 已重新登入（擁有者 `andesnice@gmail.com`），`invalid_grant` 已解除。
- 🔴 **仍未實打 Notion 端到端驗證**：@13 是「測試綠＋靜態審查」就上線的，沒有真的用它產一張三層表、建三層 DB、跑 submit／取消／後台改品項。上線≠已驗；依賴前請先產一張測試表驗過。
- **本輪完成的是「產生器本體改成一律產出三層資料模型」**：訂單主檔 ← 交易明細 → 商品檔（項目設定檔）。即使最單純的活動也走三層；只產新表，**沒有舊表遷移工具**。
- 三層定義：
  - **訂單主檔**（runtime `notionOrderDbId_()`）：一列＝一筆報名，`總金額` 是唯一財務真值，**沒有每品項的 Number 欄**。
  - **交易明細**（`notionDetailDbId_()`）：一列＝一張訂單裡的一個品項；relation 訂單／商品（single_property）＋品項名稱／計價模式／單價快照／數量／小計／狀態 快照。
  - **商品檔**（`notionItemDbId_()`）：一列＝一個可選品項；廟方在這裡加品項／停用品項，**不必重新產出報名表**（報名表即時讀 `啟用=true` 的列）。
  - 取消＝把 `報名狀態`／明細 `狀態` 設為 `已取消`，**永不刪列**。
- Notion token 與三個 DB ID 只放產出的 `Secrets.gs`（`notionToken_`／`notionOrderDbId_`／`notionDetailDbId_`／`notionItemDbId_`），**絕不注入任何前端頁面**。

## 已完成與已驗證（本機層級）

- **2026-11-26 新增「商品管理」後台功能（本機改完、測試綠、未 push／未 redeploy／未實打 Notion）**：
  - 需求：宮廟同工不必開 Notion，直接在後台網頁改價格／加品項／上下架。**三個資料庫架構不變、商品檔 10 個欄位不變，純 GAS 新增**（符合使用者「不修改資料庫架構，只修改 GAS」）。只適用於已是三層（有商品檔）的活動。
  - `tmpl_Code.html`（產出的 Code.gs）新增三支密碼門 API：`itemManageLoadApi`（讀商品檔全部品項，含停用，不走只回啟用的 `effectiveItems_`）、`itemCreateApi`（新增一列，品項名稱必填且擋同名）、`itemUpdateApi`（PATCH，只改有帶的欄位，上下架＝只帶 enabled）＋共用 `buildItemProperties_`。全部以 `CONFIG.REPORT_PASSWORD` 驗證、不回傳 token。
  - `tmpl_report.html`（產出的 report.html）新增「🏷 商品管理」分頁：可編輯表格（品項名稱／計價模式／單價／最低金額／單位／數量上限／排序/場次/啟用）＋每列「💾 儲存」＋「➕ 新增品項」；存檔後報名表即時讀到新價（報名表每次載入走 `itemsLoadApi`→商品檔，不必重新產出／部署）。
  - `SPEC.md`：補「商品管理（後台，密碼門）」介面契約段與第 7 條驗收。
  - gas-test：**靜態審查**（未實跑 `/exec`、未實打 Notion），無 🔴；`notionApi_` 已含 Bearer＋Notion-Version＋muteHttpExceptions，單筆寫入無批次迴圈故不需 sleep。
  - 測試：`node tests/notion-template-safety.tests.cjs` → `OK`。
  - 🔴 未驗：沒實際對三層 DB 跑過一次「後台改價→報名表讀到新價」；要等建好三層 DB＋clasp login 後才能端到端驗。
- **2026-11-26 兩個前端修正（本機改完、測試綠、未 push／未 redeploy）**：
  - 🐛 **送出前確認遮罩「- 未填院別」bug**：沒有「所屬單位」欄的活動，按送出後名字後面會多一個「- 未填院別」。根因在 `tmpl_index.html` 確認遮罩那一行——`CFG.GROUP_FIELD` 為 null 時 fallback 到字面字串 `'未填院別'`。改成有選才顯示院別、沒欄位就不加後綴（純畫面顯示，Notion 訂單主檔 title 本來就是乾淨 `entry.name`，資料未受影響）。
  - 🏷️ **去宮廟化文字**：產品已不限宮廟（可用在團購／活動報名／宮廟祈福）。把 `ui.html`、`tmpl_index.html` 裡「預設宮廟封面」「晨光山巒中的宮廟」等字樣改成中性（「預設封面」「活動封面主視覺」）。`宮廟祈福`保留為其中一個情境 preset；**預設封面圖經使用者 2026-11-26 拍板「圖不改」，維持現狀**。
  - 測試：`node tests/notion-template-safety.tests.cjs` → `OK`。這兩處是前端模板（HTML/JS 顯示＋文字），未動 GAS 伺服器端 Notion/UrlFetchApp 邏輯，gas-test 審查範圍不適用。
- **產生器 `Code.gs`**：`createThreeTierDbs_`（建 商品檔→訂單主檔→交易明細＋`seedItems_` 灌初始品項）、`buildItemDbProps_`／`buildOrderDbProps_`／`buildDetailDbProps_`（明細 relation 用 `single_property`）、`normalizeCfg_`／`validateCfg_` 收三個 DB ID（各驗 32 碼 hex）、`createDbCore_` 回傳 `{orderDbId, detailDbId, itemDbId}`。`SCHEMA_VERSION=4`、`REG_STATUS=['有效','已取消']`。
- **產出 runtime `tmpl_Code.html`**：`submitApi`（主檔先寫好總金額再逐品項寫明細）、`publicCancelApi`（先取消主檔、連帶取消其明細）、`capacityLoadApi`／名額檢查（讀有效明細數量）、`reportUpdateApi`＋`rebuildOrderDetails_`（品項異動重寫明細並回寫總金額）、`effectiveItems_`（即時讀商品檔、查不到退回 CONFIG 快照）。
- **`SPEC.md`**：已改寫為三層資料模型與介面契約。
- **測試（本機 vm／PowerShell，非實打 Notion）**：
  - `node tests/notion-template-safety.tests.cjs` → `OK`（整份已從單一 DB 改寫成三層契約：submit 寫 lock→query→order-write→detail-write→release、取消連帶取消明細、名額讀有效明細、產生器建三個 DB＋seed）。
  - `pwsh -NoProfile -File tests/deployment-profile.tests.ps1` → `OK`。
- **gas-test 靜態審查**（未實跑 `/exec`、未實打 Notion）：無 🔴；一個 🟡 ＝家庭模式 `匯款金額` 寫進每一列，與玄門「多筆展開型只記第一列」慣例不符（屬既有行為，非三層新引入）；其餘 🔵 見回報。

## 尚未驗證與卡點

- ~~clasp 登入失效~~ → 2026-11-26 已 `clasp login` 重新授權、已 redeploy @13。
- **整個三層改版都還沒實打 Notion 驗證**：沒有實際建過三層 DB、沒跑過一次真的 submit／取消／後台改品項。目前證據只到「本機 vm 測試全綠」，**@13 雖已上線但不等於線上會過**。
- `node tests/generator-local-smoke.tests.cjs` 本輪**未跑**：需要本機 GAS 模擬器在 port 3100，環境沒起這台（`fetch failed`）。
- 這一版尚未經 Codex 依 `SPEC.md` 驗收（本案採「Claude 寫、Codex 驗」）。

## 下一步（接手就從這裡開始）

1. 終端機 `clasp login` 重新授權（擁有者 `andesnice@gmail.com`）。
2. 交 Codex 依 `SPEC.md` 驗收三層改版（generator＋runtime）。
3. 建三層 Notion DB：先在法沿DB 建活動列，再建 商品檔／訂單主檔／交易明細；把三個 DB ID 回填產出專案的 `Secrets.gs`。
4. 本機模擬器端到端（起 port 3100）＋產一包真 zip，照中元四項驗收＋三層特有項（明細連帶取消、商品檔加列即生效、總金額＝明細小計總和）。測試資料姓名填「測試資料請刪」，測完刪列。
5. 🔴 對外 redeploy 既有部署 ID 前**先問使用者**；要不要處理 🟡 家庭 `匯款金額` 慣例，一併交 Codex。

## 人工收尾（AI 做不到）

- `clasp login`（擁有者本人授權）；對外 redeploy 核可；每支新產出專案由部署擁有者在 Apps Script 編輯器執行一次 `authorizeApp()`；Notion 把三個 DB 分享給 integration。

## 歷史紀錄（線上現況來源）

- **@12（意見回報外部連線授權檢查，2026-10-27）**＝目前對外線上版，單一 DB 模型＋頁內意見回饋彈窗（`submitFeedbackApi` 寫「宮廟客戶意見DB」`3a48db83bd93805eb572c02b1c9da2c2`）。匿名 GET 正式 `/exec` 回 200、頁面標題「通用活動報名表產生器」。提交 `dc7e381`，GitHub 分支 `agent/registration-safety-ui-workflow`。
- 更早：@11 雙欄版型＋宮廟封面；@10 新增建議填單彈窗；8/04–8/05 改版建新 clasp 專案（Script ID `16xE0nz3Kg0hwxlz4iQ4ulZx41mZCZ46e-noAaSW-icqqzn-QsB4ifSy_`、部署 `AKfycbx9UMfie4J0KNXudOD0yyEjmdkVT8c7T1MsYs0D--EVc0mjW2sP9P3ZzaApy11cPhmK2Q`）。舊 n8n 版 Script／部署已作廢。
