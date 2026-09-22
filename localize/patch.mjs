#!/usr/bin/env node
/**
 * pi 界面汉化补丁（词典驱动、可回滚、可重跑）—— pi-zh-localize v1.0.0
 *
 *   node patch.mjs --check           只检查词典与当前安装版本的匹配情况，不改文件（默认动作）
 *   node patch.mjs --apply           应用汉化（首次会自动备份英文原文）
 *   node patch.mjs --apply --verify  应用后跑一次 `pi --version` 验证没改坏
 *   node patch.mjs --revert          还原英文原版
 *   node patch.mjs --version         只看工具版本号（-V 同义）
 *
 * 定位 pi：--pkg <dir> > 环境变量 PI_PKG_DIR > 由 PI_CODING_AGENT_DIR 推算 > PATH 上的 pi > 本机默认。
 * 打包文件的哈希名会随 pi 升级变化：词典里的 mainFileProbe 会在 chunks 里自动找对主 chunk。
 *
 * 词条约定（zh-dict.json）:
 *   { "anchor": "<打包产物中一字不差的原文片段>", "zh": "<整段替换成什么>", "expect": 期望出现次数(默认1) }
 *   anchor 里要带上键名和引号，例如 label:"Quiet startup",description:"Disable verbose printing at startup"
 *
 * 安全机制:
 *  1) 白名单键名：anchor 必须以 label/title/description/message/text/placeholder/hint/currentValue 开头；
 *     其它形式（裸字符串、off:"…" 之类）必须显式写 allowAnyKey: true。
 *  2) 模型名保护：文本看起来像模型/品牌名（gpt/claude/deepseek/glm/kimi… ）时拒绝翻译。
 *  3) denyTexts 保护名单。
 *  4) expect 计数：实际命中次数与期望不符就跳过不改（升级后文案变化时不会误伤）。
 *  5) 绝不触碰 id:"…" / value:"…" / 模型 ID / provider ID / 命令名 / 设置键名。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FALLBACK_PKG = 'D:/pi-agent/current/node_modules/@earendil-works/pi-coding-agent';

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

const TOOL_VERSION = readJsonSafe(path.join(HERE, 'package.json'))?.version ?? '0.0.0';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

if (flag('--version') || flag('-V')) {
  console.log(`pi-zh-localize (patch.mjs) v${TOOL_VERSION}`);
  console.log(`dict: ${path.join(HERE, 'zh-dict.json')}`);
  process.exit(0);
}
if (flag('--help') || flag('-h')) {
  console.log(`pi 界面汉化补丁 v${TOOL_VERSION}\n\n用法:\n  node patch.mjs --check [--dict <文件>]\n  node patch.mjs --apply [--verify]\n  node patch.mjs --revert\n  node patch.mjs --version\n\n定位 pi:\n  --pkg <pi-coding-agent 包目录>  或环境变量 PI_PKG_DIR\n  （默认由 PI_CODING_AGENT_DIR 推算，再退回 PATH 上的 pi 与本机默认路径）`);
  process.exit(0);
}

/**
 * 自动定位 pi 安装目录（@earendil-works/pi-coding-agent 包根）。
 * 不写死盘符，换机器 / 换安装位置都能用；都没有就退回本机默认值，让后续报错更直观。
 */
function detectPkgDir() {
  const rel = ['node_modules', '@earendil-works', 'pi-coding-agent'];
  const candidates = [];
  if (process.env.PI_PKG_DIR) candidates.push(process.env.PI_PKG_DIR);
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  if (agentDir) {
    const piRoot = path.dirname(agentDir);
    candidates.push(path.join(piRoot, 'current', ...rel));
    candidates.push(path.join(piRoot, ...rel));
  }
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    candidates.push(path.join(dir, ...rel));
    candidates.push(path.join(path.dirname(dir), ...rel));
  }
  candidates.push(FALLBACK_PKG);
  for (const c of candidates) {
    try { if (c && fs.existsSync(path.join(c, 'package.json'))) return c; } catch { /* 下一个 */ }
  }
  return FALLBACK_PKG;
}

const action = flag('--revert') ? 'revert' : flag('--apply') ? 'apply' : 'check';
const pkgDir = (opt('--pkg') ?? detectPkgDir()).replace(/\\/g, '/');
const dictPath = opt('--dict', path.join(HERE, 'zh-dict.json'));
const commonDir = path.join(pkgDir, 'dist', 'bundle', 'chunks');
const quiet = flag('--quiet');
const verify = flag('--verify');
const log = (...a) => { if (!quiet) console.log(...a); };
const short = (s, n = 64) => (s.length > n ? s.slice(0, n) + '…' : s);

// ---------- 保护规则 ----------
const MODEL_LIKE = /^\s*(gpt|chatgpt|o[1-9](-|\b)|claude|opus|sonnet|haiku|fable|gemini|gemma|glm|kimi|moonshot|grok|xai|deepseek|qwen|tongyi|llama|mistral|mixtral|codestral|devstral|magistral|pixtral|voxtral|nova|command|cohere|phi|mimo|minimax|abab|ernie|doubao|seed|step|hunyuan|mercury|palmyra|solar|krea|recraft|riverflow|flux|sdxl|ideogram|mai-|lfm|kat-|saba|euryale|pickle|toast|arrow|fugu|pareto|dots|relace)/i;
const KEY_ALLOWLIST = /^(label|title|description|message|text|placeholder|hint|currentValue):/;
// 斜杠命令的自动补全条目：name:"cmd",description:"…"（只改 description，命令名保留）
const COMMAND_ANCHOR = /^name:"[^"\\]+",description:"/;
const KEYED = /^([A-Za-z_$][\w$]*):/;
const QUOTED = /^([A-Za-z_$][\w$]*):\s*(["'`])([\s\S]*)\2$/;

// ---------- 读词典 ----------
const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
const mainFile = dict.mainFile ?? 'chunk-CMRUVXTE.js';
// pi 升级后打包 chunk 的哈希名会变（mainFile 就失效了）：用 mainFileProbe 在 chunks 里重新找主 chunk
const mainFileProbe = dict.mainFileProbe ?? null;
// 多根目录支持：dict.roots = { 别名: 绝对目录或相对路径 }
// 词条的 file 写成 "别名:包内相对路径"（例如 "subagents:src/slash/slash-commands.js"）；
// 不写别名时仍按老规则在 pi 的 dist/bundle/chunks 下查找。
// roots 的值可以是绝对路径，也可以相对 rootsBase（默认 <agent>/npm/node_modules）。
const roots = dict.roots ?? {};
function defaultRootsBase() {
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? 'D:/pi-agent/agent';
  return path.join(agentDir, 'npm', 'node_modules');
}
const rootsBase = String(process.env.PI_PLUGIN_NM_DIR ?? dict.rootsBase ?? defaultRootsBase()).replace(/\\/g, '/');
const rootDir = (alias) => {
  const value = String(roots[alias]).replace(/\\/g, '/');
  return path.isAbsolute(value) ? value : path.join(rootsBase, value).replace(/\\/g, '/');
};
let resolvedMain = null;
/**
 * 找主 chunk。三重手段，从便宜到贵：
 *   1. mainFile 直接命中（没升级过）
 *   2. mainFileProbe 命中——探针必须是**永远不会被翻译**的标识符（如设置键名 quietStartup），
 *      千万别用界面文案做探针：汉化完之后那句英文就没了，会反过来失效
 *   3. 兑底：拿词典里的 anchor / zh 给每个 chunk 打分，取命中最多那个
 * 这样无论当前是英文原版还是已汉化，都能找对文件。
 */
function findMainChunk() {
  if (!fs.existsSync(commonDir)) return null;
  let best = null;
  let bestScore = 0;
  for (const f of fs.readdirSync(commonDir).filter((n) => n.endsWith('.js')).sort()) {
    const full = path.join(commonDir, f);
    let text;
    try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
    if (mainFileProbe && text.includes(mainFileProbe)) return full;
    let score = 0;
    for (const e of entries2) {
      if (text.includes(e.anchor) || text.includes(e.zh)) score++;
      if (score > 60) break;
    }
    if (score > bestScore) { bestScore = score; best = full; }
  }
  return bestScore > 0 ? best : null;
}
function mainTarget() {
  if (resolvedMain) return resolvedMain;
  const direct = path.join(commonDir, mainFile);
  if (fs.existsSync(direct)) { resolvedMain = direct; return direct; }
  resolvedMain = findMainChunk() ?? direct;
  return resolvedMain;
}
const resolveTarget = (file) => {
  const m = /^([A-Za-z0-9_.-]+):(.+)$/.exec(file);
  if (m && roots[m[1]]) return path.join(rootDir(m[1]), m[2]);
  return mainTarget();
};
const backupTag = dict.backupTag ?? null; // null → 用 pi 版本号当备份目录名
const denyTexts = new Set(dict.denyTexts ?? []);
const entries = (dict.entries ?? []).filter((e) => !e._section);

const entries2 = entries.map((e, i) => ({
  i,
  file: e.file ?? mainFile,
  anchor: e.anchor,
  zh: e.zh,
  expect: e.expect ?? e.count ?? 1,
  allowAnyKey: e.allowAnyKey === true,
  allowModelLike: e.allowModelLike === true,
  note: e.note,
}));

// ---------- 静态校验 ----------
const problems = [];
const seen = new Set();
for (const e of entries2) {
  const tag = `[词条 ${e.i}] ${short(e.anchor)}`;
  const q = e.anchor.match(QUOTED);
  const srcText = q ? q[3] : null;

  if (!e.allowAnyKey && !e.anchor.includes(':')) problems.push(`${tag} anchor 必须包含键名，例如 label:"…"`);
  const allowed = e.allowAnyKey || KEY_ALLOWLIST.test(e.anchor) || COMMAND_ANCHOR.test(e.anchor);
  if (!allowed) problems.push(`${tag} 键名不在白名单内；如确为纯显示文案请加 allowAnyKey: true`);
  if (!e.allowAnyKey && !KEYED.test(e.anchor)) problems.push(`${tag} anchor 需形如 key:"原文"`);
  if (!e.zh) problems.push(`${tag} 缺少 zh`);
  if (e.zh === e.anchor) problems.push(`${tag} zh 与 anchor 相同，没有意义`);
  if (!e.allowModelLike && srcText && MODEL_LIKE.test(srcText)) {
    problems.push(`${tag} 疑似模型/品牌名，已拒绝（确需翻译请加 allowModelLike: true）`);
  }
  if (srcText && denyTexts.has(srcText)) problems.push(`${tag} 命中 denyTexts 保护名单`);
  const key = e.file + '\u0000' + e.anchor;
  if (seen.has(key)) problems.push(`${tag} anchor 重复`);
  seen.add(key);
  if (e.anchor.length < 8) problems.push(`${tag} anchor 太短，容易误伤`);
}

// ---------- 备份/还原辅助 ----------
function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function version() { return JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version; }

const backupRoot = path.join(HERE, 'backup');
let backupDir = null;

function ensureBackup(file, originalText) {
  backupDir = backupDir ?? path.join(backupRoot, backupTag ?? version());
  fs.mkdirSync(backupDir, { recursive: true });
  const manifestPath = path.join(backupDir, 'manifest.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { version: version(), files: {} };
  const safeName = file.replace(/[^A-Za-z0-9._-]+/g, '__');
  if (!manifest.files[file]) {
    fs.writeFileSync(path.join(backupDir, safeName), originalText, 'utf8');
    manifest.files[file] = { file: safeName, sha256: sha(originalText), bytes: Buffer.byteLength(originalText) };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1), 'utf8');
    log(`  · 已备份英文原文 → backup/${backupTag ?? version()}/${safeName}`);
  }
}

function countOccurrences(hay, needle) {
  if (!needle) return 0;
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

// ---------- 主流程 ----------
const report = { action, dictVersion: dict.version, piVersion: null, applied: [], already: [], unmatched: [], skipped: [], errors: [], blocked: problems };
try { report.piVersion = version(); } catch { /* ignore */ }

const byFile = new Map();
for (const e of entries2) {
  if (!byFile.has(e.file)) byFile.set(e.file, []);
  byFile.get(e.file).push(e);
}

for (const [file, list] of byFile) {
  const full = resolveTarget(file);
  if (!fs.existsSync(full)) {
    for (const e of list) report.errors.push({ file, anchor: short(e.anchor), why: '目标文件不存在' });
    continue;
  }
  const original = fs.readFileSync(full, 'utf8');
  let text = original;

  for (const e of list) {
    const nSrc = countOccurrences(text, e.anchor);
    const nZh = countOccurrences(text, e.zh);

    if (action === 'revert') {
      if (nZh > 0) { text = text.split(e.zh).join(e.anchor); report.applied.push({ file, zh: short(e.zh) }); }
      else if (nSrc > 0) report.already.push({ file, anchor: short(e.anchor), note: '本来就是原文' });
      else report.unmatched.push({ file, anchor: short(e.anchor), why: '中英文都没找到' });
      continue;
    }

    if (nZh > 0 && nSrc === 0) { report.already.push({ file, anchor: short(e.anchor), note: '已汉化' }); continue; }
    if (nSrc === 0) { report.unmatched.push({ file, anchor: short(e.anchor), why: '原文未找到（版本可能变了）' }); continue; }
    if (nSrc !== e.expect) {
      report.skipped.push(`[词条 ${e.i}] 命中 ${nSrc} 次，期望 ${e.expect} 次 → 跳过不改: ${short(e.anchor)}`);
      continue;
    }
    text = text.split(e.anchor).join(e.zh);
    report.applied.push({ file, anchor: short(e.anchor), zh: e.zh });
  }

  if (text === original) continue;
  if (action === 'revert') {
    const keep = full + '.zh.bak';
    if (!fs.existsSync(keep)) fs.writeFileSync(keep, original, 'utf8');
    fs.writeFileSync(full, text, 'utf8');
    continue;
  }
  // 只有 --apply 才写「英文原文」备份：--check 只是体检，不该污染备份
  if (action === 'apply') {
    ensureBackup(file, original);
    fs.writeFileSync(full, text, 'utf8');
  }
}

// ---------- 输出 ----------
const total = entries2.length;
const verb = action === 'revert' ? '已还原' : action === 'apply' ? '已汉化' : '可汉化';
log(`\n===== pi 汉化补丁 · ${action} =====`);
log(`工具: v${TOOL_VERSION}    pi 版本: ${report.piVersion}    词典版本: ${dict.version}    词条数: ${total}`);
log(`  ${verb}: ${report.applied.length}`);
log(`  已是目标文案: ${report.already.length}`);
log(`  未匹配: ${report.unmatched.length}${report.unmatched.length ? '（升级 pi 后常见，见下）' : ''}`);
log(`  安全跳过: ${report.skipped.length}`);
if (problems.length) log(`  词典自身问题: ${problems.length}`);

if (problems.length) {
  log('\n--- 词典自身问题（这些词条未参与替换）---');
  for (const p of problems) log('  ! ' + p);
}
if (report.skipped.length) {
  log('\n--- 安全跳过（防误伤，请人工确认）---');
  for (const s of report.skipped) log('  ! ' + s);
}
if (report.unmatched.length) {
  log('\n--- 未匹配词条（原文已变化，需要更新词典）---');
  for (const u of report.unmatched.slice(0, 30)) log(`  ? [${u.file}] ${u.anchor}  (${u.why})`);
  if (report.unmatched.length > 30) log(`  … 其余 ${report.unmatched.length - 30} 条见 last-report.json`);
}
if (report.errors.length) {
  log('\n--- 错误 ---');
  for (const e of report.errors) log(`  x [${e.file}] ${e.anchor}: ${e.why}`);
}

// 告诉调用方（auto-apply.mjs / 面板）这次实际命中的是哪个打包文件：chunk 名带哈希，
// 记下来以后就能用一个 10ms 的 includes() 判断“汉化还在不在”
if (resolvedMain) report.resolved = { main: path.basename(resolvedMain), full: String(resolvedMain).replace(/\\/g, '/') };

fs.writeFileSync(path.join(HERE, 'last-report.json'), JSON.stringify(report, null, 1), 'utf8');
log(`\n报告已写入: last-report.json`);

if (verify && action !== 'revert') {
  log('\n--- 语法/启动验证: pi --version ---');
  try {
    const out = execFileSync(process.execPath, [path.join(pkgDir, 'dist', 'bundle', 'cli.js'), '--version'], { encoding: 'utf8', timeout: 180000 });
    log('  ok → ' + out.trim());
  } catch (err) {
    log('  失败 ← ' + (err.message || err));
    log('  请立刻执行: node patch.mjs --revert');
    process.exitCode = 1;
  }
}

// 还原 = 「我要英文」：顺手关掉「pi 更新后自动重跑汉化」，否则下次启动又会被自动打回来。
// auto-apply.mjs 自己的“自检失败自动还原”会带 --keep-intent，因为它希望保留开关等下次 pi 升级再试。
if (action === 'revert' && !flag('--keep-intent')) {
  const autoState = path.join(HERE, 'auto-apply.json');
  try {
    if (fs.existsSync(autoState)) {
      const st = JSON.parse(fs.readFileSync(autoState, 'utf8'));
      if (st.enabled) {
        st.enabled = false;
        st.lastAttempt = { at: new Date().toISOString(), result: 'disabled-by-revert', detail: 'patch.mjs --revert' };
        fs.writeFileSync(autoState, JSON.stringify(st, null, 2) + '\n', 'utf8');
        log('已同时关闭「pi 更新后自动重跑汉化」（auto-apply.json → enabled: false）');
      }
    }
  } catch {
    // 状态文件坏了不能影响还原本身
  }
}

if (action === 'apply') log('\n提示: pi 升级/重装后 dist 会被覆盖，重新运行  node patch.mjs --apply  即可再次汉化。');
