@echo off
setlocal
"%~dp0runtime\python.exe" -I "%~dp0application\portable_launcher.py" --check
echo.
pause
endlocal
