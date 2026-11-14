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

echo Starting AIVA-IoT services in four separate CMD windows...
rem Clear ERRORLEVEL left by successful negative findstr checks above.
ver >nul

rem Start Backend first so integrated authorize/config/quota calls have a target.
call :start_if_missing 3000 "[AIVA Backend]" "%~dp0BE" "call npm.cmd run start:dev"

rem Give NestJS a moment to bind before starting the media services.
timeout /t 3 /nobreak >nul

call :start_if_missing 8000 "[AIVA AI_SERVER]" "%~dp0AI_SERVER" "call run_lan.cmd"
call :start_if_missing 8081 "[AIVA Gateway]" "%~dp0AI_SERVER" "call .venv\Scripts\python.exe scripts\run_robot_gateway.py"
call :start_if_missing 8501 "[AIVA Frontend]" "%~dp0frontend" "call .venv\Scripts\python.exe -m streamlit run app.py --server.port 8501"

echo Started or reused AI Server LAN at port 8000, Robot Gateway at 127.0.0.1:8081, Backend at port 3000, and Streamlit at port 8501.
timeout /t 5 /nobreak >nul
echo Current listeners:
netstat -ano | findstr /R /C:":3000 .*LISTENING" /C:":8000 .*LISTENING" /C:":8081 .*LISTENING" /C:":8501 .*LISTENING"
for %%P in (3000 8000 8081 8501) do (
  netstat -ano | findstr /R /C:":%%P .*LISTENING" >nul
  if errorlevel 1 echo ERROR: port %%P is not listening. Check the corresponding service window above.
)
echo Backend requires MySQL and the aiva_iot database migration to be ready.
echo WIFI_INTERNET requires Tailscale Funnel to forward the public hostname to 127.0.0.1:8081.
echo Firmware is built separately after loading ESP-IDF 6.0.3:
echo   cd /d "%~dp0xiaozhi-esp32"
echo   py scripts\build.py
pause
exit /b 0

:start_if_missing
set "CHECK_PORT=%~1"
set "WINDOW_TITLE=%~2"
set "SERVICE_DIR=%~3"
set "SERVICE_CMD=%~4"
netstat -ano | findstr /R /C:":%CHECK_PORT% .*LISTENING" >nul
if errorlevel 1 goto start_service
echo %WINDOW_TITLE% port %CHECK_PORT% is already listening; keeping existing PID(s):
netstat -ano | findstr /R /C:":%CHECK_PORT% .*LISTENING"
exit /b 0
:start_service
echo Opening %WINDOW_TITLE% on port %CHECK_PORT%...
start "%WINDOW_TITLE%" /D "%SERVICE_DIR%" "%ComSpec%" /d /k "%SERVICE_CMD%"
exit /b 0

:missing_dependencies
echo Dependencies are missing. Run install_all.bat first.
pause
exit /b 1

:start_failed
echo Could not start all service windows. Check Windows command and application availability.
pause
exit /b 1
