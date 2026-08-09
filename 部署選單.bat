@echo off
setlocal EnableExtensions
pushd "%~dp0"

where pwsh >nul 2>nul
if errorlevel 1 (
  echo PowerShell 7 is required but was not found.
  echo Install it from: https://aka.ms/powershell-release?tag=stable
  echo.
  pause
  popd
  exit /b 1
)

pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0deployment-menu.ps1"
set "MENU_EXIT=%ERRORLEVEL%"

popd
endlocal & exit /b %MENU_EXIT%
