@echo off
rem 还原插件（第三方扩展）的界面汉化，pi 本体汉化不受影响
setlocal
cd /d "%~dp0"
node patch.mjs --dict zh-plugins.json --revert
echo.
pause
endlocal
