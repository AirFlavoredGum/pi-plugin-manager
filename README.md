# pi-plugin-manager

一个给 [pi](https://pi.dev) 用的**插件开关面板**：`/plugin-manager` 一屏列出你装过的插件，
按 `space` 直接启停它们自带的 extensions / skills / prompts / themes，写入的是**官方 pattern 语法**，
和 `pi config` 完全互通。

附一个**可选**组件 [`pi-zh-localize`](./localize/README.md)：把 pi 界面文案汉化（词典驱动、可备份、可回滚）。
两个包**各自独立安装**，只想要面板就不用管汉化。

- 面板版本：**v1.1.0**（`pi-plugin-manager`）
- 汉化组件版本：**v1.1.0**（`pi-zh-localize`，可选）
- 平台：Windows / macOS / Linux（面板本身跨平台；`install.ps1` 与两个 `.cmd` 是 Windows 便利脚本）

---

## 一、面板长什么样

```
──────────────────────────────────────────────────────────────
  Plugin Manager v1.1.0                       启用 12 · 关闭 3
  搜索 按 / 过滤

  界面
     [x] 汉化界面 v1.1.0（重启 pi 生效） 已汉化 196 条        已汉化
     [x] pi 更新后自动重跑汉化 上次汉化 pi 0.87.0              开启

  npm:pi-subagents v1.7.2 (子代理委派与多代理编排…)   启用 4/5
     Extensions                                         启用 1/1
  >    [x] herdr-pi-bridge                                启用
       [ ] watchdog/register-main                        关闭
     Skills                                             启用 2/2
       [x] pi-subagents                                  启用
     Prompts                                            启用 1/2
       [x] parallel-review                               启用

  npm:pi-lens v2.1.0 (实时代码反馈：LSP、linter…)      启用 3/3
   ...

  ↑↓ 移动 · space 切换（可连续多个）· / 搜索 · r 刷新 · esc 关闭并生效
──────────────────────────────────────────────────────────────
```

> 「界面」那两行只有装了可选组件 `pi-zh-localize` 才会出现；没装就只是个纯插件开关面板。

| 按键 | 作用 |
|---|---|
| `↑` / `↓` | 移动（`PgUp` / `PgDn` 翻页） |
| `space` | 切换开关 —— 可以连续切任意多个，面板不会关闭 |
| `/` | 搜索（插件名、版本、简介、资源名、路径都能搜） |
| `r` | 重新扫描（识别新装的插件 / 重新检测汉化状态） |
| `esc` / `enter` | 关闭；有改动时自动 reload，开关**立即生效** |

## 二、为什么用这个而不是 `pi config`

`pi config` 是官方入口，功能完整，但它是「全量资源列表」视角：插件、技能、提示词、主题混在一个长列表里，
你很难一眼看出「这个插件一共有几个资源、开了几个」。

这个面板是**按插件分组**的视角，并补了三件事：

1. **插件级的概览**：每个插件一行标题，带版本号、中文/英文简介、`启用 x/y` 计数。
2. **中文简介**：默认读插件自己 `package.json` 的 `description`（新装插件自动就有），
   想改成自己的说法（比如中文）就编辑 [`descriptions.json`](./descriptions.json)，那份**优先**。
3. **可选的一键汉化**：装了本地化组件后，面板里会多出一行「汉化界面」，和插件开关放在一起。

两者写的是同一份 `settings.json`，随便交叉使用。

## 三、安装

### 方式 A：让 pi 自己装（推荐）

```bash
pi install git:github.com/AirFlavoredGum/pi-plugin-manager@v1.0.0
```

装完重启 pi（或 `/reload`），输入 `/plugin-manager`。

卸载：

```bash
pi remove git:github.com/AirFlavoredGum/pi-plugin-manager
```

### 方式 B：只把扩展文件放到本地（不用包管理器）

> 方式 A 与方式 B **只能选一个**，两个都做会重复注册同一个 `/plugin-manager` 命令。
> 想从 A 切成 B：先 `pi remove ...` 再跑 `install.ps1`。

```powershell
# 把 extensions\index.ts + descriptions.json 复制到 <agent>\extensions\plugin-manager\
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1

# 面板 + 可选汉化组件（汉化装到 <pi 根>\localize\）
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -WithLocalize

# 先看看会做什么
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -WhatIf
```

`install.ps1` 的两条硬性保证：

- 绝不覆盖你已有的 `descriptions.json`（那是你自己写的简介），除非加 `-Force`
- 绝不碰 `localize\backup\`（英文原文备份）和 `last-report.json`

### 方式 C：手动

把 `extensions/index.ts` 和根目录的 `descriptions.json` 放进 `<agent>\extensions\plugin-manager\`
（`<agent>` 通常是 `~/.pi/agent`，或 `PI_CODING_AGENT_DIR` 指定的目录），然后 `/reload`。

## 四、它到底改了 `settings.json` 的什么

面板只做一件事：往 `packages` 条目里写官方的包含/排除 pattern。

```jsonc
{
  "packages": [
    "npm:pi-simplify",
    {
      "source": "npm:pi-subagents",
      "extensions": ["-src/watchdog/register-main.js"],   // 关掉这一个扩展
      "prompts": ["+prompts/parallel-review.md"]           // 显式打开这一个提示词
    }
  ]
}
```

- `"path"` 包含　`"!glob"` 排除　`"+path"` 强制包含　`"-path"` 强制排除
- 某个插件的过滤规则被清空后，会自动收回成最简的字符串写法（不留垃圾字段）
- 全部走 `SettingsManager` 官方 API，不是自己拼 JSON

## 五、可选组件：pi-zh-localize（界面汉化）

装法二选一：

```bash
# a) 用 install.ps1（Windows）
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -WithLocalize

# b) 手动把 localize\ 整个目录放到 <pi 根>\localize\，然后
node localize/patch.mjs --check          # 只体检，不改文件
node localize/patch.mjs --apply --verify  # 应用（自动备份英文原文 + 启动自检）
node localize/patch.mjs --revert          # 还原英文原版
node localize/patch.mjs --version         # 版本号
```

**它是「改第三方安装包内的字符串常量」的做法，属于非官方支持**：只改界面文案，不动逻辑，
并且带五道防误伤闸门（键名白名单 / 模型名保护 / denyTexts 名单 / 命中计数 / 永不触碰 id、value、命令名、设置键名）。
完整说明与风险提示见 [`localize/README.md`](./localize/README.md)。

几条要点：

- 词典**按 pi 版本校验**：196 条对 pi 0.87.0 实测「未匹配 0」。pi 升级后重跑一次 `--apply` 即可（或者开启下面那个自动开关）。
- 打包文件带哈希名（`chunk-XXXX.js`），pi 升级后会变；词典里的 `mainFileProbe` 会**自动重新定位**主 chunk，
  所以不会出现「一升级就全部失效」。
- 插件词典（`zh-plugins.json`）的 `roots` 是相对路径，相对于 `<agent>\npm\node_modules`，
  环境变量 `PI_PLUGIN_NM_DIR` 可覆盖 —— 换机器不用改词典。
- `zh-autocomplete` 扩展只包一层**补全显示**：`SKILL.md` 的 `description` 原文不动，
  所以发给模型的系统提示词仍是英文。

### 5.1 pi 更新后自动重跑（默认**关闭**）

每次 `pi update` 都会覆盖 `dist`，汉化必然掉。开上面面板里那一行「pi 更新后自动重跑汉化」之后，
每次 pi 启动会检查一次：还在就什么都不做；掉了就自动 `--apply --verify` 补回来，并通知你结果。

怎么做到「安全一点」（这七条就是全部设计）：

| 设计 | 效果 |
|---|---|
| 默认关闭，面板里一行可见 | 不会偷偷改你的 pi；开没开一眼就能看到 |
| 快速探测：缓存主 chunk 名 + 一条中文标记 | 汉化还在 → 读一个文件（约 10ms）就退出，不跑 patch、不碰任何文件 |
| 只在真掉了才动手 | pi 修改了别的文件、或你已经手动汉化过，都不会重复折腾 |
| 单实例锁（`.auto-apply.lock`，10 分钟自动过期） | 同时开两个 pi 也不会两个进程同时改同一个文件 |
| 走的还是 `--apply --verify` | 先备份英文原文，改完立刻 `pi --version` 自检 |
| **自检没过 → 自动还原英文原版** | 宁可退回英文，也不留下一个启动不了的 pi |
| 同一 pi 版本失败过就不再重试 | 不会每次启动弹一次失败通知；下次 pi 升级会重新尝试 |

另外两条「不跟你对着干」的规则：

- 手动关汉化（面板里切掉、或双击 `还原.cmd`、或 `patch.mjs --revert`）会**顺手关掉**这个自动开关，
  否则下次启动又会被打回来。
- `--dry-run` 只报告会做什么，一个字节都不写；`auto-apply.log` 记录了它每一次做了什么。

```bash
node localize/plugin/auto-apply.mjs --status    # 看开关、上次尝试、缓存状态
node localize/plugin/auto-apply.mjs --dry-run   # 只看会做什么
node localize/plugin/auto-apply.mjs --enable    # 开启（等价于面板里按 space）
node localize/plugin/auto-apply.mjs --disable   # 关闭
```

> 它需要一个 pi 扩展在启动时触发 —— 也就是本仓库的 `/plugin-manager`。只装汉化组件不装面板，则没有自动重跑。

## 六、自定义插件简介

编辑 [`descriptions.json`](./descriptions.json)：键必须与 `settings.json` 里 `packages` 的写法**一字不差**。

```json
{
  "npm:pi-subagents": "子代理委派与多代理编排",
  "npm:@plannotator/pi-extension": "计划评审与代码评审"
}
```

- 以 `_` 开头的键会被忽略，可以当注释用
- 没登记的插件自动回落到它自己 `package.json` 的 `description`
- 搜索时中文简介与英文原始 description 都会被匹配

## 七、目录结构

```
pi-plugin-manager\
├─ package.json          ← pi 包清单（pi.extensions → ./extensions），keywords: pi-package
├─ extensions\index.ts   ← 面板本体（/plugin-manager，v1.1.0）+ 启动时触发自动重跑
├─ descriptions.json     ← 插件中文简介（你的数据，升级不会覆盖）
├─ localize\             ← 可选组件 pi-zh-localize（见其 README）
├─ install.ps1           ← Windows 部署脚本（-WithLocalize / -Force / -WhatIf）
├─ CHANGELOG.md
└─ LICENSE
```

运行时产物（不进仓库）：`localize\backup\`（英文原文备份）、`localize\last-report.json`（体检报告）、
`localize\auto-apply.json` + `auto-apply.log`（自动重跑的开关与日志）。

## 八、环境变量

| 变量 | 作用 | 默认 |
|---|---|---|
| `PI_LOCALIZE_DIR` | 汉化组件所在目录（面板据此显示「汉化」行） | 面板自身同级 `localize\` → 上一级 `localize\` → `<pi 根>\localize\` |
| `PI_PLUGIN_NM_DIR` | 插件包根目录（相对 roots 的解析基准） | `<agent>\npm\node_modules` |
| `PI_PKG_DIR` | 直接指定 `@earendil-works/pi-coding-agent` 包目录 | 自动探测 |
| `PI_ZH_AUTOCOMPLETE_DIR` | `zh-autocomplete` 扩展目录 | `<agent>\extensions\zh-autocomplete` |
| `PI_PLUGIN_MANAGER_DIR` | 面板扩展目录（自动化脚本用） | `<agent>\extensions\plugin-manager` |
| `PI_CODING_AGENT_DIR` | pi 官方变量，上面几个默认值都由它推算 | pi 自己决定 |

面板找不到汉化组件时**只是不显示那一行**，插件开关照常工作。

## 九、自检

```bash
node localize/plugin/verify-all.mjs
```

七项检查：本体词典未匹配为 0、被改过的插件文件语法、两个本地扩展可转译、JSON 合法、
`descriptions.json` 覆盖率、补全映射单测、版本号一致性（面板 `VERSION` ↔ `package.json`）。
不装汉化组件时，前两项会失败 —— 那属于正常，面板本身不受影响。
## 十、License

MIT © 2026 AirFlavoredGum
