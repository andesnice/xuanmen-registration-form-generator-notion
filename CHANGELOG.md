# 變更紀錄

## 2026-08-11 — 產生器 UI／UX 工作台

- 產生器改為四階段流程導覽：活動設定、Notion 連線、建立資料庫、下載專案。
- 新增即時完成度、缺漏原因與「下一步」導引；建立 DB 或下載前驗證失敗會帶回對應設定區。
- 桌面版改成主表單＋黏貼式狀態／預覽雙欄，平板與手機自動切回單欄。
- 品項與自訂欄位表格加入手機橫向滑動容器，避免撐破頁面。
- 補強輸入焦點、按鈕觸控尺寸、狀態 live region、減少動畫偏好與後台密碼顯示／隱藏。
- Notion Token 說明改為明確的機密提示，不在狀態摘要顯示 Token。
- UI 回歸測試新增重複 ID、流程控制元件、響應式表格與 inline JavaScript 語法檢查。

## 2026-08-09 — 自動報名時段與取消釋額

- 產生器新增報名開放／截止時間，固定依台北時間判斷；手動 `CLOSED` 保留最高優先權。
- 新增信眾取消整筆報名功能，家庭代報會同步取消所有功德主。
- 取消採保留 Notion 紀錄並寫入「報名狀態／取消時間」，不直接刪除資料。
- 已取消資料不再占總名額、品項名額，也不列入後台金額與採購彙總。
- 後台仍顯示取消紀錄，Excel 明細包含狀態與取消時間。
- Notion schema key 升級為版本 2，舊版資料庫不會被誤判為可直接沿用。
- 部署腳本新增任何登入／建置／push 前預檢：必要檔案、manifest、同名 `.gs/.js`、產生器 UI 與產物 JavaScript 語法任一異常都會先停止。
- 模板欄位改為單次嚴格替換：缺少替換值會中止產生，使用者合法輸入的 `{{VIP}}` 等文字則不會被誤判。
- 部署前固定驗證 clasp 3.x 且版本至少 3.3.0，避免用未相容的 CLI 進入 push／redeploy。
- 測試加入假的 clasp 全流程，不連外即可驗證首次 `create → push → deploy` 與既有部署 ID redeploy。
- 修正 GAS iframe 的相對查詢連結，改用 `ScriptApp.getService().getUrl()` 產生正式 Web App 絕對網址。

## 2026-08-09

### 防止超賣與異常輸入

- 公開報名及自助修改以 `ScriptLock` 鎖住查重、名額判斷與 Notion 寫入。
- 家庭修改要求 pageId 唯一，且必須與原查詢結果完整對應，避免重複 ID 造成名額低估。
- 統一驗證電話、文字長度、固定／免費數量、隨喜／最低金額、總額及日期。
- 匯款欄位必須連同有效繳款方式更新；改為匯款時日期、後五碼與金額全數必填。
- `Utils.gs` 改用 `rawTpl_` 產出，避免 HtmlService 將比較運算子轉義。
- 新增 `tests/notion-template-safety.tests.cjs` 安全回歸測試。

驗證結果：

- `node tests/notion-template-safety.tests.cjs`：通過。
- `pwsh -NoProfile -File tests/deployment-profile.tests.ps1`：通過。

尚未執行 GAS 部署、真實 Notion 寫入或線上併發請求測試。
