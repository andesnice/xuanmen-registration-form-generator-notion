# 宮廟共用報名表產生器 — 生成 SOP

> **用途**：各宮廟填入主辦單位、活動名稱、品項、n8n、Notion 與匯款資料後，產出獨立 GAS 報名專案（index＋report＋close）與三支 n8n workflow。
> **目前範圍**：品項支援固定單價、隨喜金額、免費品項、最低金額與條件連動欄位，可選「一人一份」或「家庭代報」。另有報名編號、重複報名偵測、信眾自助查詢／修改，以及後台單筆／家庭合併收據列印。
> 產生器另支援 Google 使用者層級的常用設定範本；一般範本只保存可重用設定，不保存活動密碼、Notion token、n8n 網址、活動名稱／代碼與日期。Notion Token、建立模式與活動總資料庫 ID 可另存為伺服器端「Notion 連線設定」，Token 不回傳前端。
> **基準**：以本資料夾的 `tmpl_*` 為唯一產出模板，不依賴任何特定宮廟專案或本機路徑。

---

## 0. 輸入（缺就問，不要腦補）

| 欄位 | 必要 | 說明 / 預設 |
|------|------|------|
| 宮廟／主辦單位名稱 | ✅ | 顯示於報名表資訊與結束頁署名 |
| `EVENT_NAME` 活動全名 | ✅ | 例：丙午年關聖帝君聖壽發心 |
| `EVENT` 活動代碼 | ✅ | 英文小寫，組 webhook 路徑用（`<EVENT>-submit/report/update`）。使用者沒給 → 依名稱建議一個請他確認，**不要自己拍板** |
| 品項清單 | ✅ | 每項設定名稱、計價模式、單價／最低額、單位與上限 |
| 報名模式 | ✅ | `single`＝一人一份；`family`＝家庭代報 |
| 總名額 | ⬜ | 0＝不限；家庭模式以功德主列數計算 |
| 自訂欄位 | ⬜ | 文字／下拉／勾選／日期，可設定必填及連動品項 |
| `REPORT_PASSWORD` 後台密碼 | ✅ | 沒給 → 建議 `<EVENT>+四位數` 請他確認 |
| 所屬單位欄 | ⬜ | 可自訂欄名，例如「所屬宮廟」「分會」「所屬單位」，選項每行一個 |
| n8n Webhook Base | ✅ | 使用各宮廟自己的 HTTPS n8n 網址 |
| 匯款銀行／帳號／戶名 | 選匯款時 ✅ | 不提供任何特定宮廟預設值 |
| 活動日期/地點/匯款截止 | ⬜ | 填進 `CONFIG.EVENT_DATE/EVENT_PLACE/REMIT_DEADLINE`，沒給先留佔位並在待辦標注 |
| 是否祝壽/餐會類 | ⬜ | 若是（聖壽/祝壽/神明聖誕）→ 依主規範加「參與者＋是否參加餐會＋餐會人數」四欄。使用者沒明講就**問一句** |

不得在產生器或產物中硬寫任何特定宮廟的名稱、帳號、n8n 網址或 Notion credential 名稱。

---

## 1. 生成步驟（照順序，逐步做逐步回報）

1. **確認輸入齊全**：EVENT 代碼、密碼、報名模式、品項單價缺任一 → 先問，不要開工。
2. **建立產物**：由 `tmpl_Config/Code/Utils/index/report/close` 產出 GAS 檔案，再加入三支 n8n JSON 與建表規格；不寫死解壓路徑。
3. **改 `Config.gs`**：
   - `EVENT` / `EVENT_NAME` / `PAGE_TITLE` / `REPORT_TITLE` / `EVENT_DATE` / `EVENT_PLACE` / `REMIT_DEADLINE` / `CLOSED_MSG` 換成本活動。
   - `REGISTRATION_MODE` 設為 `single` 或 `family`；`QTY_ITEMS` 換成使用者品項：`{ id:'盆花', unit:'份', price:300 }`（`id` = Notion Number 欄位名，中文即可，需與 Notion 欄位、n8n 映射三處一致）。
   - **移除 v1 用不到的中元專屬常數**：`FREE_GROUPS`、`DISPOSAL_OPTIONS`、`pet:true`。
   - `PAY_OPTIONS` 從共用的 5 種方式中由使用者複選，`PAY_STATUS` 保留 4 個共用狀態；所屬欄位使用 `GROUP_FIELD/GROUP_OPTIONS`。
   - `CLOSED: false`。`BANK` 用通用帳號。
4. **改前端 `index.html` / `report.html` / `close.html`（資料驅動）**：
   - 讀中元的品項渲染區塊，把「硬寫 QTY_ITEMS/FREE_GROUPS」改成**從 `CFG.QTY_ITEMS` 迴圈渲染** stepper（v1 沒有隨喜群組/連動欄，一併移除中元的普施/共同桌/金紙/寵物/普桌處理 UI 與統計）。
   - 🔴 **必備規範一項都不能少**：
     - 繳款方式只顯示產生器中勾選的項目；選「匯款」→ 才展開匯款三必填欄（`匯款日期` rich_text／`銀行後五碼` **rich_text 5 碼**／`匯款金額` number>0），前端擋送出。
     - 個資同意書聲明區塊 ＋ `privacyAgree` checkbox，未勾不得送出；送出帶 `個資同意:true`。
     - 後台 `report`：繳款狀況 4 個（後台限定，index 不得出現）、`確認匯款?`＋`稽核` checkbox（`chkTrue()` 寬鬆判斷）、統計＋編輯 Modal＋SheetJS 匯出。
     - close 由 `CONFIG.CLOSED` 開關切換；doGet 路由 `?page=form/close/report` 照中元 `Code.gs`。
     - 🔴 GAS 版禁用 `location.reload()`／整頁 `innerHTML` 覆蓋，密碼門用疊遮罩（抄中元 `gateMask`）。
   - 總金額 = Σ(數量×單價)，後台一律重算不信 Notion 存值。
5. **生 n8n 三支 JSON**：submit/update 的 HTTP 節點使用 predefined Notion API credential；report 使用 Notion `getAll + returnAll:true + simple:false` 自動翻頁。report/update webhook 必須驗證產生器建立的隨機管理金鑰，且只允許 GAS 後端代理呼叫；前端不得拿到金鑰或 webhook URL。
6. **生 `Notion建表規格.md`**：固定欄＋每品項一個 Number 欄（見 §2）。
7. **（全自動）建 Notion DB**：預設輸入「活動總資料庫 ID」，先在總資料庫建立一筆活動頁面，再於該頁面下建立報名 DB，並把「報名資料庫 ID」回填活動紀錄及三支 n8n JSON；仍保留直接指定 Parent Page 的舊模式。
8. **生專案 `CLAUDE.md`**：EVENT／Script ID(待建)／部署 ID(待建)／Notion DB ID／n8n webhook／固定單價表／待辦清單／踩坑，格式抄中元的專案 CLAUDE.md。
9. **跑 `gas-test`** 審查所有 `.gs` 與前端 fetch 寫法，修正後再交付。

---

## 2. 欄位映射規則（固定欄 ＋ 品項欄）

**Notion DB 固定欄**（兩種模式共用）：

| 欄位 | Notion 型別 |
|------|------|
| 功德主（title） | title |
| 電話 | phone_number |
| 地址 | rich_text |
| 自訂所屬單位欄 | select（啟用時建立；欄名與選項由使用者設定） |
| 繳款方式 | select |
| 繳費狀況 | select（後台改；UI 標籤叫「繳款狀況」，Notion 欄名沿用「繳費狀況」） |
| 匯款日期 | rich_text |
| 帳號後五碼 | **rich_text**（絕不可 number；UI 標籤「銀行後五碼」，Notion 欄名沿用「帳號後五碼」） |
| 匯款金額 | number |
| 確認匯款? | checkbox |
| 稽核 | checkbox |
| 個資同意 | checkbox |
| 備註 | rich_text |
| 總金額 | number |

**家庭代報模式另加**：

| 欄位 | Notion 型別 |
|------|------|
| 聯絡人 | rich_text |
| 家庭編號 | rich_text |

同次送出的每位功德主各存一列，聯絡與繳款欄位共用並由後台同步更新；品項與該列總金額則各自計算。

**品項欄**：`QTY_ITEMS` 每一項 → 一個 **Number** 欄，欄名 = 品項 `id`（例：盆花、五果）。

> ⚠️ 欄名三處一致：`Config.gs` 的 `QTY_ITEMS[].id` ＝ Notion 欄名 ＝ n8n submit/report/update 映射 key。改名要三處一起改（照主規範「常數重構」紀律）。
> ⚠️ n8n 寫法：後五碼 submit `txt()`、update `{rich_text:[...]}`、report `t()`；checkbox 回讀用 `chkTrue()`。

---

## 3. 交付後「人工收尾清單」（一定要列給使用者）

自動化到不了的最後幾步，生成完一律把這張清單貼給使用者：

1. **n8n**：到各自的 n8n 匯入 `<EVENT>-submit/report/update` 三支 → 三支的 Notion／HTTP 節點選自己的 Notion API credential → 確認 DB 已加入相同 integration → Activate。
2. **Notion**：若 §1-7 已用 MCP 建好 DB，確認欄位無誤；否則照 `Notion建表規格.md` 手動建，並把 DB ID 填回 n8n。
3. **GAS 部署**：解壓後**雙擊 `自動部署.bat` → 選 1**（自動 `clasp create`〔首次〕→ `clasp push -f` → `clasp deploy`，網址不變地 redeploy，並印出前台／後台網址）；要換 Google 帳號選 2，工具會把各帳號的 Script ID／部署 ID／網址分開保存在 `.deploy-accounts/`，並在 push 前驗證部署 ID 屬於目前 Script。或手動 `clasp create` → `clasp push -f` → 先部**測試部署**實跑。🔴 **對外部署／redeploy 一律先問使用者**。（bat 選單第 5 項可一鍵切換 close 頁截止／重開報名）
4. **驗收**（照主規範跑，缺一不可）：submit 落地（個資同意=true、確認匯款?=false、後五碼前導 0 沒被吃）／report 超過 100 筆仍全量／未帶管理金鑰直打 report/update 必須失敗／update 勾確認匯款?・稽核回讀 true／三 checkbox key 有輸出／`/exec`・`?page=close`・`?page=report` 三頁皆 200，且 report 原始碼沒有密碼、管理金鑰或 n8n 後台 URL。
5. **測試資料**：測試會寫進正式 Notion DB，姓名一律填「測試資料請刪」，測完立刻刪列。

---

## 4. 邊界（遇到就明講，不要硬做）

- 家庭以外的任意多層展開、複雜關聯資料庫仍需個案設計。
- 對外部署 redeploy、刪 Notion 正式資料 → 破壞性/對外，先問。
- 產生的前端資料驅動改寫若與中元原邏輯衝突，以「必備規範」為底線，拿不準就停下來問，不要靜默改行為。
