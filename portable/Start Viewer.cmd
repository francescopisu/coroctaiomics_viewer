@echo off
setlocal
"%~dp0runtime\python.exe" -I "%~dp0application\portable_launcher.py" %*
if errorlevel 1 (
  echo.
  echo The viewer could not start. See the error above and the troubleshooting guide.
  pause
)
endlocal
