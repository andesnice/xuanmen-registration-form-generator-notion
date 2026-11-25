# 通用活動報名表產生器（Notion 版）

> **封存專案。** 此版本供查閱與維護既有部署；玄門的新報名表請依現行專案規範與模板庫選型，勿直接拿本專案作為新案起點。

這是一個 Google Apps Script（GAS）網頁工具。使用者填入活動、品項與 Notion 連線資料後，可建立活動使用的 Notion 資料庫，並下載獨立的 GAS 報名專案。產出的專案包含報名頁、查詢／修改頁、後台報表與結束頁。**產生器本體與產出的報名專案是不同的 GAS 專案。**

## 主要功能

- 設定活動名稱、主辦單位、報名模式、品項價格與名額、自訂欄位及報名時段。
- 在指定的 Notion 頁面或活動資料庫下建立報名所需資料庫。
- 預覽並下載報名專案的程式碼與部署輔助檔案。
- 提供 Notion 連線檢查與意見回報入口。

產出的報名表支援單人與家庭代報。實際可用功能、欄位及限制仍須以產出當次的設定和部署測試為準。

## 程式怎麼分工

| 位置 | 用途 |
| --- | --- |
| `Code.gs`、`ui.html` | 產生器的 GAS 後端與操作畫面 |
| `tmpl_*.html` | 產出獨立報名專案時使用的程式模板 |
| `feedback.html`、`hero_image.html` | 意見回報畫面與內嵌圖片 |
| `appsscript.json` | GAS 專案設定與權限宣告 |
| `tests/` | 本機安全與產出流程檢查 |
| `PLAYBOOK.md` | 原有的操作與產出流程說明；涉及舊架構的段落應對照現行程式確認 |
| `STATUS.md`、`CHANGELOG.md` | 歷史進度與變更紀錄；線上版本須以 GAS 部署清單實查 |

## 本機檢查

需要 Node.js；部署設定測試另需 PowerShell。以下命令在專案根目錄執行，不會建立正式 Notion 資料：

```powershell
node tests/notion-template-safety.tests.cjs
node tests/generator-local-smoke.tests.cjs
pwsh -NoProfile -File tests/deployment-profile.tests.ps1
```

這些檢查不能替代正式 GAS 網頁、Notion 權限與資料寫入的實測。

## 憑證與部署

- 不要把 Notion Token、GAS 登入資料、活動密碼或正式客戶資料提交到 GitHub。
- `.clasp.json`、本機部署帳號資料與環境檔已列入 `.gitignore`；部署前仍須檢查待提交清單。
- 公開使用模式不會把操作人輸入的 Notion Token 存成共用伺服器設定。建立資料庫與產出專案前，應再次確認連線目標及權限。
- GitHub 提交、GAS 程式推送、GAS 正式部署是三個不同動作。要核對線上版本，請查 GAS 部署清單及對應版本內容。

本儲存庫的 `main` 已對齊 2026-10-27 的 GAS 正式部署 **@12** 程式內容；這是當時版本的對照資訊，不代表之後的線上狀態永遠不變。
