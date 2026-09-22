@echo off
rem pi 界面汉化：应用补丁并验证
setlocal
node "%~dp0patch.mjs" --apply --verify
echo.
pause
endlocal
