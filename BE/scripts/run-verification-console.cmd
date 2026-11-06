@echo off
setlocal
cd /d "%~dp0.."
set "AIVA_NODE_EXE=%ProgramFiles%\nodejs\node.exe"
"%AIVA_NODE_EXE%" -e "const s=require('net').createServer();s.on('error',()=>process.exit(1));s.listen(3000,'127.0.0.1',()=>s.close());"
if errorlevel 1 (
  echo Port 3000 is already in use. No Backend was started.
  pause
  exit /b 1
)
set "NODE_ENV=development"
set "EMAIL_VERIFICATION_DELIVERY=development-console"
set "EMAIL_VERIFICATION_FRONTEND_URL=http://127.0.0.1:8513"
echo AIVA Backend private verification console. Do not record or share verification links.
"%AIVA_NODE_EXE%" dist\main.js
echo Backend exited. No automatic restart will be attempted.
pause