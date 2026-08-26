@echo off
setlocal
title ORBIT Xbox Mode Setup
echo.
echo   ORBIT - Xbox Mode Setup
echo   Requesting administrator permission...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-OrbitXboxMode.ps1" -Launch -OpenSettings
set "ORBIT_RC=%ERRORLEVEL%"
echo.
if "%ORBIT_RC%"=="0" (
  echo [OK] ORBIT Xbox Mode was installed successfully.
) else (
  echo [FAILED] Setup exited with code %ORBIT_RC%.
)
echo.
pause
exit /b %ORBIT_RC%
