@echo off
rem 插件界面汉化：重新生成词典 → 检查 → 应用 → 更新补全映射 → 全量验证
setlocal
cd /d "%~dp0"

echo [1/6] 生成插件词典（从插件源码精确抽取英文原文当锚点）...
node plugin\build-dict.mjs || goto :err

echo.
echo [2/6] 检查匹配情况（要求 未匹配 0）...
node patch.mjs --dict zh-plugins.json --check || goto :err

echo.
echo [3/6] 应用汉化...
node patch.mjs --dict zh-plugins.json --apply || goto :err

echo.
echo [4/6] 生成补全映射词典（技能 / 命令说明，只改显示）...
node plugin\build-autocomplete-dict.mjs || goto :err

echo.
echo [5/6] 全量验证...
node plugin\verify-all.mjs || goto :err

echo.
echo [6/6] 完成。重启 pi，或在 pi 里执行 /reload 后生效。
pause
exit /b 0

:err
echo.
echo 出错了：把上面的输出发给助手。
echo 单独还原插件汉化：node patch.mjs --dict zh-plugins.json --revert
echo 单独还原 pi 界面汉化：node patch.mjs --revert
pause
endlocal
