#!/usr/bin/env node
/**
 * 生成 zh-plugins.json（插件斜杠命令 / 提示词模板的界面文案汉化词典）
 *
 * 做法：anchor 不手抄，而是从包内源文件里精确抽取 `description: "…"` 原文，
 * 这样只要原文没变就一定能匹配；原文变了 patch.mjs --check 会报“未匹配”。
 *
 *   node plugin/build-dict.mjs            # 生成/更新 zh-plugins.json
 *   node plugin/build-dict.mjs --list     # 只列出抽取到的原文，不写文件
 */
import fs from 'node:fs';
import path from 'node:path';
import { NPM_DIR, toPosix } from './paths.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

// roots 写相对路径（相对 <agent>/npm/node_modules），换机器也能用；
// 要指到别处就设环境变量 PI_PLUGIN_NM_DIR，或把某个值写成绝对路径。
const ROOTS = {
  subagents: 'pi-subagents',
  'goal-x': 'pi-goal-x',
  'web-access': 'pi-web-access',
  plannotator: '@plannotator/pi-extension',
  'permission-system': '@gotgenes/pi-permission-system',
  'pi-lens': 'pi-lens',
  'mem0': '@amaster.ai/pi-memory-mem0',
  'pi-simplify': 'pi-simplify',
  'rpiv-todo': '@juicesharp/rpiv-todo',
};
const rootPath = (alias) => toPosix(path.isAbsolute(ROOTS[alias]) ? ROOTS[alias] : path.join(NPM_DIR, ROOTS[alias]));

// ---------- 翻译表 ----------
// { root, file, cmd } → 斜杠命令（只改 description，命令名/参数保持英文）
// { root, md }        → 提示词模板 frontmatter 的 description
const TABLE = [
  // ===== pi-subagents：斜杠命令 =====
  { root: 'subagents', file: 'src/slash/slash-commands.js', cmd: 'subagents',
    zh: '管理子代理：查看元数据，并调整模型、思考等级或提示词' },
  { root: 'subagents', file: 'src/slash/slash-commands.js', cmd: 'run',
    zh: '用 workflowScript 运行单个子代理：/run agent[output=file] [task] [--bg] [--fork]' },
  { root: 'subagents', file: 'src/slash/slash-commands.js', cmd: 'subagent-cost',
    zh: '显示本会话中主会话与子代理的用量成本' },
  { root: 'subagents', file: 'src/slash/slash-commands.js', cmd: 'subagents-doctor',
    zh: '显示子代理诊断信息' },
  { root: 'subagents', file: 'src/slash/slash-commands.js', cmd: 'subagents-inspect-rpc',
    zh: '宿主集成桥：用一个关联的 widget 载荷应答异步子任务检查请求（不消耗模型回合）' },
  { root: 'subagents', file: 'src/slash/slash-commands.js', cmd: 'subagents-guide',
    zh: '显示内置的子代理指南主题' },
  { root: 'subagents', file: 'src/slash/slash-commands.js', cmd: 'subagents-refine',
    zh: '为单个子代理生成项目本地、有边界的细化覆盖层' },
  { root: 'subagents', file: 'src/slash/slash-commands.js', cmd: 'subagents-fleet',
    zh: '打开实时子代理集群查看器' },
  { root: 'subagents', file: 'src/slash/slash-commands.js', cmd: 'subagents-detach',
    zh: '把当前前台运行的单子代理任务转为后台，但不终止它' },
  { root: 'subagents', file: 'src/slash/slash-commands.js', cmd: 'subagents-stop',
    zh: '停止本会话中的异步子代理运行；加 <run-id> <child-id> 可只停止其中一个子任务' },
  { root: 'subagents', file: 'src/slash/slash-commands.js', cmd: 'subagents-steer',
    zh: '向运行中的异步子代理发送引导消息；用 --child <child-id> 可只作用于某个子任务' },
  { root: 'subagents', file: 'src/slash/slash-commands.js', cmd: 'subagents-models',
    zh: '显示已发现子代理的模型映射' },
  { root: 'subagents', file: 'src/slash/slash-commands.js', cmd: 'subagents-profiles',
    zh: '列出已保存的子代理配置档案' },
  { root: 'subagents', file: 'src/slash/slash-commands.js', cmd: 'subagents-load-profile',
    zh: '把某个子代理配置档案载入 ~/.pi/agent/settings.json' },
  { root: 'subagents', file: 'src/slash/slash-commands.js', cmd: 'subagents-refresh-provider-models',
    zh: '刷新指定 provider 的模型目录缓存' },
  { root: 'subagents', file: 'src/slash/slash-commands.js', cmd: 'subagents-generate-profiles',
    zh: '生成 <provider>.quota 与 <provider>.quality 两套子代理配置档案' },
  { root: 'subagents', file: 'src/slash/slash-commands.js', cmd: 'subagents-check-profile',
    zh: '检查已保存的配置档案是否仍指向可用模型' },
  { root: 'subagents', file: 'src/slash/prompt-workflows.js', cmd: 'prompt-workflow',
    zh: '用原生 pi-subagents 运行提示词模板：/prompt-workflow <name> [args]' },
  { root: 'subagents', file: 'src/extension/herdr-pi-bridge.js', cmd: 'pi-subagents-bridge',
    zh: '内部：pane 原生请求分发' },
  { root: 'subagents', file: 'src/watchdog/register-main.js', cmd: 'subagents-watchdog',
    zh: '查看或切换默认关闭的子代理看门狗' },

  // ===== pi-subagents：提示词模板（/council、/parallel-review 等）=====
  { root: 'subagents', md: 'prompts/council.md',
    zh: '运行一个有边界的、由主管主持的顾问团，并输出决策备忘' },
  { root: 'subagents', md: 'prompts/gather-context-and-clarify.md',
    zh: '先用子代理收集上下文，再提出澄清问题' },
  { root: 'subagents', md: 'prompts/parallel-cleanup.md', zh: '并行清理评审' },
  { root: 'subagents', md: 'prompts/parallel-research.md', zh: '并行子代理调研' },
  { root: 'subagents', md: 'prompts/parallel-review.md', zh: '并行子代理评审' },
  { root: 'subagents', md: 'prompts/review-loop.md', zh: '评审/修复循环，直到干净' },

  // ===== pi-goal-x =====
  { root: 'goal-x', file: 'extensions/goal-commands.ts', cmd: 'goal',
    zh: '起草普通 goal：先澄清需求，再规划任务并确认。' },
  { root: 'goal-x', file: 'extensions/goal-commands.ts', cmd: 'sisyphus',
    zh: '起草 Sisyphus goal：先澄清需求，再规划任务并确认。' },
  { root: 'goal-x', file: 'extensions/goal-commands.ts', cmd: 'goal-cancel',
    zh: '取消进行中的引导式起草，不创建也不修改 goal。' },
  { root: 'goal-x', file: 'extensions/goal-commands.ts', cmd: 'goal-direct',
    zh: '跳过起草，立即创建并启动普通 goal。' },
  { root: 'goal-x', file: 'extensions/goal-commands.ts', cmd: 'sisyphus-direct',
    zh: '跳过起草，立即创建并启动 Sisyphus goal。' },
  { root: 'goal-x', file: 'extensions/goal-commands.ts', cmd: 'goal-list',
    zh: '列出所有未完成的 goal 以及当前焦点。' },
  { root: 'goal-x', file: 'extensions/goal-commands.ts', cmd: 'goal-status',
    zh: '显示统一的 goal 仪表盘（只读）。附加 "verbose" 看完整细节，附加 "health" 做存储/运行时检查。' },
  { root: 'goal-x', file: 'extensions/goal-commands.ts', cmd: 'goal-refresh',
    zh: '从磁盘重新读取 goal 存储缓存（池、账本、设置）并报告变化。可感知对 .pi 文件的外部修改 —— 无需文件监视器。' },
  { root: 'goal-x', file: 'extensions/goal-commands.ts', cmd: 'goal-recovery',
    zh: '只读的存储/恢复报告（损坏的 goal 文件、损坏的账本行、过期锁、孤立快照数据）。附加 "repair" 可在确认后清除过期锁并刷新池快照（会先备份）。' },
  { root: 'goal-x', file: 'extensions/goal-commands.ts', cmd: 'goal-focus',
    zh: '选择本会话聚焦哪个未完成的 goal。' },
  { root: 'goal-x', file: 'extensions/goal-commands.ts', cmd: 'goal-unfocus',
    zh: '取消聚焦当前 goal（仅本会话；goal 仍保持打开）。' },
  { root: 'goal-x', file: 'extensions/goal-commands.ts', cmd: 'goal-settings',
    zh: '打开 pi-goal 设置（审计用 provider/模型/思考等级）。' },
  { root: 'goal-x', file: 'extensions/goal-commands.ts', cmd: 'goal-tweak',
    zh: '与用户一起细化当前 goal 的目标。' },
  { root: 'goal-x', file: 'extensions/goal-commands.ts', cmd: 'goal-clear',
    zh: '确认后归档当前 goal（由用户主动放弃）。' },
  { root: 'goal-x', file: 'extensions/goal-commands.ts', cmd: 'goal-pause',
    zh: '暂停正在运行的 goal。运行中按 Esc 也会暂停。' },
  { root: 'goal-x', file: 'extensions/goal-commands.ts', cmd: 'goal-resume',
    zh: '立即继续，并重置已配置的自主运行额度。' },

  // ===== pi-web-access =====
  { root: 'web-access', file: 'dist/index.js', cmd: 'websearch', zh: '打开联网搜索管理器' },
  { root: 'web-access', file: 'dist/index.js', cmd: 'curator', zh: '切换或配置搜索管理器工作流' },
  { root: 'web-access', file: 'dist/index.js', cmd: 'google-account', zh: '显示 Gemini Web 当前使用的 Google 账号' },
  { root: 'web-access', file: 'dist/index.js', cmd: 'search', zh: '浏览已保存的联网搜索结果' },

  // ===== @plannotator/pi-extension =====
  { root: 'plannotator', file: 'index.ts', cmd: 'plannotator-plan-mode', zh: '切换 plannotator 规划模式' },
  { root: 'plannotator', file: 'index.ts', cmd: 'plannotator-review',
    zh: '对当前改动或 PR URL 打开交互式代码评审；用 --git 或 --gitbutler 指定 provider，用 --base <ref> / --diff-type <type> 固定本次会话打开的 diff' },
  { root: 'plannotator', file: 'index.ts', cmd: 'plannotator-annotate', zh: '在标注界面中打开 markdown 文件或文件夹' },
  { root: 'plannotator', file: 'index.ts', cmd: 'plannotator-last', zh: '标注最后一条助手消息' },

  // ===== @gotgenes/pi-permission-system（当前被 settings 过滤禁用，先翻好备用）=====
  { root: 'permission-system', file: 'src/config/config-modal.ts', cmd: 'permission-system',
    zh: '配置 pi-permission-system 的日志与 yolo 模式行为' },

  // ===== pi-lens =====
  { root: 'pi-lens', file: 'dist/index.js', cmd: 'lens-toggle',
    zh: '切换本会话的 pi-lens 开关。用法：/lens-toggle' },
  { root: 'pi-lens', file: 'dist/index.js', cmd: 'lens-context-toggle',
    zh: '切换本会话的自动上下文注入（工具/LSP/读取守卫/格式化保持启用）。用法：/lens-context-toggle' },
  { root: 'pi-lens', file: 'dist/index.js', cmd: 'lens-widget-toggle',
    zh: '显示或隐藏编辑器下方的 pi-lens 诊断小组件。用法：/lens-widget-toggle' },
  { root: 'pi-lens', file: 'dist/index.js', cmd: 'lens-tdi',
    zh: '显示技术债指数（TDI）与项目健康度趋势。用法：/lens-tdi' },
  { root: 'pi-lens', file: 'dist/index.js', cmd: 'lens-map',
    zh: '把审查图谱渲染成自包含的交互式 HTML 项目地图（可平移/缩放/悬停/点击）并写入磁盘。用法：/lens-map' },
  { root: 'pi-lens', file: 'dist/index.js', cmd: 'lens-health',
    zh: '显示 pi-lens 运行时健康状况：流水线崩溃、慢速 runner、最近一次分发的延迟。用法：/lens-health' },
  { root: 'pi-lens', file: 'dist/index.js', cmd: 'lens-perf',
    zh: '按 p50/p99 列出当前进程会话与整机日志窗口中最慢的延迟阶段。用法：/lens-perf' },
  { root: 'pi-lens', file: 'dist/index.js', cmd: 'lens-tools',
    zh: '显示 pi-lens 工具安装状态：全局安装、自动安装，还是 npx 回退。用法：/lens-tools' },
  { root: 'pi-lens', file: 'dist/index.js', cmd: 'lens-allow-edit',
    zh: '允许对某个文件在未先读取的情况下执行一次编辑。用法：/lens-allow-edit <path>' },

  // ===== @amaster.ai/pi-memory-mem0 =====
  { root: 'mem0', file: 'dist/index.js', cmd: 'mem0',
    zh: 'Mem0 记忆命令。子命令：status、search <query>、profile、add <text>、dedup [--apply]、delete <id>。' },

  // ===== pi-simplify / @juicesharp/rpiv-todo（命令名是变量，用 expr 匹配）=====
  { root: 'pi-simplify', file: 'dist/index.js', expr: 'COMMAND_NAME',
    zh: '审查近期改动的代码，给出可读性、一致性与可维护性方面的改进建议' },
  { root: 'rpiv-todo', file: 'todo.ts', expr: 'COMMAND_NAME',
    zh: '列出当前分支上的所有 todo，按状态分组' },
];

// ---------- 抽取 ----------
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** 从 startIdx 之后的第一个引号（" ' `）开始读一个完整字符串字面量（处理转义 / 不允许跨行）
 *  返回 { open, close, quote, literal, body }；literal 含两侧引号 */
function readStringLiteral(text, startIdx) {
  const open = text.slice(startIdx).search(/["'`]/);
  if (open === -1) return null;
  const at = startIdx + open;
  const quote = text[at];
  let i = at + 1;
  while (i < text.length) {
    if (text[i] === '\\') { i += 2; continue; }
    if (text[i] === quote) return { open: at, close: i, quote, literal: text.slice(at, i + 1), body: text.slice(at + 1, i) };
    if (text[i] === '\n') return null;
    i++;
  }
  return null;
}

const entries = [];
const problems = [];
// 默认从 backup/plugins/<安全化文件名> 读「英文原版」抽锤点——否则重跑生成器时会抽到已汉化的中文；
// 加了 --live 则直接用当前文件内容。
const USE_LIVE = process.argv.includes('--live');
const BACKUP = path.join(HERE, '..', 'backup', 'plugins');

for (const item of TABLE) {
  const rootDir = rootPath(item.root);
  if (!rootDir) { problems.push(`未知 root 别名: ${item.root}`); continue; }
  const rel = item.file ?? item.md;
  const full = path.join(rootDir, rel);
  const fileKey = `${item.root}:${rel}`;
  const backupFile = path.join(BACKUP, fileKey.replace(/[^A-Za-z0-9._-]+/g, '__'));
  const source = !USE_LIVE && fs.existsSync(backupFile) ? backupFile : full;
  let text;
  try { text = fs.readFileSync(source, 'utf8'); }
  catch { problems.push(`读不到文件: ${source}`); continue; }

  if (item.md) {
    const m = text.match(/^description:[ \t]*(.*)$/m);
    if (!m) { problems.push(`${fileKey}: 找不到 frontmatter description`); continue; }
    const zh = `description: ${item.zh}`;
    entries.push({ file: fileKey, anchor: m[0], zh, note: `提示词模板 ${path.basename(rel, '.md')}` });
    continue;
  }

  let regIdx = -1;
  if (item.cmd) {
    regIdx = Math.max(text.indexOf(`registerCommand("${item.cmd}"`), text.indexOf(`registerCommand('${item.cmd}'`));
  } else if (item.expr) {
    // 命令名是常量/变量（例如 registerCommand(COMMAND_NAME, {…})）
    regIdx = text.indexOf(`registerCommand(${item.expr}`);
  }
  const label = item.cmd ?? item.expr;
  if (regIdx === -1) { problems.push(`${fileKey}: 找不到 registerCommand(${label})`); continue; }
  const dIdx = text.indexOf('description:', regIdx);
  if (dIdx === -1 || dIdx - regIdx > 1500) { problems.push(`${fileKey}: ${label} 附近没有 description`); continue; }
  const lit = readStringLiteral(text, dIdx);
  if (!lit) { problems.push(`${fileKey}: ${item.cmd} 的 description 无法解析（可能是模板字符串）`); continue; }
  // 情形 A：同一行的 `description: "…"` → 锤点含键名，语义最清晰
  // 情形 B：字符串另起一行 → 只能改字面量本身，需要 allowAnyKey
  const sameLine = /^description:[ \t]*$/.test(text.slice(dIdx, lit.open));
  const anchor = sameLine ? text.slice(dIdx, lit.close + 1) : lit.literal;
  const body = item.zh.replace(/\\/g, '\\\\').replace(new RegExp('\\' + lit.quote, 'g'), '\\' + lit.quote);
  const entry = {
    file: fileKey,
    anchor,
    zh: sameLine ? `description: ${lit.quote}${body}${lit.quote}` : `${lit.quote}${body}${lit.quote}`,
    note: `/${label}${sameLine ? '' : '（跨行 description）'}`,
  };
  if (!sameLine) entry.allowAnyKey = true;
  entries.push(entry);
}

if (process.argv.includes('--list')) {
  for (const e of entries) console.log(`${e.file}\n  EN: ${e.anchor}\n  ZH: ${e.zh}\n`);
} else {
  const out = {
    version: 'plugins-1',
    backupTag: 'plugins',
    note: '插件/扩展的界面文案汉化词典（斜杠命令补全说明、提示词模板说明）；用法同 zh-dict.json。roots 里写相对路径时，相对于 <agent>/npm/node_modules 解析；用环境变量 PI_PLUGIN_NM_DIR 可换成别的目录（也可以直接写绝对路径）。',
    roots: ROOTS,
    denyTexts: [],
    entries,
  };
  const target = path.join(HERE, '..', 'zh-plugins.json');
  fs.writeFileSync(target, JSON.stringify(out, null, 1), 'utf8');
  console.log(`写入 ${target}`);
}

console.log(`词条: ${entries.length}    问题: ${problems.length}`);
for (const p of problems) console.log('  ! ' + p);
