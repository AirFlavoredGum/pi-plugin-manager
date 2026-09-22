# CHANGELOG

本仓库同时发布两个可独立安装的包：

| 包 | 内容 | 版本 |
|---|---|---|
| `pi-plugin-manager` | `/plugin-manager` 插件开关面板 | 1.1.0 |
| `pi-zh-localize`（可选） | pi 界面汉化工具包 | 1.1.0 |

---

## v1.1.0 — pi 更新后自动重跑汉化（默认关闭）

新增：`/plugin-manager` 面板里多一行 **「pi 更新后自动重跑汉化」**（默认**关闭**）。
开启后，每次 pi 启动让 `localize/plugin/auto-apply.mjs` 检查一次：汉化还在就什么都不做，
掉了就自动 `--apply --verify` 补回来并通知你。

### 安全设计（七条）

- **默认关闭**，开关在面板里一行可见（不会偷偷改你的 pi）
- **快速探测**：缓存上次命中的主 chunk 名 + 一条中文标记，汉化还在就只读一个文件（约 10ms）
  就退出，不跑 patch、不碰任何文件
- 只在**真掉了**才动手（pi 改了别的文件、你已手动汉化过，都不会重复折腾）
- **单实例锁** `localize/.auto-apply.lock`（10 分钟自动过期，防止僵尸锁）
- 走的还是 `patch.mjs --apply --verify`（先备份英文原文，再跑 `pi --version` 自检）
- **自检没过 → 自动还原英文原版**，宁可退回英文也不留下一个启动不了的 pi，并弹 error 通知
- 同一 pi 版本失败过就不再重试（不刷屏）；下次 pi 升级会重新尝试

### 不跟你对着干

- 手动关汉化（`patch.mjs --revert` / `还原.cmd` / 面板里切掉）会**同时关掉**这个自动开关
  （auto-apply 自己的“自检失败自动还原”带 `--keep-intent`，保留开关等下次 pi 升级再试）
- `--dry-run` 只报告会做什么，一个字节都不写；每次动作都记进 `auto-apply.log`

### 为什么不用 mtime / 大小指纹

第一版用 `dist/bundle/chunks` 的指纹（文件数+字节+mtime）判断“pi 变了没”。
但**补丁本身就会改这些文件**，指纹会自相矛盾：记下的是打补丁前的值，或者
你手动 `--revert` 后指纹正好回到旧值 → 会把你的还原又打回去。改成内容探测后这两个问题都没了。

### 其他

- `patch.mjs`：报告里新增 `resolved.main`（本次实际命中的 chunk 名），供快速探测缓存用
- `patch.mjs --revert`：顺手把 `auto-apply.json` 的 `enabled` 置 false（可用 `--keep-intent` 保留）
- `localize/package.json` 加 `auto-apply` / `auto-apply-status` / `auto-apply-dry` 三个 npm script
- `install.ps1`：永不触碰 `auto-apply.json` / `.log` / `.lock`，并提示怎么开启自动重跑
- 测试：新增两组端到端测试（沙箱假 pi dist 9 个场景 + 面板 stub 启动路径 9 组），全部通过

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
