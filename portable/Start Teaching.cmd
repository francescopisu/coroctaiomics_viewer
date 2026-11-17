@echo off
setlocal
"%~dp0runtime\python.exe" -I "%~dp0application\portable_launcher.py" --mode teaching %*
if errorlevel 1 (
  echo.
  echo Unable to start teaching mode. See the error above.
  pause
)
endlocal
