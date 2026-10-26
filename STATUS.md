# 報名表產生器（Notion 版）目前進度

最後核對：2026-10-26。此檔依 `D:/temples/玄門/_AI共用架構紀錄.md` 〇之五，作為本專案的現況入口；專案 `CLAUDE.md` 開頭的舊版號只是歷史紀錄。

## 已完成與已驗證

- 產生器主畫面 `ui.html` 新增「💡 建議 / 意見回饋」按鈕與頁內填單，沿用 `Code.gs` 的 `submitFeedbackApi` 寫入「宮廟客戶意見DB」（ID `3a48db83bd93805eb572c02b1c9da2c2`）。本次建議功能沒有改產出的報名表或後台母版；前一批通用化改版曾改過這兩份母版。
- 建議功能已提交並推送到 GitHub 分支 `agent/registration-safety-ui-workflow`，提交 `16b1d2d`。2026-10-26 回查遠端分支指向同一提交。
- `node tests/notion-template-safety.tests.cjs`、`pwsh -NoProfile -File tests/deployment-profile.tests.ps1`、本機安全模式的 `node tests/generator-local-smoke.tests.cjs` 均通過；本機主頁 HTTP 200，含建議按鈕與填單。
- 使用擁有者帳號登入的 `clasp`，已把 17 個可部署檔推到 Script ID `16xE0nz3Kg0hwxlz4iQ4ulZx41mZCZ46e-noAaSW-icqqzn-QsB4ifSy_`，並把既有正式部署 ID `AKfycbx9UMfie4J0KNXudOD0yyEjmdkVT8c7T1MsYs0D--EVc0mjW2sP9P3ZzaApy11cPhmK2Q` 更新為 **@10「新增建議填單彈窗」**；`clasp list-deployments` 與 `list-versions` 已回查。Apps Script Deployments API 回報正式 Web App 設定為 `ANYONE_ANONYMOUS`／`USER_DEPLOYING`。

## 尚未驗證與卡點

- 從命令列匿名開正式 `/exec` 得到 Google「需要存取權」HTTP 403；`@HEAD` 開發部署在相同方式下導向 Google 登入頁。故**不能宣稱公開訪客已可使用**。需從一般瀏覽器核對實際畫面與登入狀態；目前電腦操作工具無法可靠判定 Chrome 網址，已自動停止，未做人工畫面點擊驗收，也未拍本次彈窗截圖。
- 尚未在正式頁點送一筆建議並回讀 Notion。`clasp run checkFeedbackDatabase` 回 `NOT_FOUND`，這只表示目前無可執行的 Apps Script API 部署，不能當成 Notion 資料庫錯誤。既有 `Notion2使用紀錄設定.md` 記錄過 @8 的意見回饋資料庫欄位初始化成功，@10 尚未重新實測。
- Codex 的 Notion 連線已在本輪唯讀取得 MyLife 的「通用活動報名表產生器」專案頁及「宮廟客戶意見DB」，並核對後者有填單使用的欄位與選項；這只能證明連線與資料庫結構，不能證明正式 GAS 的 Script Property 或寫入權限。
- MyLife 專案頁已追加 2026-10-26 白話進度並將狀態改為「卡住」；已建立且回讀任務「報名表產生器-驗證 @10 建議填單正式可用」（狀況「未回覆」），等待無痕瀏覽器實查結果。新版截圖尚未取得，因此未附圖。
- 專案 `CLAUDE.md` 仍有上一個 Claude session 留下的未提交進度編輯，並有舊版號與「私人用」文字；Codex 依使用者規則維持唯讀，未修改該檔。

## 下一步

1. 用一般瀏覽器分別以擁有者與未登入狀態打開正式 `/exec`，確認 Google 存取權頁面的來源；核對能否看見建議按鈕並開啟填單。
2. 若正式頁可操作，實送標記清楚的測試建議並回讀「宮廟客戶意見DB」，確認內容、類型、時間與狀態；若仍遭拒，先處理 Web App 實際存取權或擁有者授權，再驗回饋寫入。
3. 取得桌機與手機版彈窗截圖並附入對應 Notion2 專案日誌；同步任務狀態。此輪已確認 Codex Notion 連線可讀取正確的 MyLife 專案頁與回饋 DB。
