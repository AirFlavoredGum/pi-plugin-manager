# pi-zh-localize v1.0.0 — pi 界面汉化工具包

把 pi 的**界面文案**汉化，同时**不动**模型名、提供商名、命令名、设置键名。

- 这是 [pi-plugin-manager](https://github.com/AirFlavoredGum/pi-plugin-manager) 的**可选组件**：不装它也能只用 `/plugin-manager` 面板
- 目录：本仓库的 `localize\`（安装后默认在 `<pi 根>\localize\`，可用环境变量 `PI_LOCALIZE_DIR` 覆盖）
- 目标：`@earendil-works/pi-coding-agent` 包，**自动定位**（`--pkg <目录>` 或 `PI_PKG_DIR` 可指定）
- 版本：`node patch.mjs --version`。当前词典 196 条，对 pi 0.87.0 校验 **未匹配 0**
- 原理：pi 官方**没有**多语言/i18n 支持，界面文案硬编码在打包后的 `dist/bundle/chunks/*.js` 里。
  本工具用「词典 + 精确锚点替换」的方式改这些文案，并做了防误伤校验。

---

## 一、怎么用

| 操作 | 命令 | 双击 |
|---|---|---|
| 汉化（自动备份英文原文） | `node patch.mjs --apply --verify` | `汉化.cmd` |
| 只看匹配情况，不改文件 | `node patch.mjs --check` | — |
| 还原英文原版 | `node patch.mjs --revert` | `还原.cmd` |
| 看工具版本号 | `node patch.mjs --version` | — |

> 换机器 / 换安装位置：工具会自己找 pi（`PI_PKG_DIR` → 由 `PI_CODING_AGENT_DIR` 推算 → `PATH` 上的 `pi` →
> 本机默认路径），也可以显式 `--pkg D:\path\to\node_modules\@earendil-works\pi-coding-agent`。
> 插件词典的 `roots` 写的是相对路径，相对于 `<agent>\npm\node_modules`（环境变量 `PI_PLUGIN_NM_DIR` 可覆盖）。

> **pi 升级/重装后 `dist` 会被覆盖，汉化会丢失**，重新跑一次 `--apply` 即可。
> `--check` 会告诉你哪些词条因为版本变化而失效（见 `last-report.json`）。

---

## 二、汉化了什么（196 条）

| 区域 | 说明 |
|---|---|
| `/settings` 设置面板 | 36 个设置项的**标题 + 说明文字**全中文（静默启动、缓存预热、HTTP 空闲超时、TUI 模式…） |
| `/settings` 子菜单 | 单模型思考等级、暂无可用模型、清除覆盖、自动 |
| `/thinking` | 思考等级说明：不进行推理 / 极简推理（约 1k tokens）… 最大推理 |
| `/hotkeys` | 83 条快捷键说明：光标上移、切换模型、会话树过滤… |
| 模型选择 / 调试 | 选择模型、正在加载模型、正在下载模型、当前模型不支持思考、思考等级：xxx、只有一个可用模型、作用域内只有一个模型 |
| 认证与报错 | 暂无可用模型、未找到 API 密钥、用 /login 登录提供商、输入以搜索… |
| 认证表单 | Bearer 令牌、AWS 配置档案、Google Cloud API 密钥、应用默认凭证… |
| 斜杠命令 | 24 个命令的说明文字（`settings`/`model`/`compact`/`login`…），**命令名本身保持英文** |
| 其它 | 是 / 否 / 信任 / 信任（仅本次会话）/ 不信任 / 深色 / 浅色 / 无匹配结果 / （空目录） |

### 故意**不**翻译的东西（改了就会“原意改变”）

- 模型 ID 与显示名：`deepseek-v4-pro`、`DeepSeek V4 Pro`、`GPT-5.6 Sol`、`Kimi K2.6`…
- 提供商名：`DeepSeek`、`Z.AI`、`OpenRouter`、`Cloudflare API key`…
- 命令名、工具名：`/settings`、`/model`、`read`、`bash`、`edit`
- 设置**键名**与取值：`quietStartup`、`theme`、`tuiMode`、`fullscreen`、`off/minimal/low/…`（`minimal:"…"` 只改冒号后的说明文字）
- `id:` / `value:` / `name:` 里的标识符、环境变量名、模型目录 `models-store.json` 内容
- **工具参数说明**（`read`/`bash` 等工具的 schema description）——这些是发给模型的，翻译会改变模型行为

> 词典里的 `denyTexts` 就是上面这类的保护名单；命中名单的词条会被直接拒绝执行。

---

## 三、五道安全闸门

1. **键名白名单**：锚点必须以 `label:` / `title:` / `description:` / `message:` / `text:` / `placeholder:` / `hint:` / `currentValue:` 开头，其余形式（裸字符串等）必须显式写 `allowAnyKey: true`。
2. **模型名保护**：文本以 `gpt|claude|deepseek|glm|kimi|grok|llama|mistral|…` 开头时**拒绝翻译**。
3. **denyTexts 名单**：工具名、工具参数说明等硬保护。
4. **命中计数 `expect`**：实际命中次数 ≠ 期望次数就**跳过不改**（版本变化时不会误伤别处）。
5. **永不触碰** `id:` / `value:` 里的标识符、命令名、设置键名。

另外 `--apply --verify` 会在改完后立刻执行 `pi --version`，加载整个 bundle 来验证没改坏；失败就提示你 `--revert`。

---

## 四、目录结构

```
localize\
├─ package.json         ← 组件自己的名字与版本号（pi-zh-localize）
├─ zh-dict.json         ← pi 本体词典（要加词条只改这个文件）
├─ patch.mjs            ← 主程序（支持 --version / --pkg / --dict / 多根目录，pi 与插件通用）
├─ 汉化.cmd / 还原.cmd   ← 双击即用（pi 本体）
├─ zh-plugins.json      ← 插件词典（命令/提示模板说明；由 plugin/build-dict.mjs 生成）
├─ 汉化插件.cmd / 还原插件.cmd ← 双击即用（插件）
├─ plugin/              ← 插件汉化用的小工具（含 paths.mjs 统一路径解析，见第九节）
├─ zh-autocomplete/     ← 「只改补全显示」的小扩展源文件（装到 <agent>\extensions\zh-autocomplete\）
├─ extract.mjs          ← 从打包产物里提取“可能是界面文案”的字符串（找新词条用）
├─ extract-settings.mjs ← 专门提取 /settings 面板条目
├─ extract-keys.mjs     ← 专门提取 /hotkeys 快捷键说明
├─ ctx.mjs              ← 看某个关键词在打包产物里的上下文（判断该不该翻）
├─ backup/<pi 版本>/    ← pi 本体的英文原版备份（manifest 带 sha256）
├─ backup/plugins/      ← 插件文件的英文原版备份（生成词典时也从这里抽原文）
└─ last-report.json     ← 上次运行报告（未匹配/跳过/错误）
```

> `backup/` 与 `last-report.json` 是**这台机器**的产物，不会进仓库；只有 `--apply` 才会写备份
> （`--check` 只体检，不再污染备份）。

---

## 五、怎么自己加词条

1. 找原文：
   ```bash
   node ctx.mjs "Some English label" 200 400 3
   ```
   或看看候选清单：
   ```bash
   node extract.mjs            # 生成 extracted.json
   node extract-settings.mjs   # 设置面板
   node extract-keys.mjs       # 快捷键
   ```
2. 在 `zh-dict.json` 的 `entries` 里加一条，**anchor 必须与源码一字不差**（含键名和引号）：
   ```json
   { "anchor": "label:\"Some English label\",description:\"Its description\"",
     "zh":     "label:\"某个中文标题\",description:\"对应的中文说明\"" }
   ```
   同一文案出现多次就写 `"expect": 2`。
3. 先 `node patch.mjs --check` 确认全部命中（未匹配=0），再 `node patch.mjs --apply --verify`。

写模板字符串（反引号）里的文案时，anchor 也可以包含 `${...}`，例如：

```json
{ "anchor": "`Thinking level: ${newLevel}`", "zh": "`思考等级：${newLevel}`", "allowAnyKey": true }
```

---

## 六、还没汉化的地方（可继续扩展）

- **`pi --help` / `pi auth --help` 等命令行帮助**：全是英文长文本，量很大，可逐条加入词典。
- 会话记录渲染、`/tree`、`/session` 面板的部分提示。
- 各家 provider 的报错原文（来自 pi-ai 包，属其它 chunk；给词条加 `"file": "xxx.js"` 即可跨文件替换）。
- 系统提示词（发给模型的部分）——**不建议**翻译：会改变模型行为，且模型本来就能听懂中文。

---

## 七、让 pi **回答**也用中文（和界面汉化无关，可单独用）

界面文案之外，模型回复的语言由上下文文件决定。在全局上下文文件里加一句即可（对模型没有任何副作用）：

文件：`D:\pi-agent\agent\AGENTS.md`（即 `PI_CODING_AGENT_DIR` 下的 `AGENTS.md`）

```markdown
# 语言偏好
- 所有回复、解释、总结一律使用简体中文。
- 代码、命令、路径、标识符、报错原文保持原样，不要翻译。
- 报错信息可以原文引用，但解释用中文。
```

不需要了就把这个文件删掉即可。

---

## 八、风险提示

- 这是**修改第三方安装包内文件**的做法，属于非官方支持；本工具只改字符串常量，不改逻辑，且已验证 `pi --version` / `pi --help` 可正常加载。
- pi 升级后必须重跑 `--apply`；如果新版改了文案，`--check` 会列出失效词条，需要更新词典。
- 想彻底恢复：`node patch.mjs --revert`，或用 `backup/<版本>/` 里的原文件覆盖。
- 极少数情况下 `/settings`、`/model` 面板里的某个选项如果异常，先 `--revert` 确认是不是补丁引起，再把对应词条从词典删掉即可。

---

## 九、插件（下载的扩展）的界面汉化

一共三处，做法不同：

| 位置 | 内容 | 做法 | 会发给模型吗 |
|---|---|---|---|
| `/plugin-manager` 面板 | 插件名后的小括号简介 | `<agent>\extensions\plugin-manager\descriptions.json` | 不会 |
| 斜杠命令补全 | `/subagents`、`/lens-tdi`… 的说明 | `zh-plugins.json` 词典（直接改插件源码里的 `description`） | 不会（命令说明只用于界面） |
| 斜杠命令补全 | `/skill:xxx` 的说明 | `zh-autocomplete` 扩展做的**显示层**映射 | 不会（SKILL.md 原文不动） |

> 技能为什么不改 `SKILL.md`：它的 `description` 会进系统提示词（发给模型），改它会改变模型输入。
> 所以技能说明用一个「只包一层补全显示」的小扩展来翻译，模型看到的仍是英文原文。

### 当前覆盖情况

- **10 个已装插件**全部有中文简介
- **63 条**命令 / 提示词模板说明，分布在 **18 个文件**里
  （pi-subagents 26（20 命令 + 6 提示词）· pi-goal-x 16 · pi-lens 9 · plannotator 4 · pi-web-access 4 · mem0 1 · pi-simplify 1 · rpiv-todo 1 · permission-system 1）
- **7 个技能说明**走显示层映射（pi-lens 4 · pi-subagents 2 · plannotator 1）

### 日常命令

```bash
node plugin/build-dict.mjs                 # 从插件源码重新生成 zh-plugins.json
node patch.mjs --dict zh-plugins.json --check     # 只看匹配情况
node patch.mjs --dict zh-plugins.json --apply     # 应用（先自动备份英文原文）
node patch.mjs --dict zh-plugins.json --revert     # 还原
node plugin/build-autocomplete-dict.mjs    # 重新生成补全映射词典
node plugin/verify-all.mjs                 # 一键全量验证（推荐最后跑）
```

或者直接双击 `汉化插件.cmd`（一键六步）/ `还原插件.cmd`。

### 装了新插件之后怎么办

1. 打开 `/plugin-manager`，看新插件的小括号简介是不是英文 → 是就加一条到 `descriptions.json`
   （键必须与 `settings.json` 里 packages 的写法一字不差）。
2. 若它注册了斜杠命令：把命令加进 `plugin/build-dict.mjs` 的 `ROOTS` + `TABLE`，再跑 `汉化插件.cmd`。
3. 若它带技能：把技能 description 的中文加进 `plugin/build-autocomplete-dict.mjs` 的 `SKILL_ZH`
   （脚本运行时会列出「还没有中文映射的技能」）。
4. 最后 `node plugin/verify-all.mjs` 确认全部健康。

### 相关文件

| 文件 | 作用 |
|---|---|
| `zh-plugins.json` | 插件词典（生成物，别手改；改 `plugin/build-dict.mjs` 的 TABLE） |
| `plugin/paths.mjs` | 统一解析 agent / npm / pi 包 / 扩展目录（环境变量可覆盖），脚本不再写死盘符 |
| `plugin/build-dict.mjs` | 从插件源码**精确抽取**英文原文当锚点，再配中文 |
| `plugin/verify-syntax.mjs` | 用 pi 自带 esbuild 转译 + `node --check` 验证改过的插件文件还能解析 |
| `plugin/build-autocomplete-dict.mjs` | 生成 `<agent>\extensions\zh-autocomplete\dict.json` |
| `plugin/test-autocomplete.mjs` | 离线单测补全映射逻辑（不启动 pi、不联网） |
| `plugin/verify-all.mjs` | 七项全量检查 |
| `zh-autocomplete/` | 只改补全显示的本地扩展源文件（词典缺失/损坏时自动不干预） |

### 注意

- 插件更新（`pi update --extensions`）会覆盖插件文件 → 重跑 `汉化插件.cmd` 即可；
  `--check` 会报告哪些词条因版本变化而失配（不会误伤）。
- `plugin/build-dict.mjs` 默认从 `backup/plugins/` 里抽**英文原文**（否则重跑会抽到已汉化的中文）；
  插件升级后想按新版本重新生成，加 `--live`。
- `/plugin-manager` 面板里的「汉化」开关会自动同时管**主词典**和 `zh-plugins.json`。
