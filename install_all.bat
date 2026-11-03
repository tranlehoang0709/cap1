@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where.exe py >nul 2>nul
if errorlevel 1 (
  echo Python launcher was not found. Install Python 3 and try again.
  pause
  exit /b 1
)
where.exe node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20.19 or newer and try again.
  pause
  exit /b 1
)
where.exe npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js with npm enabled, then try again.
  pause
  exit /b 1
)

if not exist "AI_SERVER\requirements-dev.txt" goto :missing_files
if not exist "frontend\requirements.txt" goto :missing_files
if not exist "BE\package.json" goto :missing_files
if not exist "BE\package-lock.json" goto :missing_files

echo [1/3] Setting up AI_SERVER Python environment...
if not exist "AI_SERVER\.venv\Scripts\python.exe" py -3 -m venv "AI_SERVER\.venv"
if errorlevel 1 goto :ai_server_failed
call "AI_SERVER\.venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r "AI_SERVER\requirements-dev.txt"
if errorlevel 1 goto :ai_server_failed

echo [2/3] Setting up frontend Python environment...
if not exist "frontend\.venv\Scripts\python.exe" py -3 -m venv "frontend\.venv"
if errorlevel 1 goto :frontend_failed
call "frontend\.venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r "frontend\requirements.txt"
if errorlevel 1 goto :frontend_failed

echo [3/3] Installing BE Node.js dependencies from package-lock.json...
pushd "BE"
if errorlevel 1 goto :backend_failed
call npm.cmd ci --no-audit --no-fund
set "INSTALL_EXIT=%ERRORLEVEL%"
popd
if not "%INSTALL_EXIT%"=="0" goto :backend_failed

echo All application dependencies are installed.
echo Next: configure AI_SERVER\.env and BE\.env, prepare MySQL, then run run_all.bat.
echo Firmware dependencies are managed by ESP-IDF 6.0.2 and are not installed here.
pause
exit /b 0

:missing_files
echo A required requirements or Node.js manifest file is missing from this project.
pause
exit /b 1

:ai_server_failed
echo AI_SERVER dependency setup failed. Review the error above and rerun this file.
pause
exit /b 1

:frontend_failed
echo Frontend dependency setup failed. Review the error above and rerun this file.
pause
exit /b 1

:backend_failed
echo BE dependency setup failed. Review the npm error above and rerun this file.
pause
exit /b 1
