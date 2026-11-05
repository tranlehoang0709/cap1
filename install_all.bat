@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

rem Install FE, BE and AI Server development dependencies on this drive.
rem No global Python packages, database migration, firmware toolchain or .env changes.
where.exe py >nul 2>nul
if errorlevel 1 goto :missing_tools
where.exe node >nul 2>nul
if errorlevel 1 goto :missing_tools
where.exe npm.cmd >nul 2>nul
if errorlevel 1 goto :missing_tools
if not exist "AI_SERVER\requirements-windows.txt" goto :missing_files
if not exist "frontend\requirements.txt" goto :missing_files
if not exist "BE\package-lock.json" goto :missing_files

if /I "%~1"=="--check" (
  echo Dependency installer prerequisites: PASS
  py -3 --version
  node --version
  npm.cmd --version
  exit /b 0
)

echo [1/3] AI Server Python environment...
if not exist "AI_SERVER\.venv\Scripts\python.exe" py -3 -m venv "AI_SERVER\.venv"
if errorlevel 1 goto :failed
"AI_SERVER\.venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r "AI_SERVER\requirements-windows.txt"
if errorlevel 1 goto :failed

echo [2/3] Frontend Python environment...
if not exist "frontend\.venv\Scripts\python.exe" py -3 -m venv "frontend\.venv"
if errorlevel 1 goto :failed
"frontend\.venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r "frontend\requirements.txt"
if errorlevel 1 goto :failed

echo [3/3] Backend packages from package-lock.json...
if not exist "BE\node_modules\.package-lock.json" (
  pushd "BE"
  if errorlevel 1 goto :failed
  call npm.cmd ci --no-audit --no-fund
  set "AIVA_NPM_EXIT=%ERRORLEVEL%"
  popd
  if not "!AIVA_NPM_EXIT!"=="0" goto :failed
) else (
  echo Backend node_modules already present; skipping npm ci.
)

echo Dependencies ready. Run run_all.bat to start the real localhost services.
exit /b 0

:missing_tools
echo Python launcher, Node.js, or npm is missing from PATH.
exit /b 1
:missing_files
echo A required dependency manifest is missing.
exit /b 1
:failed
echo Dependency setup failed; see the error above. Existing source files were not changed.
exit /b 1
