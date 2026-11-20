@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem AIVA-IoT local runtime launcher. Pure batch: no PowerShell execution policy required.
rem Starts the official Next.js frontend, NestJS backend, local Gemma runtime,
rem AI_SERVER Local and the Xiaozhi Robot Gateway. It never migrates or seeds MySQL.

set "ROOT=%~dp0"
set "BE_DIR=%ROOT%BE"
set "FE_DIR=%ROOT%frontend\next-app"
set "AI_DIR=%ROOT%AI_SERVER"

if /I "%~1"=="_llama" goto llama_worker

set "ACTION=%~1"
if not defined ACTION set "ACTION=start"
if /I "%ACTION%"=="start" goto start_all
if /I "%ACTION%"=="status" goto status_all
if /I "%ACTION%"=="stop" goto stop_all

echo Usage: run.bat [start^|status^|stop]
exit /b 2

:start_all
call :require_file "%BE_DIR%\package.json" || exit /b 1
call :require_file "%FE_DIR%\package.json" || exit /b 1
call :require_file "%AI_DIR%\.venv\Scripts\python.exe" || exit /b 1
call :require_file "%AI_DIR%\.env.local" || exit /b 1

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [FAIL] npm.cmd was not found in PATH.
  exit /b 1
)

call :start_if_free 3000 "AIVA Backend :3000" "%BE_DIR%" "npm.cmd run start"
call :start_if_free 3100 "AIVA Frontend NEW :3100" "%FE_DIR%" "npm.cmd run dev"
call :start_if_free 8001 "AIVA Llama Gemma :8001" "%ROOT%" "call ""%~f0"" _llama"
call :start_if_free 8002 "AIVA AI Local :8002" "%AI_DIR%" "call run_local.cmd"
call :start_if_free 8081 "AIVA Robot Gateway :8081" "%AI_DIR%" """%AI_DIR%\.venv\Scripts\python.exe"" scripts\run_robot_gateway.py"

echo.
echo AIVA-IoT processes were requested.
echo New frontend: http://127.0.0.1:3100/login
echo Backend:     http://127.0.0.1:3000/health
echo AI Local:    http://127.0.0.1:8002/ready
echo Run "run.bat status" after the model finishes loading.
exit /b 0

:status_all
echo AIVA-IoT listener status:
call :show_port 3000 "Backend"
call :show_port 3100 "Frontend NEW"
call :show_port 8001 "Llama.cpp"
call :show_port 8002 "AI_SERVER Local"
call :show_port 8081 "Robot Gateway"
call :show_port 8501 "Streamlit OLD - must remain stopped"
exit /b 0

:stop_all
echo Stopping only AIVA-IoT application listeners...
call :stop_port 3000 "Backend"
call :stop_port 3100 "Frontend NEW"
call :stop_port 8000 "AI_SERVER Cloud"
call :stop_port 8001 "Llama.cpp"
call :stop_port 8002 "AI_SERVER Local"
call :stop_port 8081 "Robot Gateway"
call :stop_port 8501 "Streamlit OLD"
echo MySQL and Tailscale services were not stopped.
exit /b 0

:llama_worker
set "LLAMA_EXE=%AIVA_LLAMA_SERVER%"
set "GGUF_MODEL=%AIVA_GGUF_MODEL%"

if not defined LLAMA_EXE (
  for /d %%D in ("%USERPROFILE%\llama-*-bin-win-cuda-*-x64") do if not defined LLAMA_EXE if exist "%%~fD\llama-server.exe" set "LLAMA_EXE=%%~fD\llama-server.exe"
)
if not defined GGUF_MODEL (
  for /d %%S in ("%USERPROFILE%\.cache\huggingface\hub\models--ggml-org--gemma-4-e4b-it-GGUF\snapshots\*") do if not defined GGUF_MODEL if exist "%%~fS\gemma-4-E4B-it-Q4_0.gguf" set "GGUF_MODEL=%%~fS\gemma-4-E4B-it-Q4_0.gguf"
)

if not exist "!LLAMA_EXE!" (
  echo [FAIL] llama-server.exe not found. Set AIVA_LLAMA_SERVER to its full path.
  exit /b 1
)
if not exist "!GGUF_MODEL!" (
  echo [FAIL] Gemma GGUF not found. Set AIVA_GGUF_MODEL to its full path.
  exit /b 1
)

set "LOCAL_LLM_API_KEY="
for /f "usebackq tokens=1,* delims==" %%A in ("%AI_DIR%\.env.local") do if "%%A"=="LOCAL_LLM_API_KEY" set "LOCAL_LLM_API_KEY=%%B"
if not defined LOCAL_LLM_API_KEY (
  echo [FAIL] LOCAL_LLM_API_KEY is missing from AI_SERVER\.env.local.
  exit /b 1
)

"!LLAMA_EXE!" -m "!GGUF_MODEL!" --host 127.0.0.1 --port 8001 -ngl 99 --api-key "!LOCAL_LLM_API_KEY!"
exit /b %ERRORLEVEL%

:start_if_free
call :is_listening %~1
if not errorlevel 1 (
  echo [SKIP] %~2 already listens on port %~1.
  exit /b 0
)
echo [START] %~2
start "%~2" /D "%~3" cmd.exe /d /k %~4
exit /b 0

:show_port
call :is_listening %~1
if errorlevel 1 (
  echo [STOPPED] %~2 :%~1
) else (
  echo [RUNNING] %~2 :%~1
)
exit /b 0

:stop_port
set "FOUND_PID="
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /R /C:":%~1 .*LISTENING"') do (
  set "FOUND_PID=%%P"
  echo [STOP] %~2 :%~1 PID %%P
  taskkill /PID %%P /T /F >nul 2>nul
)
if not defined FOUND_PID echo [STOPPED] %~2 :%~1 was not listening.
exit /b 0

:is_listening
netstat -ano -p tcp | findstr /R /C:":%~1 .*LISTENING" >nul 2>nul
exit /b %ERRORLEVEL%

:require_file
if exist "%~1" exit /b 0
echo [FAIL] Required file is missing: %~1
exit /b 1
