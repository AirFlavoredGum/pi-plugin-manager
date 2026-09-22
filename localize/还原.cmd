@echo off
rem pi 界面还原为英文原版
setlocal
node "%~dp0patch.mjs" --revert
echo.
pause
endlocal
