@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem Start the four local application services. Firmware is built separately with ESP-IDF.
if not exist "AI_SERVER\.venv\Scripts\python.exe" goto :missing_dependencies
if not exist "frontend\.venv\Scripts\python.exe" goto :missing_dependencies
if not exist "BE\node_modules\.package-lock.json" goto :missing_dependencies

where.exe node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20.19 or newer, then run install_all.bat.
  pause
  exit /b 1
)

if not exist "AI_SERVER\.env" (
  copy /Y "AI_SERVER\.env.example" "AI_SERVER\.env" >nul
  echo Created AI_SERVER\.env from its example.
  echo Configure the Backend service tokens in AI_SERVER\.env, then run this file again.
  pause
  exit /b 1
)

if not exist "BE\.env" (
  copy /Y "BE\.env.example" "BE\.env" >nul
  echo Created BE\.env from its example.
  echo Configure MySQL credentials, JWT secrets, APP_ENCRYPTION_KEY, and ADMIN_PASSWORD.
  echo Apply the database migration with: cd /d "%~dp0BE" ^&^& npm.cmd run migration:run
  echo Then run this file again.
  pause
  exit /b 1
)

findstr /L /C:"DB_PASSWORD=replace_with_your_mysql_password" "BE\.env" >nul
if not errorlevel 1 (
  echo Replace the sample DB_PASSWORD in BE\.env with your MySQL password.
  pause
  exit /b 1
)
findstr /L /C:"JWT_ACCESS_SECRET=replace_with_random_access_secret_at_least_32_chars" "BE\.env" >nul
if not errorlevel 1 (
  echo Set separate random JWT secrets of at least 32 characters in BE\.env.
  pause
  exit /b 1
)
findstr /L /C:"JWT_REFRESH_SECRET=replace_with_a_different_refresh_secret_at_least_32_chars" "BE\.env" >nul
if not errorlevel 1 (
  echo Set separate random JWT secrets of at least 32 characters in BE\.env.
  pause
  exit /b 1
)
findstr /L /C:"APP_ENCRYPTION_KEY=replace_with_32_byte_base64url_key_generated_locally" "BE\.env" >nul
if not errorlevel 1 (
  echo Set APP_ENCRYPTION_KEY in BE\.env to a generated 32-byte base64url key.
  pause
  exit /b 1
)
findstr /L /C:"ADMIN_PASSWORD=replace_with_a_strong_admin_password" "BE\.env" >nul
if not errorlevel 1 (
  echo Set a strong ADMIN_PASSWORD in BE\.env before startup.
  pause
  exit /b 1
)

echo Starting AIVA-IoT services in separate windows...
rem Clear ERRORLEVEL left by successful negative findstr checks above.
ver >nul

rem Start Backend first so integrated authorize/config/quota calls have a target.
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul
if errorlevel 1 start "AIVA Backend" /D "%~dp0BE" "%ComSpec%" /k npm.cmd run start:dev

rem Give NestJS a moment to bind before starting the media services.
timeout /t 3 /nobreak >nul

netstat -ano | findstr /R /C:":8000 .*LISTENING" >nul
if errorlevel 1 (
  start "AIVA AI Server LAN" /D "%~dp0AI_SERVER" "%ComSpec%" /k call run_lan.cmd
) else (
  echo AI Server is already listening on port 8000; keeping the existing process.
)
ver >nul
netstat -ano | findstr /R /C:":8081 .*LISTENING" >nul
if errorlevel 1 (
  start "AIVA Robot Gateway" /D "%~dp0AI_SERVER" "%ComSpec%" /k .venv\Scripts\python.exe scripts\run_robot_gateway.py
) else (
  echo Robot Gateway is already listening on 127.0.0.1:8081; keeping the existing process.
)
ver >nul
netstat -ano | findstr /R /C:":8501 .*LISTENING" >nul
if errorlevel 1 start "AIVA Frontend" /D "%~dp0frontend" "%ComSpec%" /k .venv\Scripts\python.exe -m streamlit run app.py --server.port 8501

echo Started or reused AI Server LAN at port 8000, Robot Gateway at 127.0.0.1:8081, Backend at port 3000, and Streamlit at port 8501.
timeout /t 2 /nobreak >nul
echo Current listeners:
netstat -ano | findstr /R /C:":3000 .*LISTENING" /C:":8000 .*LISTENING" /C:":8081 .*LISTENING" /C:":8501 .*LISTENING"
echo Backend requires MySQL and the aiva_iot database migration to be ready.
echo WIFI_INTERNET requires Tailscale Funnel to forward the public hostname to 127.0.0.1:8081.
echo Firmware is built separately after loading ESP-IDF 6.0.3:
echo   cd /d "%~dp0xiaozhi-esp32"
echo   py scripts\build.py
pause
exit /b 0

:missing_dependencies
echo Dependencies are missing. Run install_all.bat first.
pause
exit /b 1

:start_failed
echo Could not start all service windows. Check Windows command and application availability.
pause
exit /b 1
