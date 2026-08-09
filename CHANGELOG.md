# 變更紀錄

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
