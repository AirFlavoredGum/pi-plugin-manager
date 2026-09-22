#!/usr/bin/env node
/**
 * 生成 / 更新扩展 zh-autocomplete 的词典：
 *   <agent>/extensions/zh-autocomplete/dict.json
 *
 * 路径用 plugin/paths.mjs 解析（环境变量 PI_ZH_AUTOCOMPLETE_DIR / PI_PLUGIN_NM_DIR 可覆盖）。
 *
 * 词典内容 = 插件斜杠命令/提示词模板的说明（来自 zh-plugins.json）
 *          + 各插件 SKILL.md 的 description（技能在补全里也是 /skill:xxx）
 *
 * 键统一做「空白折叠」归一化（多行 YAML 描述会被压成一行），与扩展里的 norm() 一致。
 *
 *   node plugin/build-autocomplete-dict.mjs
 *   node plugin/build-autocomplete-dict.mjs --check   只报告，不写文件
 */
import fs from 'node:fs';
import path from 'node:path';
import { NPM_DIR as NM, ZH_AUTOCOMPLETE_DIR } from './paths.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const OUT = path.join(ZH_AUTOCOMPLETE_DIR, 'dict.json');

const norm = (s) => s.replace(/\s+/g, ' ').trim();

// ---------- 技能说明的中文（键 = skill 名，即 SKILL.md frontmatter 的 name）----------
const SKILL_ZH = {
  'council-mode': '运行一个有边界的、由主管主持的顾问团。当用户要求 council mode、召集顾问、辩论某个决策、交叉质询建议，或运行 /council 时使用。',
  'pi-subagents': '面向操作者授权的委派场景的技术指南：有边界的交接、并行评审、脚本化工作流、异步执行、fork 上下文、隔离与协同执行。',
  plannotator: 'Plannotator CLI 使用参考：计划评审、代码评审、标注文件/URL/文件夹、运行本地应用、标注最后一条助手消息、浏览已归档的计划决策，以及导出或分享 Guided Review。',
  'pi-lens-ast-grep': '搜索或替换代码模式时使用 —— 用 ast-grep 而不是文本搜索，以获得语义准确性',
  'pi-lens-lsp-navigation': '用 IDE 能力导航代码，并对文件/文件夹/批量文件运行主动式 LSP 诊断。代码理解与类型/错误检查的首选技能。',
  'pi-lens-write-ast-grep-rule': '编写新的 pi-lens ast-grep 规则 YAML 文件时使用 —— 涵盖 schema、drop path、坑点与 NAPI runner 限制',
  'pi-lens-write-tree-sitter-rule': '编写新的 pi-lens tree-sitter query 规则 YAML 文件时使用 —— 涵盖 schema、S-expression 语法、capture 名称、谓词与坑点',
};

// ---------- 1) 从 zh-plugins.json 取「命令/提示词模板」的英文 → 中文 ----------
function unquoteBody(s, prefix) {
  let t = s.startsWith(prefix) ? s.slice(prefix.length) : s;
  t = t.trim();
  const q = t[0];
  if ((q === '"' || q === "'" || q === '`') && t.endsWith(q) && t.length >= 2) {
    t = t.slice(1, -1);
    t = t.replace(/\\(.)/g, (_, c) => (c === 'n' ? ' ' : c));
  }
  return t;
}

const dict = {};
const zhPlugins = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'zh-plugins.json'), 'utf8'));
for (const e of zhPlugins.entries) {
  const en = unquoteBody(e.anchor, 'description:');
  const zh = unquoteBody(e.zh, 'description:');
  if (!en || !zh || en === zh) continue;
  const k = norm(en);
  if (dict[k] && dict[k] !== zh) console.error(`  ! 冲突（同一句英文两种译法）: ${k.slice(0, 60)}`);
  dict[k] = zh;
}

// ---------- 2) 扫描各插件包里的 SKILL.md ----------
function packageDirs() {
  const out = [];
  for (const entry of fs.readdirSync(NM, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.bin') continue;
    if (entry.name.startsWith('@')) {
      for (const sub of fs.readdirSync(path.join(NM, entry.name), { withFileTypes: true })) {
        if (sub.isDirectory()) out.push({ name: `${entry.name}/${sub.name}`, dir: path.join(NM, entry.name, sub.name) });
      }
    } else {
      out.push({ name: entry.name, dir: path.join(NM, entry.name) });
    }
  }
  return out;
}

function readFrontmatterDescription(file) {
  const text = fs.readFileSync(file, 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) return null;
  const body = fm[1];
  let m = /^name:[ \t]*(.+)$/m.exec(body);
  const name = m ? m[1].trim().replace(/^["']|["']$/g, '') : path.basename(path.dirname(file));
  // 单行 description: xxx / description: "xxx"
  m = /^description:[ \t]*(\|[-+]?|>[-+]?)?[ \t]*(.*)$/m.exec(body);
  if (!m) return { name, description: null, block: false };
  if (m[1]) {
    // 块标量：取缩进的后续行
    const lines = body.split(/\r?\n/);
    const idx = lines.findIndex((l) => l.startsWith('description:'));
    const rest = [];
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^\S/.test(lines[i]) && lines[i].trim()) break;
      rest.push(lines[i]);
    }
    return { name, description: norm(rest.join('\n')), block: true };
  }
  return { name, description: norm(m[2].replace(/^["']|["']$/g, '')), block: false };
}

const skillFiles = [];
for (const pkg of packageDirs()) {
  const skillsDir = path.join(pkg.dir, 'skills');
  if (!fs.existsSync(skillsDir)) continue;
  for (const sub of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    const f = path.join(skillsDir, sub.name, 'SKILL.md');
    if (fs.existsSync(f)) skillFiles.push({ pkg: pkg.name, file: f });
  }
}

const missing = [];
const skipped = [];
for (const { pkg, file } of skillFiles) {
  const info = readFrontmatterDescription(file);
  const zh = info && SKILL_ZH[info.name];
  if (!info?.description) { skipped.push(`${pkg}/${info?.name ?? '?'}（没有 description）`); continue; }
  if (!zh) { missing.push(`${pkg} → skill "${info.name}": ${info.description}`); continue; }
  dict[norm(info.description)] = zh;
}

const out = { _注释: '斜杠命令补全说明的中文映射（键=归一化后的英文原文）。由 localize/plugin/build-autocomplete-dict.mjs 生成，勿手改。', ...dict };

if (process.argv.includes('--check')) {
  console.log(`将写入 ${Object.keys(dict).length} 条（未写入）`);
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
  console.log(`写入 ${OUT}  共 ${Object.keys(dict).length} 条`);
}
if (skipped.length) console.log(`跳过: ${skipped.join(', ')}`);
if (missing.length) {
  console.log(`\n以下技能还没有中文映射（补进 SKILL_ZH 即可）：`);
  for (const m of missing) console.log('  - ' + m);
}
