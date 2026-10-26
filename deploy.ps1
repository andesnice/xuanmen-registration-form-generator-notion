#requires -Version 7
<#
  一鍵部署：通用活動報名表產生器（Notion 版）
  ──────────────────────────────────────────────
  做的事：確認登入帳號 → 載入該帳號專屬設定 → 建立(首次)或推送程式碼 → 部署 → 印出網址。
  每個 Google 帳號各自保存 Script ID、部署 ID 與網址，切換帳號不會互相覆蓋。

  用法：
    .\deploy.ps1          一鍵部署（首次自動建專案，之後自動 redeploy 同一網址）
    .\deploy.ps1 -Login   先開瀏覽器登入/切換 Google 帳號，再載入該帳號設定並部署

  ⚠️ 無法「自動打帳密登入」：Google OAuth 是安全流程，第一次一定要你在瀏覽器
     點一次「選帳號→允許」。登入後 token 存在 ~/.clasprc.json，之後就不用再登入。
#>
param(
  [switch]$Login,
  [string]$Title = '通用活動報名表產生器',
  [string]$AccountEmail = ''
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
$accountHelper = Join-Path $PSScriptRoot 'deployment-account.ps1'
if (-not (Test-Path -LiteralPath $accountHelper)) {
  Write-Host 'X 找不到 deployment-account.ps1，無法安全管理多帳號部署。' -ForegroundColor Red
  exit 1
}
. $accountHelper
$script:CurrentDeployEmail = $null

function Fail($msg) {
  if ($script:CurrentDeployEmail) {
    Save-DeploymentAccountProfile $script:CurrentDeployEmail
  }
  Write-Host "X $msg" -ForegroundColor Red
  exit 1
}

function Assert-ClaspSuccess($action) {
  if ($LASTEXITCODE -ne 0) {
    Fail "${action}失敗（clasp 錯誤代碼：$LASTEXITCODE）。請保留上方訊息以便排查。"
  }
}

function Invoke-GeneratorPreflight {
  Write-Host '> 部署前檢查：產生器語法、產物與部署腳本...' -ForegroundColor Cyan
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail '找不到 Node.js，無法執行部署前語法檢查。' }
  $required = @('Code.gs','ui.html','appsscript.json','tests\notion-template-safety.tests.cjs','tests\deployment-profile.tests.ps1')
  foreach ($name in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $name))) { Fail "部署前檢查失敗：缺少 $name" }
  }
  try { $manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'appsscript.json') -Raw | ConvertFrom-Json }
  catch { Fail "部署前檢查失敗：appsscript.json 不是有效 JSON。$($_.Exception.Message)" }
  # 公開版（PUBLIC_MODE）：access 必須是 ANYONE_ANONYMOUS（任何人可開、不在伺服器存 token）；
  # executeAs 仍為 USER_DEPLOYING（UrlFetchApp 以擁有者身分執行、吃擁有者配額）。
  if ($manifest.timeZone -ne 'Asia/Taipei' -or $manifest.runtimeVersion -ne 'V8' -or
      $manifest.webapp.access -ne 'ANYONE_ANONYMOUS' -or $manifest.webapp.executeAs -ne 'USER_DEPLOYING') {
    Fail '部署前檢查失敗：appsscript.json 的時區、V8 或 Web App 權限不符合產生器規格（公開版需 access=ANYONE_ANONYMOUS、executeAs=USER_DEPLOYING）。'
  }
  & node (Join-Path $PSScriptRoot 'tests\notion-template-safety.tests.cjs')
  if ($LASTEXITCODE -ne 0) { Fail "部署前檢查失敗：產生器／產物測試錯誤（代碼 $LASTEXITCODE）。" }
  & pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'tests\deployment-profile.tests.ps1')
  if ($LASTEXITCODE -ne 0) { Fail "部署前檢查失敗：部署腳本測試錯誤（代碼 $LASTEXITCODE）。" }
  Write-Host '  部署前檢查通過。' -ForegroundColor Green
}

# 1) 確認 clasp 已安裝
if (-not (Get-Command clasp -ErrorAction SilentlyContinue)) {
  Fail "找不到 clasp。請先安裝： npm install -g @google/clasp"
}
$claspVersionText = (& clasp --version 2>&1 | Out-String).Trim()
$claspVersionMatch = [regex]::Match($claspVersionText, '\d+\.\d+\.\d+')
if ($LASTEXITCODE -ne 0 -or -not $claspVersionMatch.Success) {
  Fail '無法確認 clasp 版本。請重新安裝：npm install -g @google/clasp@3'
}
$claspVersion = [version]$claspVersionMatch.Value
if ($claspVersion.Major -ne 3 -or $claspVersion -lt [version]'3.3.0') {
  Fail "目前 clasp $claspVersion 未經此部署流程驗證；請安裝 3.3.x：npm install -g @google/clasp@3.3.0"
}
Write-Host "  clasp $claspVersion（版本檢查通過）" -ForegroundColor DarkGray

Invoke-GeneratorPreflight

# 2) 需要時登入（開瀏覽器；一次性）
if ($Login) {
  Write-Host '> 開瀏覽器登入這次要部署的 Google 帳號...' -ForegroundColor Cyan
  clasp login
  Assert-ClaspSuccess "Google 帳號登入"
}

# 3) 顯示目前登入帳號，並切換成該帳號專屬的本機部署設定
Write-Host "> 目前 clasp 登入狀態：" -ForegroundColor Cyan
$detectedAccountEmail = Get-ClaspAccountEmail -SkipProfileProbe:([bool]$AccountEmail)
if ($AccountEmail) {
  $AccountEmail = $AccountEmail.Trim().ToLowerInvariant()
  if (-not (Test-GoogleAccountEmail $AccountEmail)) {
    Fail "選單傳入的 Google Email 格式不正確：$AccountEmail"
  }
  if ($detectedAccountEmail -and $detectedAccountEmail -ne $AccountEmail) {
    Fail "目前 clasp 帳號為 $detectedAccountEmail，與選單指定的 $AccountEmail 不同；已停止，未 push。"
  }
  if (-not $detectedAccountEmail -and -not (Test-ClaspAuthorized -UseCachedResult)) {
    Fail '目前沒有可用的 Google 登入憑證，或憑證已要求重新驗證。'
  }
  $accountEmail = $AccountEmail
} else {
  $accountEmail = $detectedAccountEmail
}
if (-not $accountEmail) {
  Fail "目前沒有可用的 Google 登入憑證。請重新執行部署選單，選 1 後依提示登入。"
}
Use-DeploymentAccountProfile $accountEmail | Out-Null
$script:CurrentDeployEmail = $accountEmail
Write-Host "  $accountEmail" -ForegroundColor Green

$deployIdFile = Join-Path $PSScriptRoot '.deploy-id.txt'
$claspJson    = Join-Path $PSScriptRoot '.clasp.json'
$desc = "報名表產生器 " + (Get-Date -Format 'yyyy-MM-dd HH:mm')

# 4) 首次：建立新的 GAS 專案（帳號綁定就在這一步，先跟你確認）
if (-not (Test-Path $claspJson)) {
  Write-Host "> 首次部署：即將在上面顯示的帳號建立新的 GAS webapp 專案。" -ForegroundColor Cyan
  $ok = Read-Host "  確認帳號正確、要建立？(y/N)"
  if ($ok -ne 'y') { Fail "已取消。要換帳號請執行： .\deploy.ps1 -Login" }

  # clasp 3.x 不接受 --type webapp；Web App 應先建立 standalone Apps Script 再 deploy。
  # create 會先 pull 遠端的空白初始檔，因此使用隔離資料夾，避免覆蓋本機原始碼。
  $bootstrapDir = Join-Path $PSScriptRoot '.clasp-bootstrap'
  if (Test-Path -LiteralPath $bootstrapDir) {
    Fail "暫存資料夾已存在：$bootstrapDir。請先確認內容後再處理。"
  }

  New-Item -ItemType Directory -Path $bootstrapDir | Out-Null
  try {
    clasp create --type standalone --title $Title --rootDir $bootstrapDir
    Assert-ClaspSuccess "建立 GAS 專案"
    if (-not (Test-Path -LiteralPath $claspJson)) {
      Fail "GAS 專案建立後找不到 .clasp.json，已停止部署。"
    }

    # 後續 push 必須改回專案根目錄。
    $claspSettings = Get-Content -LiteralPath $claspJson -Raw | ConvertFrom-Json
    $claspSettings.rootDir = '.'
    $claspSettings | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $claspJson -Encoding utf8
    Save-DeploymentAccountProfile $accountEmail
  }
  finally {
    if (Test-Path -LiteralPath $bootstrapDir) {
      Remove-Item -LiteralPath $bootstrapDir -Recurse -Force
    }
  }
}

# 5) 在 push 前驗證 Script 與部署 ID 都屬於目前帳號，防止跨帳號誤部署
$deployId = $null
if (Test-Path $deployIdFile) { $deployId = (Get-Content $deployIdFile -Raw).Trim() }

$deploymentOutput = (clasp list-deployments 2>&1 | Out-String).Trim()
$deploymentExit = $LASTEXITCODE
if ($deploymentExit -ne 0) {
  Fail "目前帳號 $accountEmail 無權讀取 .clasp.json 指向的 GAS 專案；已停止，未 push。"
}
if ($deployId) {
  if (-not (Test-DeploymentIdInClaspOutput $deployId $deploymentOutput)) {
    Fail "部署 ID $deployId 不屬於目前 Script；已停止，未 push。請用部署選單切換正確帳號。"
  }
}

# 6) 推送程式碼（母版 tmpl_*.html 全部要推，缺一支產出就少一檔）
Write-Host "> 推送程式碼 (clasp push -f)..." -ForegroundColor Cyan
clasp push -f
Assert-ClaspSuccess "推送程式碼"

# 7) 部署 / 重新部署

if ($deployId) {
  Write-Host "> 重新部署到既有部署（網址不變）：$deployId" -ForegroundColor Cyan
  clasp deploy -i $deployId -d $desc | Out-Null
  Assert-ClaspSuccess "重新部署"
} else {
  Write-Host "> 建立新部署..." -ForegroundColor Cyan
  $out = (clasp deploy -d $desc 2>&1 | Out-String)
  $deployExitCode = $LASTEXITCODE
  Write-Host $out
  if ($deployExitCode -ne 0) {
    Fail "建立部署失敗（clasp 錯誤代碼：$deployExitCode）。請保留上方訊息以便排查。"
  }
  $m = [regex]::Match($out, 'AKfycb[\w-]+')
  if (-not $m.Success) { Fail "抓不到部署 ID，請看上面 clasp 輸出手動確認。" }
  $deployId = $m.Value
  Set-Content -Path $deployIdFile -Value $deployId -NoNewline
  Write-Host "  已記住部署 ID -> .deploy-id.txt（下次自動沿用、網址不變）" -ForegroundColor DarkGray
}

# 8) 印出網址
$url = "https://script.google.com/macros/s/$deployId/exec"
$urlFile = Join-Path $PSScriptRoot '部署網址.txt'
Set-Content -LiteralPath $urlFile -Value $url -Encoding utf8
try { Set-Clipboard -Value $url } catch { }
Save-DeploymentAccountProfile $accountEmail

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "OK 完成！產生器網址：" -ForegroundColor Green
Write-Host "   $url" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host "網址已儲存到：部署網址.txt" -ForegroundColor Cyan
Write-Host "也已嘗試複製到剪貼簿；請把網址加入書籤或妥善保存。" -ForegroundColor Yellow
Write-Host "（access=ANYONE_ANONYMOUS：公開版，任何人有網址都能開；executeAs=擁有者，首次由擁有者授權 UrlFetchApp 打 Notion、不在伺服器存使用者 token）" -ForegroundColor DarkGray
