@echo off
setlocal
cd /d "%~dp0"

if not exist "AI_SERVER\.venv\Scripts\python.exe" (
  echo Dependencies are missing. Run install_all.bat first.
  pause
  exit /b 1
)
if not exist "frontend\.venv\Scripts\python.exe" (
  echo Dependencies are missing. Run install_all.bat first.
  pause
  exit /b 1
)
if not exist "BE\node_modules" (
  echo Dependencies are missing. Run install_all.bat first.
  pause
  exit /b 1
)

if not exist "AI_SERVER\.env" copy "AI_SERVER\.env.example" "AI_SERVER\.env" >nul

start "AIVA AI Server" /D "%~dp0AI_SERVER" cmd /k ".venv\Scripts\python.exe scripts\run_dev.py"
start "AIVA Backend" /D "%~dp0BE" cmd /k "npm.cmd run start:dev"
start "AIVA Frontend" /D "%~dp0frontend" cmd /k ".venv\Scripts\python.exe -m streamlit run app.py"

echo Started AI_SERVER, BE, and frontend in separate windows.
echo Firmware is not a Windows service; build it after loading ESP-IDF 6.0.2:
echo   cd /d "%~dp0xiaozhi-esp32"
echo   py scripts\build.py
echo The firmware build asks you to select a board/variant.
echo BE also needs its MySQL settings configured in BE\.env.
pause
