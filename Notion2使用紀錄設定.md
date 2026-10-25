# Notion2 使用紀錄設定

## 用途

「通用活動報名表產生器」在以下伺服器端操作結束後，將成功或失敗結果寫入獨立的 Notion2 資料庫：

- 建立資料庫
- 產出專案 ZIP

使用紀錄失敗不會反過來中斷原本操作；產生器畫面會明確顯示「使用紀錄未寫入」警告。

產生器另有獨立的「意見回饋」頁，回饋寫入 Notion2 資料庫 `3a48db83bd93805eb572c02b1c9da2c2`。首次送出時只會補齊缺少的回饋欄位，不會刪除或更改既有欄位；使用同一個 `REG_FORM_USAGE_LOG_NOTION_TOKEN`。

## 資料庫

資料庫名稱：`報名表產生器使用紀錄`

- Notion：<https://app.notion.com/p/d7a8da3ca46e422fa34889a45983b59c>
- Database ID：`d7a8da3ca46e422fa34889a45983b59c`
- Data source ID：`9741e584-7f0b-4532-ba64-3e0721c6ff67`
- 位置：Notion2／MyLife 工作區的私人工作區層級（未放進玄門真宗）

```sql
CREATE TABLE (
  "紀錄名稱" TITLE,
  "使用時間" DATE,
  "使用者 Email" EMAIL,
  "主辦單位" RICH_TEXT,
  "活動名稱" RICH_TEXT,
  "活動代碼" RICH_TEXT,
  "執行動作" SELECT('建立資料庫':blue, '產出專案':green),
  "執行結果" SELECT('成功':green, '失敗':red),
  "產生器版本" RICH_TEXT,
  "錯誤摘要" RICH_TEXT
)
```

不記錄 Notion Token、後台密碼、ZIP 內容或報名個資。

## GAS Script Properties

在產生器本體的 Apps Script「專案設定 → 指令碼屬性」新增：

| 屬性 | 值 |
|---|---|
| `REG_FORM_USAGE_LOG_NOTION_TOKEN` | 可寫入上述 Notion2 DB 的 Integration Token |
| `REG_FORM_USAGE_LOG_DATABASE_ID` | 上述 DB 的 ID |

設定後在 Apps Script 編輯器執行 `checkUsageLog()`；回傳「Notion2 使用紀錄資料庫連線正常」才算設定完成。

## 目前狀態（2026-09-28）

- 程式與本機回歸測試已完成。
- `notion2` 已確認連到 `andesnice@gmail.com`／「韋銘's Notion」，不是「玄門真宗」。
- 使用紀錄 DB 已建立，並回讀確認 10 個欄位與 select 選項符合本文件規格。
- Apps Script 已設定 `REG_FORM_USAGE_LOG_NOTION_TOKEN`／`REG_FORM_USAGE_LOG_DATABASE_ID`，並由使用者執行 `checkUsageLog()` 與測試寫入成功。
- 使用紀錄與移除「功德系統」已重新部署為正式版本 `@7`。
- 意見回饋頁會寫入資料庫 `3a48db83bd93805eb572c02b1c9da2c2`；使用者已執行 `setupFeedbackDatabase()`，確認欄位初始化成功。
- 意見回饋功能已完成本機測試並正式重新部署為 `@8`（「新增意見回饋頁＋Notion2 回饋資料庫」）。

## 公開模式（已部署 @9）

- Web App 權限改為 `ANYONE_ANONYMOUS`，知道連結者不需登入 Google 即可使用。
- Web App 仍以部署者身分執行，但公開請求不再讀取或寫入部署者的 User Properties。
- Notion Token 僅使用訪客當次輸入，不儲存在伺服器；產出 ZIP 時由同一份當次輸入帶入 `Secrets.gs`。
- 常用設定範本改存訪客自己的瀏覽器 `localStorage`，不同裝置與瀏覽器不共用，也不保存活動密碼或 Notion Token。
