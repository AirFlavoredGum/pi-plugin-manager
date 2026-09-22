# CHANGELOG

本仓库同时发布两个可独立安装的包：

| 包 | 内容 | 版本 |
|---|---|---|
| `pi-plugin-manager` | `/plugin-manager` 插件开关面板 | 1.0.0 |
| `pi-zh-localize`（可选） | pi 界面汉化工具包 | 1.0.0 |

---

## v1.0.0 — 首次发布

### `pi-plugin-manager` 1.0.0

- 新命令 **`/plugin-manager`**（原为 `/resources`）：一屏启停已装插件的
  `extensions` / `skills` / `prompts` / `themes`，`space` 连切、`esc` 关闭并自动 reload
- 面板标题显示版本号（`Plugin Manager v1.0.0`），命令描述里也带版本
- **按插件分组**：每组标题带版本号、简介、`启用 x/y` 计数；资源类型再分小标题
- 简介来源：插件自己 `package.json` 的 `description` → 被 `descriptions.json` 覆盖（支持中文，搜索两种都匹配）
- 写入 `settings.json` 走官方 pattern 语法（`+path` / `-path` / `!glob`），与 `pi config` 互通；
  过滤规则被清空后自动收回成最简字符串写法
- `/` 搜索、`r` 重新扫描、TUI 尺寸自适应（插件简介放不下时自动换行）
- **汉化行改为可选**：找不到 `localize/patch.mjs` 就不显示，插件开关不受影响；
  行上会显示汉化组件自己的版本号
- `descriptions.json` 改为**相对扩展目录**定位（先看同级、再看包根），装在哪儿都不会失效
- `install.ps1`：`-WithLocalize` / `-Force` / `-WhatIf`；绝不覆盖已有的 `descriptions.json`

### `pi-zh-localize` 1.0.0（可选）

- 新增版本号：`package.json` + `node patch.mjs --version`（`-V` / `--help` 同义）
- **pi 安装目录自动定位**：`--pkg` → `PI_PKG_DIR` → 由 `PI_CODING_AGENT_DIR` 推算 → `PATH` 上的 `pi` → 本机默认。
  不再写死 `D:\pi-agent\current\...`
- **打包 chunk 自动重定位**：词典新增 `mainFileProbe`，chunk 哈希名变化后自动在
  `dist/bundle/chunks` 里找回主 chunk。修复了 pi 0.86.1 → 0.87.0 升级后
  **196 条词条全部报「目标文件不存在」**的问题（现在实测：可汉化 195 / 未匹配 0）
- `--check` **不再写英文原文备份**（只有 `--apply` 才写）—— 修掉「体检污染备份」的隐患
- 插件词典 `roots` 改为**相对路径**（相对 `<agent>\npm\node_modules`），
  可用 `PI_PLUGIN_NM_DIR` 覆盖；`plugin/build-dict.mjs` 同步改
- 新增 `plugin/paths.mjs`：agent / npm / pi 包 / 各扩展目录统一解析，
  `build-dict` / `build-autocomplete-dict` / `verify-syntax` / `verify-all` / `test-autocomplete` /
  `scan` / `scan2` / `extract*` / `ctx` 全部改用，脚本不再写死盘符
- `verify-syntax.mjs`：`.ts` 改用 **pi 自带 esbuild** 转译再 `node --check`
  （原先的 jiti `transform` 在 Windows 路径下会直接 ParseError，等于没验证）
- `verify-all.mjs`：修掉同样的 jiti 问题；新增第七项「版本号一致性」检查；
  `/resources` → `/plugin-manager` 路径与文案同步更新
- 汉化组件带自己的 `package.json`（`scripts: check / apply / revert / verify`）
