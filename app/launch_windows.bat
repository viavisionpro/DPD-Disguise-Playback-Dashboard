@echo off
setlocal
cd /d "%~dp0.."
set "PYTHONDONTWRITEBYTECODE=1"
set "PIP_DISABLE_PIP_VERSION_CHECK=1"
set "PIP_CACHE_DIR=%CD%\.private\pip-cache"
set "DPD_PYTHON=%CD%\.private\.venv\Scripts\python.exe"
echo Disguise Playback Dashboard v0.4.13
if exist "%DPD_PYTHON%" (
  "%DPD_PYTHON%" -c "import sys,ssl,venv; raise SystemExit(0 if (3,10) <= sys.version_info < (4,0) else 1)" >nul 2>&1
  if errorlevel 1 goto invalid_env
) else (
  py -3 -c "import sys,ssl,venv; raise SystemExit(0 if (3,10) <= sys.version_info < (4,0) else 1)" >nul 2>&1
  if errorlevel 1 goto missing_python
  py -3 -m venv ".private\.venv"
  if errorlevel 1 goto failed
)
"%DPD_PYTHON%" --version
"%DPD_PYTHON%" -m pip --version >nul 2>&1
if errorlevel 1 (
  "%DPD_PYTHON%" -m ensurepip --upgrade
  if errorlevel 1 goto failed
)
call :dependencies_ok
if errorlevel 1 (
  "%DPD_PYTHON%" -m pip install --upgrade -r "app\requirements.txt"
  if errorlevel 1 goto failed
  call :dependencies_ok
  if errorlevel 1 (
    "%DPD_PYTHON%" -m pip install --upgrade pip
    if errorlevel 1 goto failed
    "%DPD_PYTHON%" -m pip install --force-reinstall -r "app\requirements.txt"
    if errorlevel 1 goto failed
    call :dependencies_ok
    if errorlevel 1 goto failed
  )
)
if not exist "config.json" if not exist ".private\config.json" (
  if not exist ".private" mkdir ".private"
  copy /y "app\config.example.json" ".private\config.json" >nul
  if errorlevel 1 goto failed
)
if "%~1"=="install" (
  echo Ready. Open DEMO.bat, START.bat or WINDOW.bat.
  pause
  exit /b 0
)
if "%~1"=="demo" (
  "%DPD_PYTHON%" "app\server.py" --demo --open
) else if "%~1"=="start" (
  "%DPD_PYTHON%" "app\server.py" --open
) else if "%~1"=="window" (
  "%DPD_PYTHON%" -m app.window
) else (
  echo Unknown launch mode: %~1
  goto failed
)
if errorlevel 1 goto failed
exit /b 0

:dependencies_ok
"%DPD_PYTHON%" -m pip install --dry-run --no-index --no-deps -r "app\requirements.txt" >nul 2>&1
if errorlevel 1 exit /b 1
"%DPD_PYTHON%" -m pip check >nul 2>&1
if errorlevel 1 exit /b 1
"%DPD_PYTHON%" -c "from websockets.sync.client import connect; from websockets.exceptions import ConnectionClosed" >nul 2>&1
exit /b %errorlevel%

:invalid_env
echo The local Python environment is incompatible. Rename .private\.venv and run INSTALL.bat again.
goto failed
:missing_python
echo Install Python 3.10 or newer from https://www.python.org/downloads/windows/
echo Include the Python launcher during installation, then run INSTALL.bat again.
goto failed
:failed
echo DPD could not complete the operation. Check the message above and .private\logs\dashboard.log.
pause
exit /b 1
