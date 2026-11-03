@echo off
setlocal
cd /d "%~dp0"
rem Limit PATH to this process; avoid unavailable global executable paths.
set "PATH=%~dp0.venv\Scripts;%SystemRoot%\System32;%SystemRoot%"
"%~dp0.venv\Scripts\python.exe" scripts\run_dev.py
exit /b %ERRORLEVEL%
