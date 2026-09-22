#!/usr/bin/env node
/**
 * 一键验证：汉化 / 插件面板相关的所有东西是否都还健康
 *
 *   node plugin/verify-all.mjs
 *
 * 1. pi 本体词典（zh-dict.json）         → patch.mjs --check，要求“未匹配 0”
 * 2. 插件词典（zh-plugins.json）         → 语法验证所有被改的插件文件
 * 3. 本地扩展（zh-autocomplete / plugin-manager）→ esbuild 转译 + node --check
 * 4. JSON 文件合法性                    → zh-plugins / dict.json / descriptions.json
 * 5. /plugin-manager 面板的中文简介覆盖率 → settings.json 里的插件是否都有中文说明
 * 6. 补全映射逻辑单测                    → plugin/test-autocomplete.mjs
 * 7. 版本号一致性                        → 面板 VERSION 与 package.json 是否一致
 *
 * 路径由 plugin/paths.mjs 统一解析，可用环境变量覆盖（见该文件头部说明）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { AGENT_DIR, LOCALIZE_DIR, PLUGIN_MANAGER_DIR, ZH_AUTOCOMPLETE_DIR, loadEsbuild } from './paths.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const AGENT = AGENT_DIR;
const esbuild = loadEsbuild();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-zh-verify-all-'));
let failures = 0;
const section = (t) => console.log(`\n=== ${t} ===`);
const bad = (m) => { failures++; console.log('  FAIL  ' + m); };
const ok = (m) => console.log('  OK    ' + m);

function checkTs(file, label) {
  try {
    if (!esbuild) throw new Error('找不到 esbuild（pi 自带）');
    const code = esbuild.transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' }).code;
    const out = path.join(tmp, path.basename(file).replace(/\.ts$/, '') + '-' + Math.abs(label.length) + '.mjs');
    fs.writeFileSync(out, code, 'utf8');
    execFileSync(process.execPath, ['--check', out], { stdio: 'pipe' });
    ok(`${label}（esbuild 转译 + node --check）`);
  } catch (err) {
    const first = String(err.message || err).split('\n')[0];
    const detail = err.errors?.[0] ? `${err.errors[0].text} @ ${err.errors[0].location?.line}:${err.errors[0].location?.column}` : first;
    bad(`${label} ← ${detail}`);
  }
}

// 1. pi 本体词典
section('1. pi 本体词典 zh-dict.json');
try {
  const out = execFileSync(process.execPath, [path.join(HERE, '..', 'patch.mjs'), '--check'], { encoding: 'utf8' });
  const r = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'last-report.json'), 'utf8'));
  const miss = r.unmatched?.length ?? 0;
  const errs = r.errors?.length ?? 0;
  // patch.mjs 会用 mainFileProbe 自动找哈希后的主 chunk，所以“目标文件不存在”算真失败
  if (errs > 0) bad(`${errs} 个目标文件不存在（主 chunk 可能没找到）\n${out.trim().split('\n').slice(-3).join('\n')}`);
  else if (miss > 0) bad(`有 ${miss} 条未匹配（pi 版本可能变了）`);
  else ok(`词条 ${(r.applied?.length ?? 0) + (r.already?.length ?? 0)} 条，未匹配 0`);
} catch (err) { bad('patch.mjs --check 执行失败：' + String(err.message || err).split('\n')[0]); }

// 2 + 3. 语法验证
section('2./3. 被改过的插件文件 / 本地扩展');
try {
  const out = execFileSync(process.execPath, [path.join(HERE, 'verify-syntax.mjs')], { encoding: 'utf8' });
  const lines = out.split('\n').filter((l) => /\s(OK|FAIL)\b/.test(l) || /OK \(markdown/.test(l));
  if (/全部通过/.test(out)) ok(`插件文件 ${lines.length} 个全部通过`);
  else bad('插件文件语法检查：' + out.trim().split('\n').pop());
} catch (err) { bad('verify-syntax.mjs 失败：' + String(err.message || err).split('\n').slice(-3).join(' | ')); }
checkTs(path.join(ZH_AUTOCOMPLETE_DIR, 'index.ts'), 'zh-autocomplete/index.ts');
checkTs(path.join(PLUGIN_MANAGER_DIR, 'index.ts'), 'plugin-manager/index.ts');

// 4. JSON 合法性
section('4. JSON 文件');
for (const f of [
  path.join(HERE, '..', 'zh-dict.json'),
  path.join(HERE, '..', 'zh-plugins.json'),
  path.join(ZH_AUTOCOMPLETE_DIR, 'dict.json'),
  path.join(PLUGIN_MANAGER_DIR, 'descriptions.json'),
]) {
  try { JSON.parse(fs.readFileSync(f, 'utf8')); ok(path.relative(HERE, f)); }
  catch (err) { bad(`${f} ← ${String(err.message || err).split('\n')[0]}`); }
}

// 5. /plugin-manager 面板中文简介覆盖率
section('5. /plugin-manager 面板中文简介');
try {
  const settings = JSON.parse(fs.readFileSync(path.join(AGENT, 'settings.json'), 'utf8'));
  const desc = JSON.parse(fs.readFileSync(path.join(PLUGIN_MANAGER_DIR, 'descriptions.json'), 'utf8'));
  const missing = [];
  for (const p of settings.packages ?? []) {
    const key = typeof p === 'string' ? p : p.source;
    if (!desc[key]) missing.push(key);
  }
  if (missing.length) bad(`这些插件还没有中文简介：${missing.join(', ')}`);
  else ok(`settings.json 里 ${(settings.packages ?? []).length} 个插件全部有中文简介`);
} catch (err) { bad('覆盖率检查失败：' + String(err.message || err).split('\n')[0]); }

// 6. 补全映射单测
section('6. 补全映射单测');
try {
  const out = execFileSync(process.execPath, [path.join(HERE, 'test-autocomplete.mjs')], { encoding: 'utf8' });
  if (/全部通过/.test(out)) ok('zh-autocomplete 映射逻辑全部通过');
  else bad('单测未通过：' + out.trim().split('\n').slice(-3).join(' | '));
} catch (err) { bad('test-autocomplete.mjs 失败：' + String(err.message || err).split('\n').slice(-3).join(' | ')); }

// 7. 版本号一致性
section('7. 版本号一致性');
try {
  const panel = fs.readFileSync(path.join(PLUGIN_MANAGER_DIR, 'index.ts'), 'utf8');
  const m = /const VERSION = "([^"]+)"/.exec(panel);
  const candidates = [path.join(LOCALIZE_DIR, '..', 'package.json'), path.join(PLUGIN_MANAGER_DIR, 'package.json')];
  const pkgFile = candidates.find((f) => {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')).name === 'pi-plugin-manager'; } catch { return false; }
  });
  if (!m) bad('面板里找不到 VERSION 常量');
  else if (!pkgFile) ok(`面板 v${m[1]}（本地安装没有 package.json，跳过对比）`);
  else {
    const version = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).version;
    if (m[1] !== version) bad(`面板 v${m[1]} ≠ ${pkgFile} 里的 v${version}`);
    else ok(`pi-plugin-manager v${m[1]} 与 package.json 一致`);
  }
} catch (err) { bad('版本号检查失败：' + String(err.message || err).split('\n')[0]); }

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n共 ${failures} 项失败` : '\n全部检查通过 ✅');
process.exitCode = failures ? 1 : 0;
