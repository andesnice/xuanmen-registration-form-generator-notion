#requires -Version 7

param(
  [switch]$Validate
)

$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $PSScriptRoot
$accountHelper = Join-Path $PSScriptRoot 'deployment-account.ps1'
if (-not (Test-Path -LiteralPath $accountHelper)) {
  Write-Host '找不到 deployment-account.ps1，無法安全管理多帳號部署。' -ForegroundColor Red
  exit 1
}
. $accountHelper

function Wait-ForUser {
  Write-Host ''
  Read-Host '按 Enter 返回選單' | Out-Null
}

function Show-Account {
  Write-Host '目前登入帳號：' -ForegroundColor Cyan
  $email = Get-ClaspAccountEmail
  if (-not $email) {
    Write-Host '目前沒有可用的 Google 登入憑證。' -ForegroundColor Yellow
    return $false
  }
  Use-DeploymentAccountProfile $email | Out-Null
  Write-Host $email -ForegroundColor Green
  $profiles = Get-DeploymentAccountProfiles
  if ($profiles.Count -gt 0) {
    Write-Host ('已保存部署設定：' + ($profiles -join '、')) -ForegroundColor DarkGray
  }
  return $true
}

function Ensure-Account {
  if (Show-Account) { return $true }

  Write-Host ''
  $answer = Read-Host '是否現在開啟瀏覽器登入要部署的 Google 帳號？(Y/n)'
  if ($answer -and $answer -ine 'y') { return $false }

  Write-Host ''
  Write-Host '正在開啟 Google 登入；完成瀏覽器授權後請回到這個視窗。' -ForegroundColor Cyan
  & clasp login
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'Google 帳號登入未完成，尚未進行部署。' -ForegroundColor Red
    return $false
  }

  Write-Host ''
  return (Show-Account)
}

function Start-Deploy {
  Write-Host ''
  Write-Host '開始執行部署，請依畫面提示操作。' -ForegroundColor Cyan
  Write-Host ''

  & pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'deploy.ps1')
  $deployExit = $LASTEXITCODE

  Write-Host ''
  if ($deployExit -eq 0) {
    Write-Host '部署程序已完成；網址已顯示並儲存在「部署網址.txt」。' -ForegroundColor Green
  } else {
    Write-Host "部署失敗，錯誤代碼：$deployExit" -ForegroundColor Red
    Write-Host '請保留這個畫面，方便協助排查。' -ForegroundColor Yellow
  }
  Wait-ForUser
}

function Change-AccountAndDeploy {
  Clear-Host
  Write-Host '=================================================='
  Write-Host '               更換 Google 帳號'
  Write-Host '=================================================='
  Write-Host ''
  $currentEmail = Get-ClaspAccountEmail
  if ($currentEmail) {
    Use-DeploymentAccountProfile $currentEmail | Out-Null
    Save-DeploymentAccountProfile $currentEmail
    Write-Host "目前 $currentEmail 的 Script ID、部署 ID 與網址已保存。" -ForegroundColor DarkGray
  }
  Write-Host '即將登出目前帳號，接著會開啟瀏覽器。'
  Write-Host '請選擇這次要部署的 Google 帳號；每個帳號會使用自己的 GAS 專案與網址。' -ForegroundColor Yellow
  Write-Host ''
  Read-Host '按 Enter 開始更換帳號' | Out-Null

  & clasp logout 2>$null | Out-Null
  & clasp login
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host 'Google 帳號登入未完成，尚未進行部署。' -ForegroundColor Red
    Wait-ForUser
    return
  }

  Write-Host ''
  if (-not (Ensure-Account)) {
    Wait-ForUser
    return
  }

  Write-Host ''
  $confirm = Read-Host '確認帳號正確並開始部署？(y/N)'
  if ($confirm -ieq 'y') {
    Start-Deploy
  }
}

if (-not (Get-Command clasp -ErrorAction SilentlyContinue)) {
  Clear-Host
  Write-Host '找不到 Google clasp 部署工具。' -ForegroundColor Red
  Write-Host '請先安裝 Node.js，再執行：npm install -g @google/clasp'
  Wait-ForUser
  exit 1
}

if ($Validate) {
  $requiredFunctions = @('Get-ClaspAccountEmail', 'Use-DeploymentAccountProfile', 'Save-DeploymentAccountProfile')
  foreach ($name in $requiredFunctions) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
      Write-Host "部署選單環境檢查失敗：缺少 $name" -ForegroundColor Red
      exit 1
    }
  }
  Write-Host '部署選單環境檢查：OK（多帳號管理元件已載入）' -ForegroundColor Green
  exit 0
}

while ($true) {
  Clear-Host
  Write-Host '=================================================='
  Write-Host '            宮廟報名表產生器（Notion 版）'
  Write-Host '=================================================='
  Write-Host ''
  $activeAccount = Get-ActiveDeploymentAccount
  if ($activeAccount) {
    Write-Host "目前作用中的部署帳號：$activeAccount" -ForegroundColor Yellow
  } else {
    Write-Host '尚未建立帳號部署設定；第一次登入後會自動建立。' -ForegroundColor Yellow
  }
  Write-Host '每個帳號的 Script ID、部署 ID 與網址會分開保存，不會互相覆蓋。' -ForegroundColor Yellow
  Write-Host ''
  if (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.deploy-id.txt')) {
    Write-Host '  1. 直接更新既有部署（網址不變）'
  } else {
    Write-Host '  1. 首次建立並部署產生器'
  }
  Write-Host '  2. 更換 Google 帳號後部署'
  Write-Host '  3. 查看目前登入帳號'
  Write-Host '  4. 顯示已儲存的產生器網址'
  Write-Host '  0. 離開'
  Write-Host ''

  $selection = Read-Host '請輸入選項 [1/2/3/4/0]'
  switch ($selection) {
    '1' {
      Clear-Host
      if (Ensure-Account) {
        Write-Host ''
        $confirm = Read-Host '確認使用這個帳號繼續部署？(y/N)'
        if ($confirm -ieq 'y') { Start-Deploy }
      } else {
        Wait-ForUser
      }
    }
    '2' { Change-AccountAndDeploy }
    '3' {
      Clear-Host
      Show-Account | Out-Null
      Wait-ForUser
    }
    '4' {
      Clear-Host
      if (Show-Account) {
        Write-Host ''
        $urlFile = Join-Path $PSScriptRoot '部署網址.txt'
        if (Test-Path -LiteralPath $urlFile) {
          Write-Host '此帳號已儲存的產生器網址：' -ForegroundColor Cyan
          Get-Content -LiteralPath $urlFile | Out-Host
        } else {
          Write-Host '此帳號尚未儲存網址；完成第一次部署後會自動建立。' -ForegroundColor Yellow
        }
      } else {
        Write-Host '請先登入 Google 帳號。' -ForegroundColor Yellow
      }
      Wait-ForUser
    }
    '0' { exit 0 }
    default {
      Write-Host '選項無效，請重新輸入。' -ForegroundColor Yellow
      Start-Sleep -Seconds 1
    }
  }
}
