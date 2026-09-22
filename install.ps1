<#
  install.ps1 — 把 pi-plugin-manager 部署到本机 pi（Windows）

  做三件事（只做你让它做的）：
    1. 面板（默认）          extensions\index.ts + descriptions.json → <agent>\extensions\plugin-manager\
    2. 汉化组件（-WithLocalize）localize\ → <pi 根>\localize\，localize\zh-autocomplete\ → <agent>\extensions\zh-autocomplete\
    3. 打印接下来你该亲手做的事

  两条安全约定（这个脚本永远不会做）：
    · 绝不覆盖你已有的 descriptions.json —— 那是你自己写的插件中文简介，除非显式加 -Force
    · 绝不碰 localize\backup\ 和 localize\last-report.json —— 英文原文备份 + 上次体检报告

  用法：
    # 只装面板（推荐先这样）
    powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1

    # 面板 + 可选汉化组件
    powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -WithLocalize

    # 指定 pi 根目录（含 agent\ 的那个目录），并允许覆盖 descriptions.json
    powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Root D:\pi-agent -Force

    # 只看看会做什么，不写任何文件
    powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -WhatIf
#>
[CmdletBinding()]
param(
    [string]$Root,
    [string]$AgentDir,
    [string]$LocalizeHome,
    [switch]$WithLocalize,
    [switch]$Force,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$Repo = $PSScriptRoot

if (-not (Test-Path -LiteralPath (Join-Path $Repo 'package.json'))) {
    Write-Host "install.ps1 必须在仓库根目录运行（找不到 package.json：$Repo）" -ForegroundColor Red
    exit 2
}

# ---- 1) 解析目标位置 ----
if (-not $Root) { $Root = $env:PI_ROOT }
if (-not $Root -and $env:PI_CODING_AGENT_DIR) { $Root = Split-Path -Parent $env:PI_CODING_AGENT_DIR }
if (-not $Root) {
    Write-Host '无法确定 pi 根目录。' -ForegroundColor Red
    Write-Host '请传 -Root <目录>（里面应当有 agent\ 子目录），或设置环境变量 PI_ROOT。' -ForegroundColor Red
    exit 2
}
if (-not $AgentDir) { if ($env:PI_CODING_AGENT_DIR) { $AgentDir = $env:PI_CODING_AGENT_DIR } else { $AgentDir = Join-Path $Root 'agent' } }
if (-not $LocalizeHome) { if ($env:PI_LOCALIZE_DIR) { $LocalizeHome = $env:PI_LOCALIZE_DIR } else { $LocalizeHome = Join-Path $Root 'localize' } }

$PanelDir = Join-Path $AgentDir 'extensions\plugin-manager'
$AutoDir = Join-Path $AgentDir 'extensions\zh-autocomplete'
$PanelSrc = Join-Path $Repo 'extensions'
$LocalizeSrc = Join-Path $Repo 'localize'

Write-Host ''
Write-Host '  pi 根目录      : ' -NoNewline; Write-Host $Root -ForegroundColor Cyan
Write-Host '  agent 目录     : ' -NoNewline; Write-Host $AgentDir -ForegroundColor Cyan
Write-Host '  面板目标       : ' -NoNewline; Write-Host $PanelDir -ForegroundColor Cyan
if ($WithLocalize) {
    Write-Host '  汉化组件目标   : ' -NoNewline; Write-Host $LocalizeHome -ForegroundColor Cyan
    Write-Host '  补全词典扩展   : ' -NoNewline; Write-Host $AutoDir -ForegroundColor Cyan
}
Write-Host ''

# ---- 2) 计划做什么 ----
$plan = @()
$plan += @{ Kind = 'file'; Always = $true; From = (Join-Path $PanelSrc 'index.ts'); To = (Join-Path $PanelDir 'index.ts'); What = '面板扩展（会被覆盖更新）' }
$plan += @{ Kind = 'file'; Always = $false; From = (Join-Path $Repo 'descriptions.json'); To = (Join-Path $PanelDir 'descriptions.json'); What = '插件中文简介（已存在则保留）' }

if ($WithLocalize) {
    $keepOut = @('backup', 'last-report.json', 'extracted.json', 'keybindings.json', 'settings-items.json', 'candidates.txt')
    foreach ($item in Get-ChildItem -LiteralPath $LocalizeSrc -Force) {
        if ($keepOut -contains $item.Name) { continue }
        if ($item.PSIsContainer) { continue }   # 子目录单独处理，避免把 backup\ 之类带进去
        $plan += @{ Kind = 'file'; Always = $true; From = $item.FullName; To = (Join-Path $LocalizeHome $item.Name); What = '汉化工具包' }
    }
    $plan += @{ Kind = 'dir'; Always = $true; From = (Join-Path $LocalizeSrc 'plugin'); To = (Join-Path $LocalizeHome 'plugin'); What = '汉化工具包的脚本' }
    $plan += @{ Kind = 'file'; Always = $true; From = (Join-Path $LocalizeSrc 'zh-autocomplete\index.ts'); To = (Join-Path $AutoDir 'index.ts'); What = 'zh-autocomplete 扩展' }
    $plan += @{ Kind = 'file'; Always = $false; From = (Join-Path $LocalizeSrc 'zh-autocomplete\dict.json'); To = (Join-Path $AutoDir 'dict.json'); What = '补全词典（已存在则保留）' }
}

if ($WhatIf) {
    Write-Host 'WhatIf: 会写入以下内容（什么都没做）' -ForegroundColor Cyan
    foreach ($p in $plan) {
        $exists = Test-Path -LiteralPath $p.To
        $mark = if ($p.Always -or -not $exists -or $Force) { 'write' } else { 'skip ' }
        Write-Host ("  [{0}] {1}  ← {2}" -f $mark, $p.To, $p.What)
    }
    Write-Host ''
    Write-Host 'WhatIf: 未写入任何文件。' -ForegroundColor Cyan
    exit 0
}

# ---- 3) 执行 ----
$new = New-Item -ItemType Directory -Force -Path $PanelDir
if ($WithLocalize) { $null = New-Item -ItemType Directory -Force -Path $LocalizeHome, $AutoDir, (Join-Path $LocalizeHome 'plugin') }

foreach ($p in $plan) {
    $exists = Test-Path -LiteralPath $p.To
    if (-not $p.Always -and $exists -and -not $Force) {
        Write-Host ("  skip   {0}  （已存在，保留你自己的版本）" -f $p.To) -ForegroundColor Yellow
        continue
    }
    if ($p.Kind -eq 'dir') {
        Copy-Item -Path (Join-Path $p.From '*') -Destination $p.To -Recurse -Force
    } else {
        Copy-Item -LiteralPath $p.From -Destination $p.To -Force
    }
    Write-Host ("  write  {0}" -f $p.To) -ForegroundColor Green
}

# 真实安装的 localize 目录才是「英文原文备份」的家；装完顺手体检一次
if ($WithLocalize) {
    Write-Host ''
    Write-Host '  体检：node patch.mjs --check' -ForegroundColor Cyan
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) {
        Push-Location $LocalizeHome
        try { & $node.Source 'patch.mjs' '--check' | Select-Object -Last 8 | ForEach-Object { Write-Host "    $_" } }
        catch { Write-Host '    体检没跑成（可以手动在 localize 目录里执行 node patch.mjs --check）' -ForegroundColor Yellow }
        finally { Pop-Location }
    } else {
        Write-Host '    没找到 node，跳过体检' -ForegroundColor Yellow
    }
}

# ---- 4) 接下来 ----
Write-Host ''
Write-Host '接下来（这些需要你亲手做）：' -ForegroundColor Cyan
Write-Host '  1) 重启 pi，或在 pi 里执行 /reload'
Write-Host '  2) 在 pi 里输入 /plugin-manager 打开面板'
Write-Host '  3) 想加中文简介：编辑' -NoNewline; Write-Host (Join-Path $PanelDir 'descriptions.json')
if ($WithLocalize) {
    Write-Host '  4) 汉化：node ' -NoNewline; Write-Host (Join-Path $LocalizeHome 'patch.mjs') -NoNewline; Write-Host ' --apply --verify'
    Write-Host '     pi 升级后 dist 会被覆盖，重新跑一次 --apply 即可'
}
Write-Host ''
Write-Host '卸载：删掉' -NoNewline; Write-Host " $PanelDir" -NoNewline; Write-Host ' 即可；汉化若要还原：node patch.mjs --revert' -ForegroundColor DarkGray
Write-Host ''
