@echo off
setlocal
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

echo [1/4] Installing AI_SERVER Python dependencies...
if not exist "AI_SERVER\.venv\Scripts\python.exe" py -3 -m venv "AI_SERVER\.venv"
if errorlevel 1 goto :failed
call "AI_SERVER\.venv\Scripts\python.exe" -m pip install -r "AI_SERVER\requirements-dev.txt"
if errorlevel 1 goto :failed

echo [2/4] Installing frontend Python dependencies...
if not exist "frontend\.venv\Scripts\python.exe" py -3 -m venv "frontend\.venv"
if errorlevel 1 goto :failed
call "frontend\.venv\Scripts\python.exe" -m pip install -r "frontend\requirements.txt"
if errorlevel 1 goto :failed

echo [3/4] Installing BE Node.js dependencies...
pushd BE
call npm.cmd ci --no-audit --no-fund
set "INSTALL_EXIT=%ERRORLEVEL%"
popd
if not "%INSTALL_EXIT%"=="0" goto :failed

echo [4/4] Firmware dependencies are managed by ESP-IDF.
echo Install ESP-IDF 6.0.2 and run its export.bat before building firmware.
echo Python and npm dependencies are installed.
pause
exit /b 0

:failed
echo Dependency installation failed. See the error above.
pause
exit /b 1
