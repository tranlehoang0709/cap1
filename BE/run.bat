@echo off
setlocal
cd /d "%~dp0"

where.exe node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20.19 or newer, then run this file again.
  pause
  exit /b 1
)

where.exe npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js with npm, then run this file again.
  pause
  exit /b 1
)

if not exist ".env" (
  copy /Y ".env.example" ".env" >nul
  echo Created .env from .env.example.
  echo Edit .env and enter your MySQL password, then run this file again.
  pause
  exit /b 1
)

findstr /L /C:"DB_PASSWORD=replace_with_your_mysql_password" ".env" >nul
if not errorlevel 1 (
  echo Replace the sample DB_PASSWORD in .env with your MySQL password, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\.package-lock.json" (
  echo Installing project dependencies from package-lock.json...
  call npm.cmd ci --no-audit --no-fund
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo Starting the AIVA-IoT backend. Press Ctrl+C to stop it.
call npm.cmd run start:dev
set "APP_EXIT_CODE=%ERRORLEVEL%"
if not "%APP_EXIT_CODE%"=="0" (
  echo Backend exited with code %APP_EXIT_CODE%.
  pause
)
exit /b %APP_EXIT_CODE%
