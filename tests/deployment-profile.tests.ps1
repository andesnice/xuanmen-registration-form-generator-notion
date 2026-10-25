#requires -Version 7

$ErrorActionPreference = 'Stop'
$sourceHelper = Join-Path (Split-Path -Parent $PSScriptRoot) 'deployment-account.ps1'
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('xuanmen-deploy-profile-' + [guid]::NewGuid().ToString('N'))

function Assert-Equal($Expected, $Actual, $Message) {
  if ($Expected -cne $Actual) {
    throw "$Message`nExpected: $Expected`nActual:   $Actual"
  }
}

function Assert-PowerShellSyntax([string]$Path) {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors.Count -gt 0) {
    throw "PowerShell 語法錯誤：$Path`n$($errors | ForEach-Object { $_.Message } | Out-String)"
  }
}

function Assert-PreflightBeforeMutation([string]$Path, [string]$Call) {
  $source = (Get-Content -LiteralPath $Path -Raw).Replace("`r`n", "`n")
  $callIndex = $source.IndexOf("`n$Call`n", [System.StringComparison]::Ordinal)
  $loginIndex = $source.IndexOf('if ($Login)', [System.StringComparison]::Ordinal)
  $createIndex = $source.IndexOf('clasp create', [System.StringComparison]::Ordinal)
  if ($callIndex -lt 0 -or $loginIndex -lt 0 -or $createIndex -lt 0 -or
      $callIndex -gt $loginIndex -or $callIndex -gt $createIndex) {
    throw "部署前檢查必須在登入與建立 GAS 專案前執行：$Path"
  }
}

function Assert-AccountSelectionPropagation([string]$MenuPath, [string]$DeployPath) {
  $menu = Get-Content -LiteralPath $MenuPath -Raw
  $deploy = Get-Content -LiteralPath $DeployPath -Raw
  if ($menu -notmatch '-AccountEmail\s+\$script:SelectedDeployAccount') {
    throw "選單沒有把手動確認的帳號傳給部署程序：$MenuPath"
  }
  if ($deploy -notmatch '\[string\]\$AccountEmail' -or $deploy -notmatch '\$accountEmail\s*=\s*\$AccountEmail') {
    throw "部署程序沒有接續選單確認的帳號：$DeployPath"
  }
  if ($menu -notmatch 'Show-Account -AllowManualEntry -SkipProfileProbe' -or
      $menu -notmatch '\$currentEmail\s*=\s*Get-ActiveDeploymentAccount') {
    throw "更換帳號仍會先做不必要的既有帳號網路探測：$MenuPath"
  }
  if ($deploy -notmatch 'Get-ClaspAccountEmail -SkipProfileProbe:\(\[bool\]\$AccountEmail\)') {
    throw "選單已確認帳號後，部署子程序仍會逐一探測既有帳號：$DeployPath"
  }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
@(
  'deploy.ps1',
  'deployment-menu.ps1',
  'deployment-account.ps1',
  'tmpl_auto_deploy_ps1.html',
  'tmpl_auto_deploy_menu.html',
  'tmpl_auto_deploy_account.html'
) | ForEach-Object { Assert-PowerShellSyntax (Join-Path $projectRoot $_) }
Assert-PreflightBeforeMutation (Join-Path $projectRoot 'deploy.ps1') 'Invoke-GeneratorPreflight'
Assert-PreflightBeforeMutation (Join-Path $projectRoot 'tmpl_auto_deploy_ps1.html') 'Invoke-ActivityPreflight'
Assert-AccountSelectionPropagation (Join-Path $projectRoot 'deployment-menu.ps1') (Join-Path $projectRoot 'deploy.ps1')
Assert-AccountSelectionPropagation (Join-Path $projectRoot 'tmpl_auto_deploy_menu.html') (Join-Path $projectRoot 'tmpl_auto_deploy_ps1.html')

try {
  New-Item -ItemType Directory -Path $testRoot | Out-Null
  Copy-Item -LiteralPath $sourceHelper -Destination (Join-Path $testRoot 'deployment-account.ps1')

  Set-Content -LiteralPath (Join-Path $testRoot '.active-deploy-account.txt') -Value 'alpha@example.com' -NoNewline
  Set-Content -LiteralPath (Join-Path $testRoot '.clasp.json') -Value '{"scriptId":"SCRIPT_ALPHA"}' -NoNewline
  Set-Content -LiteralPath (Join-Path $testRoot '.deploy-id.txt') -Value 'DEPLOY_ALPHA' -NoNewline
  Set-Content -LiteralPath (Join-Path $testRoot '部署網址.txt') -Value 'URL_ALPHA' -NoNewline

  $betaDir = Join-Path $testRoot '.deploy-accounts\beta@example.com'
  New-Item -ItemType Directory -Path $betaDir -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $betaDir 'account.txt') -Value 'beta@example.com' -NoNewline
  Set-Content -LiteralPath (Join-Path $betaDir '.clasp.json') -Value '{"scriptId":"SCRIPT_BETA"}' -NoNewline
  Set-Content -LiteralPath (Join-Path $betaDir '.deploy-id.txt') -Value 'DEPLOY_BETA' -NoNewline
  Set-Content -LiteralPath (Join-Path $betaDir '部署網址.txt') -Value 'URL_BETA' -NoNewline

  . (Join-Path $testRoot 'deployment-account.ps1')

  $global:FakeClaspMode = 'json-email'
  $global:FakeClaspProbeCount = 0
  function global:clasp {
    if ($global:FakeClaspMode -eq 'json-email' -and ($args -join ' ') -eq '--json show-authorized-user') {
      $global:LASTEXITCODE = 0
      Write-Output '{"loggedIn":true,"email":"Json.User@Example.com"}'
      return
    }
    if ($global:FakeClaspMode -eq 'unknown-profile') {
      if (($args -join ' ') -eq '--json show-authorized-user') {
        $global:LASTEXITCODE = 0
        Write-Output '{"loggedIn":true}'
        return
      }
      if ($args.Count -eq 3 -and $args[0] -eq '--project' -and $args[2] -eq 'list-deployments' -and
          $args[1] -like '*beta@example.com*') {
        $global:FakeClaspProbeCount++
        $global:LASTEXITCODE = 0
        Write-Output 'Found 1 deployment.'
        return
      }
    }
    $global:LASTEXITCODE = 1
    Write-Output 'Not logged in.'
  }

  Assert-Equal 'json.user@example.com' (Get-ClaspAccountEmail) '沒有解析 clasp 3.x JSON 帳號輸出'
  $global:FakeClaspMode = 'unknown-profile'
  Assert-Equal $null (Get-ClaspAccountEmail -SkipProfileProbe) '快速換帳路徑不應探測既有 profile'
  Assert-Equal '0' ([string]$global:FakeClaspProbeCount) '快速換帳路徑仍呼叫了 list-deployments'
  Assert-Equal 'True' ([string](Test-ClaspAuthorized -UseCachedResult)) '沒有沿用剛取得的 clasp 授權狀態'
  Assert-Equal 'beta@example.com' (Get-ClaspAccountEmail) 'unknown user 時沒有從可存取的既有部署辨識帳號'
  Remove-Item Function:\clasp -Force
  Remove-Variable FakeClaspMode -Scope Global -ErrorAction SilentlyContinue
  Remove-Variable FakeClaspProbeCount -Scope Global -ErrorAction SilentlyContinue

  Use-DeploymentAccountProfile 'beta@example.com' | Out-Null
  Assert-Equal 'beta@example.com' (Get-ActiveDeploymentAccount) '切換後作用中帳號錯誤'
  Assert-Equal 'DEPLOY_BETA' ((Get-Content -LiteralPath (Join-Path $testRoot '.deploy-id.txt') -Raw).Trim()) '沒有載入 beta 部署 ID'
  Assert-Equal 'DEPLOY_ALPHA' ((Get-Content -LiteralPath (Join-Path $testRoot '.deploy-accounts\alpha@example.com\.deploy-id.txt') -Raw).Trim()) '沒有保存 alpha 部署 ID'

  Set-Content -LiteralPath (Join-Path $testRoot '.deploy-id.txt') -Value 'DEPLOY_BETA_V2' -NoNewline
  Save-DeploymentAccountProfile 'beta@example.com'
  Assert-Equal 'DEPLOY_BETA_V2' ((Get-Content -LiteralPath (Join-Path $betaDir '.deploy-id.txt') -Raw).Trim()) '沒有更新 beta 帳號設定'

  Use-DeploymentAccountProfile 'alpha@example.com' | Out-Null
  Assert-Equal 'DEPLOY_ALPHA' ((Get-Content -LiteralPath (Join-Path $testRoot '.deploy-id.txt') -Raw).Trim()) '切回 alpha 時載入錯誤'
  Assert-Equal 'DEPLOY_BETA_V2' ((Get-Content -LiteralPath (Join-Path $betaDir '.deploy-id.txt') -Raw).Trim()) '切回前沒有保存 beta 最新設定'

  $sampleOutput = "Found 2 deployments.`n- DEPLOY_ALPHA @1 - first`n- DEPLOY_OTHER @HEAD"
  Assert-Equal 'True' ([string](Test-DeploymentIdInClaspOutput 'DEPLOY_ALPHA' $sampleOutput)) '合法部署 ID 未通過驗證'
  Assert-Equal 'False' ([string](Test-DeploymentIdInClaspOutput 'DEPLOY' $sampleOutput)) '部分相符的錯誤部署 ID 不應通過'

  Write-Host 'deployment profile and syntax tests: OK' -ForegroundColor Green
}
finally {
  if (Test-Path -LiteralPath $testRoot) {
    $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
    $resolvedTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if (-not $resolvedTestRoot.StartsWith($resolvedTempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "拒絕清除非暫存路徑：$resolvedTestRoot"
    }
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
  }
}
