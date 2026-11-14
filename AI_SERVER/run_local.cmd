@echo off
setlocal
cd /d "%~dp0"
"%~dp0.venv\Scripts\python.exe" scripts\run_local.py
exit /b %ERRORLEVEL%
