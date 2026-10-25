#requires -Version 7

# 每個 Google 帳號各自保存 Apps Script 專案、部署 ID 與網址。
# 根目錄只放目前帳號的作用中副本，讓既有 clasp 指令仍可直接使用。
$script:DeploymentProfilesDir = Join-Path $PSScriptRoot '.deploy-accounts'
$script:DeploymentActiveFile = Join-Path $PSScriptRoot '.active-deploy-account.txt'
$script:DeploymentStateFiles = @(
  '.clasp.json',
  '.deploy-id.txt',
  '部署網址.txt',
  '報名表網址.txt',
  '報名查詢網址.txt',
  '後台網址.txt',
  '網址清單.txt'
)
$script:LastClaspAuthorizationKnown = $false
$script:LastClaspAuthorized = $false

function Get-ClaspAccountEmail([switch]$SkipProfileProbe) {
  $accountOutput = & clasp --json show-authorized-user 2>&1
  $accountExit = $LASTEXITCODE
  $accountText = ($accountOutput | Out-String).Trim()
  $script:LastClaspAuthorizationKnown = $true
  $script:LastClaspAuthorized = $false
  if ($accountExit -ne 0) { return $null }

  try {
    $auth = $accountText | ConvertFrom-Json
    $script:LastClaspAuthorized = [bool]$auth.loggedIn
    if (-not $auth.loggedIn) { return $null }
    if ($auth.email -and (Test-GoogleAccountEmail $auth.email)) {
      return $auth.email.ToLowerInvariant()
    }
  }
  catch {
    # 相容 clasp 2.x 與測試替身的純文字輸出。
    $match = [regex]::Match($accountText, '(?i)[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}')
    $notLoggedIn = $accountText -match '(?i)not logged in|no credentials|unauthorized'
    if ($notLoggedIn) { return $null }
    $script:LastClaspAuthorized = $true
    if (-not $match.Success) { return $null }
    return $match.Value.ToLowerInvariant()
  }

  if ($SkipProfileProbe) { return $null }

  # clasp 3.x 可能只有 loggedIn:true，卻因 Workspace 重新驗證而拿不到 email。
  # 逐一用已保存的唯讀專案設定探測，避免把 A 帳號的部署 ID 套到 B 帳號。
  $accessibleProfiles = @(
    Get-DeploymentAccountProfiles | Where-Object {
      Test-ClaspCanAccessDeploymentProfile $_
    }
  )
  if ($accessibleProfiles.Count -eq 1) {
    return $accessibleProfiles[0].ToLowerInvariant()
  }
  return $null
}

function Test-ClaspAuthorized([switch]$UseCachedResult) {
  if ($UseCachedResult -and $script:LastClaspAuthorizationKnown) {
    return $script:LastClaspAuthorized
  }
  $accountOutput = & clasp --json show-authorized-user 2>&1
  if ($LASTEXITCODE -ne 0) { return $false }
  try {
    $auth = (($accountOutput | Out-String).Trim() | ConvertFrom-Json)
    return [bool]$auth.loggedIn
  }
  catch {
    $accountText = ($accountOutput | Out-String).Trim()
    return ($accountText -notmatch '(?i)not logged in|no credentials|unauthorized')
  }
}

function Test-GoogleAccountEmail([string]$Email) {
  return [bool]($Email -match '(?i)^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$')
}

function Test-ClaspCanAccessDeploymentProfile([string]$Email) {
  $profileProject = Join-Path (Get-DeploymentProfileDir $Email) '.clasp.json'
  if (-not (Test-Path -LiteralPath $profileProject)) { return $false }
  & clasp --project $profileProject list-deployments 2>&1 | Out-Null
  return ($LASTEXITCODE -eq 0)
}

function Get-DeploymentProfileDir([string]$Email) {
  $key = $Email.ToLowerInvariant() -replace '[^a-z0-9@._-]', '_'
  return (Join-Path $script:DeploymentProfilesDir $key)
}

function Get-ActiveDeploymentAccount {
  if (-not (Test-Path -LiteralPath $script:DeploymentActiveFile)) { return $null }
  $value = (Get-Content -LiteralPath $script:DeploymentActiveFile -Raw).Trim().ToLowerInvariant()
  if ($value) { return $value }
  return $null
}

function Set-ActiveDeploymentAccount([string]$Email) {
  Set-Content -LiteralPath $script:DeploymentActiveFile -Value $Email.ToLowerInvariant() -Encoding utf8 -NoNewline
}

function Save-DeploymentAccountProfile([string]$Email) {
  if (-not $Email) { return }
  $profileDir = Get-DeploymentProfileDir $Email
  New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $profileDir 'account.txt') -Value $Email.ToLowerInvariant() -Encoding utf8 -NoNewline
  foreach ($name in $script:DeploymentStateFiles) {
    $source = Join-Path $PSScriptRoot $name
    $destination = Join-Path $profileDir $name
    if (Test-Path -LiteralPath $source) {
      Copy-Item -LiteralPath $source -Destination $destination -Force
    } elseif (Test-Path -LiteralPath $destination) {
      Remove-Item -LiteralPath $destination -Force
    }
  }
}

function Move-ActiveDeploymentStateToProfile([string]$Email) {
  if (-not $Email) { return }
  $profileDir = Get-DeploymentProfileDir $Email
  New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $profileDir 'account.txt') -Value $Email.ToLowerInvariant() -Encoding utf8 -NoNewline
  foreach ($name in $script:DeploymentStateFiles) {
    $source = Join-Path $PSScriptRoot $name
    $destination = Join-Path $profileDir $name
    if (Test-Path -LiteralPath $source) {
      Move-Item -LiteralPath $source -Destination $destination -Force
    } elseif (Test-Path -LiteralPath $destination) {
      Remove-Item -LiteralPath $destination -Force
    }
  }
}

function Restore-DeploymentAccountProfile([string]$Email) {
  $profileDir = Get-DeploymentProfileDir $Email
  if (-not (Test-Path -LiteralPath $profileDir)) { return $false }
  foreach ($name in $script:DeploymentStateFiles) {
    $source = Join-Path $profileDir $name
    if (Test-Path -LiteralPath $source) {
      Copy-Item -LiteralPath $source -Destination (Join-Path $PSScriptRoot $name) -Force
    }
  }
  return $true
}

function Use-DeploymentAccountProfile([string]$Email) {
  if (-not $Email) { throw '無法判斷目前 Google 帳號。' }
  $Email = $Email.ToLowerInvariant()
  $activeEmail = Get-ActiveDeploymentAccount

  if (-not $activeEmail) {
    if (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.clasp.json')) {
      # 舊版沒有帳號標記；只有目前帳號確實能讀取該 Script，才把現況歸到這個帳號。
      $probeOutput = & clasp list-deployments 2>&1
      $probeExit = $LASTEXITCODE
      if ($probeExit -eq 0) {
        Set-ActiveDeploymentAccount $Email
        Save-DeploymentAccountProfile $Email
        return $Email
      }

      $archiveName = '_unassigned_' + (Get-Date -Format 'yyyyMMdd_HHmmss')
      $archiveDir = Join-Path $script:DeploymentProfilesDir $archiveName
      New-Item -ItemType Directory -Path $archiveDir -Force | Out-Null
      foreach ($name in $script:DeploymentStateFiles) {
        $source = Join-Path $PSScriptRoot $name
        if (Test-Path -LiteralPath $source) {
          Move-Item -LiteralPath $source -Destination (Join-Path $archiveDir $name) -Force
        }
      }
      Set-Content -LiteralPath (Join-Path $archiveDir 'README.txt') -Value '此為無法由當時登入帳號讀取的舊部署設定，已自動保留，未刪除。' -Encoding utf8
    }

    Restore-DeploymentAccountProfile $Email | Out-Null
    Set-ActiveDeploymentAccount $Email
    return $Email
  }

  if ($activeEmail -ne $Email) {
    Move-ActiveDeploymentStateToProfile $activeEmail
    Restore-DeploymentAccountProfile $Email | Out-Null
    Set-ActiveDeploymentAccount $Email
  }

  return $Email
}

function Get-DeploymentAccountProfiles {
  if (-not (Test-Path -LiteralPath $script:DeploymentProfilesDir)) { return @() }
  return @(
    Get-ChildItem -LiteralPath $script:DeploymentProfilesDir -Directory |
      ForEach-Object {
        $accountFile = Join-Path $_.FullName 'account.txt'
        if (Test-Path -LiteralPath $accountFile) {
          (Get-Content -LiteralPath $accountFile -Raw).Trim()
        }
      } |
      Where-Object { $_ } |
      Sort-Object -Unique
  )
}

function Test-DeploymentIdInClaspOutput([string]$DeploymentId, [string]$Output) {
  if (-not $DeploymentId) { return $false }
  $pattern = '(?m)^-\s+' + [regex]::Escape($DeploymentId) + '(?:\s|$)'
  return $Output -match $pattern
}
