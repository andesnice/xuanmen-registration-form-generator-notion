# 報名表產生器（Notion 版）— 三層資料模型 SPEC

> 本檔是「預期行為」的權威來源，供 Codex 驗收用。線上現況看 `STATUS.md`，部署版本以 `clasp list-deployments` 實查為準。
> Breaking change 才改本檔；小修（typo／版面）不用動。

## Goal

讓產生器產出的**每一張**報名表都採用三層 Notion 資料模型，使宮廟同工能「在商品檔新增／停用品項」而**不必重新產出報名表**。

## Why

舊版把每個品項做成訂單主檔上的一個 Number 欄位（`固定品項` → `properties['固定品項'].number`）。品項是寫死在 schema 裡的，新增品項＝改 schema＝重新產出＋重新部署。改成三層後，品項是「商品檔」裡的資料列，報名表每次載入都即時讀商品檔，加列即生效。

對齊 `_AI共用架構紀錄.md`〇之六／〇之九的權威資料模型：**訂單主檔 ← 訂單項目交易明細 → 項目設定檔（商品檔）**。

## Scope

- ✅ 只影響「以後新產出」的報名表；不做任何舊專案遷移工具。
- ✅ 一律三層（即使是最簡單的活動），這是本產生器的拍板，覆蓋〇之六「不要強迫簡單活動拆表」的一般建議。
- ❌ 不改動產生器對外的部署網址、不自動 redeploy（對外 redeploy 一律先問使用者）。

## 三張 DB 的 schema 契約

產生器 `createThreeTierDbs_` 依序建立 **商品檔 → 訂單主檔 → 交易明細**（明細的 relation 需要前兩張的 ID），再 `seedItems_` 把初始品項寫進商品檔。任一張建失敗＝整體失敗；seed 失敗只警告。

### 1. 訂單主檔（orderDbId）— 一列＝一張報名訂單（家庭模式每位功德主一列）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `功德主` | title | 報名人姓名 |
| `電話` | phone_number | |
| `地址` | rich_text | |
| `報名編號` | rich_text | `R-` + 14 位時間戳 + `-` + 亂碼；家庭模式同批共用 |
| `報名狀態` | select（`有效`／`已取消`） | 取消＝改這欄，**絕不刪列** |
| `取消時間` | date | |
| `繳款方式` | select | `現金`／`匯款`／`刷卡`／`LinePay` |
| `繳費狀況` | select | `未處理`／`未繳款`／`應收`／`已繳款` |
| `匯款日期` | rich_text | 存 `YYYY-MM-DD` |
| `帳號後五碼` | rich_text | **絕不可用 number**（吃前導 0） |
| `匯款金額` | number | |
| `確認匯款?` | checkbox | |
| `稽核` | checkbox | |
| `個資同意` | checkbox | |
| `備註` | rich_text | |
| `總金額` | number | 🔴 **唯一財務真值**。每日關帳只讀主檔，不重算明細 |
| `報名時間` | date | |
| `Email` | rich_text | 一律建欄；僅 `NOTIFY.ENABLED` 時讀寫 |
| `聯絡人`／`家庭編號` | rich_text | 僅家庭模式 |
| （群組欄） | select | 若 `hasGroup` |
| （自訂欄） | 依 type | |

🔴 **訂單主檔沒有任何「每品項 Number 欄」**。品項數量只存在交易明細。

### 2. 商品檔 / 項目設定檔（itemDbId）— 一列＝一個可選品項

| 欄位 | 型別 | 說明 |
|---|---|---|
| `品項名稱` | title | 等同舊 `item.id`（前後端、明細快照都用這個名字 join） |
| `計價模式` | select（`固定單價`／`隨喜`／`免費`／`最低金額`） | |
| `單價` | number | |
| `最低金額` | number | |
| `單位` | rich_text | |
| `數量上限` | number | 0＝不限 |
| `排序` | number | 報名表顯示順序 |
| `場次` | select（空選項） | 預留 |
| `啟用` | checkbox | 🔴 報名表只顯示 `啟用=true` 的品項 |
| `備註` | rich_text | |

計價模式 label↔code 對應（產生器 `pricingModeLabel_`、runtime `pricingModeFromLabel_` 互為反函數）：
`固定單價=fixed`／`隨喜=donation`／`免費=free`／`最低金額=minimum`。

### 3. 交易明細（detailDbId）— 一列＝一張訂單裡選的一個品項

| 欄位 | 型別 | 說明 |
|---|---|---|
| `明細` | title | `訂單編號-品項名稱` |
| `訂單` | relation → orderDbId（single_property） | 指向訂單主檔那列 |
| `商品` | relation → itemDbId（single_property） | 指向商品檔那列 |
| `訂單編號` | rich_text | 冗餘，方便篩選 |
| `品項名稱` | rich_text | 🔴 **下單當下的快照**（商品改名後舊明細不變） |
| `計價模式` | rich_text | 快照 |
| `單價快照` | number | 快照 |
| `數量` | number | fixed/free＝份數；donation/minimum＝金額 |
| `小計` | number | |
| `狀態` | select（`有效`／`已取消`） | 跟隨訂單取消 |

relation 寫法（API `2022-06-28`）：`{ relation: [{ id: '<pageId>' }] }`（見 `tmpl_Utils` 的 `pRel_`）。

## Runtime 行為契約（tmpl_Code）

### 品項即時解析 — `effectiveItems_()`

- 查商品檔 → 濾 `啟用=true` → 依 `排序` 排序 → map 成 `{ id, pageId, pricingMode(code), price, minAmount, unit, limit }`。
- 查失敗或空 → 退回 `CONFIG.QTY_ITEMS`（無 pageId，degraded）。
- 單次請求內快取，避免重複打 Notion。
- 前端 `itemsLoadApi()` 回傳同一份（不含敏感欄），報名表據此渲染品項卡；渲染失敗退回 `CONFIG.QTY_ITEMS`。

### 送出 — `submitApi(payload)`

1. 報名開關／時窗檢查、欄位清洗（同舊版）。
2. 用 `effectiveItems_()`（**不是** CONFIG.QTY_ITEMS）算每人小計、驗最低金額、驗至少選一項。
3. 進 ScriptLock：查重（主檔 active 列，電話+姓名）、查名額（見下）。
4. 每位功德主：
   a. 建**訂單主檔**一列（含 `總金額`＝該人小計、metadata、匯款欄），取得 masterPageId。
   b. 對每個選了的品項建一列**交易明細**（`訂單`→masterPageId、`商品`→item.pageId、快照、`數量`、`小計`、`狀態=有效`、`訂單編號`）。
   c. 🔴 主檔 `總金額` 必須在建明細**之前**就寫好（4a 已含）。明細建立失敗 → 回報錯誤（標 partial）。
5. 通知信（獨立 try/catch、非阻擋）。

### 名額 — `capacityLoadApi()` / submit 內查名額

- 總名額：active 主檔列數 vs `CONFIG.CAPACITY.total`。
- 單品項名額：**該品項 active 交易明細的 `數量` 加總** vs 商品檔 `數量上限`（優先）或 `CONFIG.CAPACITY.items`（fallback）。

### 讀取 — `formatRows_()` / `loadAllRows_()`

- 查全部主檔 + 全部明細；明細依 `訂單` relation 分組。
- 每列主檔攤平：保留舊欄位，另把 `r[品項名稱] = 該訂單該品項 active 明細數量加總`，讓 report/lookup 沿用「每品項一欄」的既有畫面。
- `總金額` 一律讀主檔那欄，不重算。
- 另回傳 `items`（effectiveItems）供 report 動態欄位。

### 自助查詢／修改／取消

- `publicLookupApi`：依報名編號+電話找主檔列，附帶明細重建的每品項數量。
- `publicUpdateApi` / `reportUpdateApi`：改品項＝**重寫該訂單的交易明細**（刪不掉就把舊明細 `狀態=已取消` 或直接 PATCH 數量；實作以「先清空該訂單 active 明細、再依新內容建列」或逐列 PATCH，擇一且在本 SPEC 標明），並**重寫主檔 `總金額`**。改匯款／聯絡欄只 PATCH 主檔。
- `publicCancelApi`：主檔 `報名狀態=已取消`＋`取消時間`，同訂單所有 active 明細 `狀態=已取消`。名額因此即時釋出。

### 商品管理（後台，密碼門）— 直接在網頁上維護商品檔

讓宮廟同工不必打開 Notion，就能在後台（report 頁「🏷 商品管理」分頁）新增品項、改價格／名稱／單位／上限／排序／備註／計價模式／最低金額、上下架。**只讀寫既有商品檔的 10 個欄位，不改任何 DB schema**（純 GAS 新增功能）。三支 API 全部以 `CONFIG.REPORT_PASSWORD` 驗證，不回傳 token。

- `itemManageLoadApi(password)`：讀商品檔**全部**品項（含 `啟用=false`，與 `effectiveItems_` 的「只回啟用且會退回 CONFIG 快照」不同，管理用不能靠它）。回 `{ ok, items:[{ pageId, name, pricingMode(中文標籤), price, minAmount, unit, limit, sort, session, enabled, note }] }`，依 `排序` 排序。
- `itemCreateApi(password, fields)`：寫一列進商品檔。`品項名稱` 必填且**不可與現有品項同名**（品項名稱＝報名表 join key）；未帶 `pricingMode` 預設固定單價、未帶 `enabled` 預設啟用、未帶 `sort` 接在最後。
- `itemUpdateApi(password, pageId, fields)`：PATCH 指定商品檔列，`pageId` 先驗 hex 格式；只更新 `fields` 有帶的欄位（上下架＝只帶 `{ enabled }`）。
- 共用 `buildItemProperties_(fields, isCreate)`：映射到商品檔 Notion props（計價模式限 `固定單價／隨喜／免費／最低金額`；數字欄 clamp ≥0；`場次` 空字串＝清除 select）。
- 存檔後報名表即時生效：報名表每次載入走 `itemsLoadApi`→`effectiveItems_(force)` 重讀商品檔，不依賴部署；停用品項報名表不顯示，但**舊交易明細的品項快照不受影響**。

## 介面契約（generator ↔ templates）

`buildFiles_` 注入 `tmpl_Secrets` 的三個 DB ID token：`NOTION_ORDER_DB_ID_JS`／`NOTION_DETAIL_DB_ID_JS`／`NOTION_ITEM_DB_ID_JS`（＋向後相容 `NOTION_DB_ID_JS`＝主檔）。`CONFIG.QTY_ITEMS`／`CONFIG.CAPACITY` 保留為 **seed 快照＋離線 fallback**，runtime 真值一律以商品檔為準。

## schemaKey / 版本

`GEN.SCHEMA_VERSION = 4`（三層）。`schemaKey_` 含 `schemaVersion`，防 create-DB 與 generate 兩步設定漂移。

## 驗收（Codex 對照本檔）

1. 產出專案的 `Secrets.gs` 有三個 DB ID getter 且 token 已注入三張 DB。
2. submit → 主檔一列（含正確 `總金額`、`帳號後五碼` 前導 0 不掉）＋每選一品項一列明細（relation 正確、快照正確、`狀態=有效`）。
3. 家庭模式 → 每位功德主各一張主檔列、各自的明細，共用報名編號／家庭編號。
4. 商品檔新增一列 `啟用=true` → 不重新產出，報名表即顯示、可下單、名額正確。
5. 取消 → 主檔＋明細狀態都變 `已取消`，名額釋出，列未被刪。
6. report/lookup 三頁 200，每品項欄位數量正確，`總金額` 讀主檔。
7. 後台「🏷 商品管理」分頁：密碼正確才顯示；列出含停用的全部品項；改單價存檔→報名表重整即讀到新價；新增品項（啟用）→報名表即顯示、同名擋下；停用品項→報名表不再顯示但舊明細不變；三支 API 皆不回傳 token。
8. `node tests/notion-template-safety.tests.cjs`、`pwsh -NoProfile -File tests/deployment-profile.tests.ps1` 綠。
