@echo off
setlocal EnableExtensions
rem Unified startup: never overwrite environments, install packages or migrate.
set "AIVA_ACTION=%~1"
if not defined AIVA_ACTION set "AIVA_ACTION=start"
if /I not "%AIVA_ACTION%"=="start" if /I not "%AIVA_ACTION%"=="status" if /I not "%AIVA_ACTION%"=="stop" (
  echo Usage: run_all.bat [start^|status^|stop]
  exit /b 2
)
powershell.exe -NoProfile -File "%~dp0scripts\startup.ps1" -Action "%AIVA_ACTION%"
exit /b %ERRORLEVEL%
