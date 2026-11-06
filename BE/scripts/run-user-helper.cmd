@echo off
setlocal
cd /d "%~dp0.."
set "AIVA_E2E_HELPER_STATUS_PATH=%TEMP%\aiva-user-helper-stage.json"
echo AIVA User Helper. Use only your existing User password; it is not displayed.
"%ProgramFiles%\nodejs\node.exe" scripts\prepare-user-e2e.cjs
echo Helper finished. Read its status above; no password reset or account creation occurred.
pause