# 報名表產生器（Notion 版）目前進度

最後核對：2026-10-26。此檔依 `D:/temples/玄門/_AI共用架構紀錄.md` 〇之五，作為本專案的現況入口；專案 `CLAUDE.md` 開頭的舊版號只是歷史紀錄。

## 目前狀態：正式部署 @11，公開瀏覽仍待驗證

- 使用者確認既有母版版型不符原需求：桌機應左側活動圖片與宣傳文案、右側報名欄位。舊 `tmpl_index.html` 是 560px 單欄，之前的「已修改報名表 UI」只指通用化設定，不能代表此版型完成。
- 報名表母版已改為桌機左主視覺與活動文案、右三步驟填單，手機上下排列與浮動報名鈕，並依共用架構〇之一加入送出前確認遮罩；產生器預覽同步。
- 使用者提供 `login-temple.jpg`，已設為產生器首頁與產出的報名表 `index.html` 預設封面。活動另上傳主圖時可覆蓋。`hero_image.html` 內嵌相同圖片，避免正式 GAS 對外依賴本機檔案。
- 本機安全模式產生器 `http://127.0.0.1:3100/` 與示範報名表 `http://127.0.0.1:3101/` 均 HTTP 200，已核對輸出 HTML 的左右欄、同一張圖片與示範活動標題。尚未取得瀏覽器截圖；本機預覽 HTML 留在 `.gas-local/`。
- 2026-10-26 使用者明確要求 redeploy 後，已新增 `.claspignore` 排除本機模擬器產物，確認 `clasp` 只追蹤 18 個正式檔；`clasp push -f` 成功，另在乾淨暫存資料夾 `clasp pull` 回查照片、首頁、報名表母版與確認遮罩。既有正式部署 ID `AKfycbx9UMfie4J0KNXudOD0yyEjmdkVT8c7T1MsYs0D--EVc0mjW2sP9P3ZzaApy11cPhmK2Q` 已更新為 **@11「報名表雙欄版型與宮廟封面」**，`clasp list-deployments` 與 `list-versions` 回查一致。

## 已完成與已驗證

- 產生器主畫面 `ui.html` 新增「💡 建議 / 意見回饋」按鈕與頁內填單，沿用 `Code.gs` 的 `submitFeedbackApi` 寫入「宮廟客戶意見DB」（ID `3a48db83bd93805eb572c02b1c9da2c2`）。本次建議功能沒有改產出的報名表或後台母版；前一批通用化改版曾改過這兩份母版。
- 建議功能已提交並推送到 GitHub 分支 `agent/registration-safety-ui-workflow`，提交 `16b1d2d`。2026-10-26 回查遠端分支指向同一提交。
- `node tests/notion-template-safety.tests.cjs`、`pwsh -NoProfile -File tests/deployment-profile.tests.ps1`、本機安全模式的 `node tests/generator-local-smoke.tests.cjs` 均通過；本機主頁 HTTP 200，含建議按鈕與填單。
- 前一版 @10「新增建議填單彈窗」已部署於同一正式部署 ID；本輪 @11 是後續更新。Apps Script Deployments API 先前回報正式 Web App 設定為 `ANYONE_ANONYMOUS`／`USER_DEPLOYING`，本輪尚未重查 API 設定。

## 尚未驗證與卡點

- 本輪 @11 redeploy 後，再從命令列匿名開正式 `/exec`，Google 仍回「需要存取權」HTTP 403；@10 時已有相同現象。故**不能宣稱公開訪客已可使用**。需以擁有者瀏覽器核對 Apps Script 授權與正式畫面，再用未登入視窗複驗。電腦操作工具先前無法可靠判定 Chrome 網址，尚未取得正式畫面截圖。
- 尚未在正式頁點送一筆建議並回讀 Notion。`clasp run checkFeedbackDatabase` 先前回 `NOT_FOUND`，這只表示目前無可執行的 Apps Script API 部署，不能當成 Notion 資料庫錯誤。既有 `Notion2使用紀錄設定.md` 記錄過 @8 的意見回饋資料庫欄位初始化成功，@11 尚未重新實測。
- Codex 的 Notion 連線已在本輪唯讀取得 MyLife 的「通用活動報名表產生器」專案頁及「宮廟客戶意見DB」，並核對後者有填單使用的欄位與選項；這只能證明連線與資料庫結構，不能證明正式 GAS 的 Script Property 或寫入權限。
- MyLife 專案頁前一輪已追加 @10 進度並將狀態改為「卡住」；任務「報名表產生器-驗證 @10 建議填單正式可用」仍待無痕瀏覽器實查。@11 的日誌與任務狀態待本輪回寫；新版截圖尚未取得。
- 專案 `CLAUDE.md` 仍有上一個 Claude session 留下的未提交進度編輯，並有舊版號與「私人用」文字；Codex 依使用者規則維持唯讀，未修改該檔。

## 下一步

1. 用一般瀏覽器分別以擁有者與未登入狀態打開正式 `/exec`，確認 Google 存取權頁面的來源；核對能否看見建議按鈕並開啟填單。
2. 若正式頁可操作，實送標記清楚的測試建議並回讀「宮廟客戶意見DB」，確認內容、類型、時間與狀態；若仍遭拒，先處理 Web App 實際存取權或擁有者授權，再驗回饋寫入。
3. 取得桌機與手機版彈窗截圖並附入對應 Notion2 專案日誌；同步任務狀態。此輪已確認 Codex Notion 連線可讀取正確的 MyLife 專案頁與回饋 DB。
