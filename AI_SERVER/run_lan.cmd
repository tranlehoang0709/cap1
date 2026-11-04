@echo off
setlocal
cd /d "%~dp0"
set "PATH=%~dp0.venv\Scripts;%SystemRoot%\System32;%SystemRoot%"
"%~dp0.venv\Scripts\python.exe" scripts\run_lan.py
exit /b %ERRORLEVEL%
