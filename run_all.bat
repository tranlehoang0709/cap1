@echo off
rem Compatibility entrypoint. The pure-batch launcher avoids PowerShell ExecutionPolicy.
call "%~dp0run.bat" %*
exit /b %ERRORLEVEL%
