# 報名表產生器（Notion 版）目前進度

最後核對：2026-10-27。此檔依 `D:/temples/玄門/_AI共用架構紀錄.md` 〇之五，作為本專案的現況入口；專案 `CLAUDE.md` 開頭的舊版號只是歷史紀錄。

## 2026-10-27 意見回報與連線檢查故障

- 使用者提供兩張正式畫面截圖：意見填單顯示「讀取意見回饋資料庫失敗」，一鍵檢查連線顯示「Token檢查失敗」；兩處的底層例外都明列 `UrlFetchApp.fetch` 缺少 `https://www.googleapis.com/auth/script.external_request` 授權。故已定位為 GAS 部署身分尚未授予外部請求權限，請求在 Notion API 前就中斷；改由 GAS 呼叫 n8n 也無法避開該權限。參照 `gas-test/PITFALLS.md` 2026-08-20、08-30 的既有實例。
- `Code.gs` 已新增唯讀 `authorizeApp()`：先執行 `ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL)`，再讀取回饋資料庫。`tests/notion-template-safety.tests.cjs` 已加授權閘門與唯讀請求測試，執行通過。使用者回報「目前是正常的」後，實查已有資料寫入，表示正式執行身分已能呼叫外部服務。
- `clasp` 後續回 `invalid_grant / invalid_rapt`，已重新登入 `andesnice@gmail.com`。`clasp push -f` 成功推送 18 檔；乾淨暫存資料夾 `clasp pull` 回讀的 `Code.js` 與本機 `Code.gs` 內容一致。已建立版本 12，將原正式部署更新為 **@12「意見回報外部連線授權檢查」**；`list-deployments` 回查一致。電腦操作工具查看登入視窗逾時，未代替使用者點授權。
- 使用者回報正常後，唯讀查「宮廟客戶意見DB」出現 2026-10-27 12:56（台北時間）的新資料，類型「功能建議」、內容「1」、狀態「待處理」、版本 `public-v1`，頁面 ID `4068db83bd9381178738e2046f0d89b8`。匿名命令列 GET 正式 `/exec` 現回 HTTP 200 且頁面標題為「通用活動報名表產生器」，`?page=feedback` 也回意見頁標題；兩頁均含 `submitFeedbackApi`。本輪未取得自動化瀏覽器截圖。
- 程式、測試與進度提交 `dc7e381` 已回查同步到 GitHub 分支 `agent/registration-safety-ui-workflow`。MyLife 專案頁已追加本輪日誌並改「進行中」；任務改為「補 @12 正式畫面截圖」、狀況「進行中」，兩頁已回讀。正式功能驗證完成，截圖待補。

## 目前狀態：正式部署 @12，意見回報寫入與公開頁面已驗證

- 使用者確認既有母版版型不符原需求：桌機應左側活動圖片與宣傳文案、右側報名欄位。舊 `tmpl_index.html` 是 560px 單欄，之前的「已修改報名表 UI」只指通用化設定，不能代表此版型完成。
- 報名表母版已改為桌機左主視覺與活動文案、右三步驟填單，手機上下排列與浮動報名鈕，並依共用架構〇之一加入送出前確認遮罩；產生器預覽同步。
- 使用者提供 `login-temple.jpg`，已設為產生器首頁與產出的報名表 `index.html` 預設封面。活動另上傳主圖時可覆蓋。`hero_image.html` 內嵌相同圖片，避免正式 GAS 對外依賴本機檔案。
- 本機安全模式產生器 `http://127.0.0.1:3100/` 與示範報名表 `http://127.0.0.1:3101/` 均 HTTP 200，已核對輸出 HTML 的左右欄、同一張圖片與示範活動標題。尚未取得瀏覽器截圖；本機預覽 HTML 留在 `.gas-local/`。
- 2026-10-26 使用者明確要求 redeploy 後，已新增 `.claspignore` 排除本機模擬器產物，確認 `clasp` 只追蹤 18 個正式檔；`clasp push -f` 成功，另在乾淨暫存資料夾 `clasp pull` 回查照片、首頁、報名表母版與確認遮罩。既有正式部署 ID `AKfycbx9UMfie4J0KNXudOD0yyEjmdkVT8c7T1MsYs0D--EVc0mjW2sP9P3ZzaApy11cPhmK2Q` 當時更新為 **@11「報名表雙欄版型與宮廟封面」**，本輪再更新到 @12。

## 已完成與已驗證

- 產生器主畫面 `ui.html` 新增「💡 建議 / 意見回饋」按鈕與頁內填單，沿用 `Code.gs` 的 `submitFeedbackApi` 寫入「宮廟客戶意見DB」（ID `3a48db83bd93805eb572c02b1c9da2c2`）。本次建議功能沒有改產出的報名表或後台母版；前一批通用化改版曾改過這兩份母版。
- 建議功能已提交並推送到 GitHub 分支 `agent/registration-safety-ui-workflow`，提交 `16b1d2d`。2026-10-26 回查遠端分支指向同一提交。
- `node tests/notion-template-safety.tests.cjs`、`pwsh -NoProfile -File tests/deployment-profile.tests.ps1`、本機安全模式的 `node tests/generator-local-smoke.tests.cjs` 均通過；本機主頁 HTTP 200，含建議按鈕與填單。
- 前一版 @10「新增建議填單彈窗」已部署於同一正式部署 ID；本輪 @11 是後續更新。Apps Script Deployments API 先前回報正式 Web App 設定為 `ANYONE_ANONYMOUS`／`USER_DEPLOYING`，本輪尚未重查 API 設定。

## 尚未驗證與卡點

- @10、@11 時匿名命令列 GET 正式 `/exec` 回 Google HTTP 403；本輪 @12 授權後已回 HTTP 200，並取得正確頁面標題。已回讀一筆新增的回報，但還沒有獨立瀏覽器桌機／手機截圖。
- Codex 的 Notion 連線已在本輪唯讀取得 MyLife 的「通用活動報名表產生器」專案頁及「宮廟客戶意見DB」，並核對後者有填單使用的欄位與選項；這只能證明連線與資料庫結構，不能證明正式 GAS 的 Script Property 或寫入權限。
- MyLife 專案頁已追加 @11 白話進度、更新「現況」「版控」「Repo」，狀態維持「卡住」；任務已改為「報名表產生器-驗證 @11 正式頁與建議填單」（狀況「未回覆」），兩頁均已回讀。新版截圖尚未取得，因此未附圖。
- 專案 `CLAUDE.md` 仍有上一個 Claude session 留下的未提交進度編輯，並有舊版號與「私人用」文字；Codex 依使用者規則維持唯讀，未修改該檔。

## 下一步

1. 取得桌機與手機版彈窗截圖，供介面驗收；這不影響已驗證的資料寫入與公開頁面。
2. 其餘改動已完成；下一輪若有實際畫面截圖，再補到 MyLife 專案日誌並結束截圖任務。
