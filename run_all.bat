@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "AIVA_ROOT=%~dp0"
if not exist "%AIVA_ROOT%AI_SERVER\.venv\Scripts\python.exe" (
  echo AIVA-IoT REAL SERVICES
  echo BLOCKED: AI_SERVER\.venv\Scripts\python.exe is missing. No dependency was installed.
  pause
  exit /b 1
)
"%AIVA_ROOT%AI_SERVER\.venv\Scripts\python.exe" -u -B "%AIVA_ROOT%tools\real_launcher\launch.py" %*
set "AIVA_EXIT=%ERRORLEVEL%"
if not "%AIVA_EXIT%"=="0" if "%~1"=="" pause
exit /b %AIVA_EXIT%