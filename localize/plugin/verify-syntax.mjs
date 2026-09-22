#!/usr/bin/env node
/**
 * 校验被汉化补丁改过的插件文件是否还能正常解析（语法级验证）
 *
 *   node plugin/verify-syntax.mjs
 *
 *  - .js/.mjs  → node --check
 *  - .ts       → 用 pi 自带 esbuild 转译后再 node --check
 *  - .md       → 检查 frontmatter 的 description: 行仍是单行非空
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadEsbuild, resolveAlias } from './paths.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const dict = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'zh-plugins.json'), 'utf8'));
const roots = dict.roots;
const esbuild = loadEsbuild();

const files = [...new Set(dict.entries.map((e) => e.file))];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-zh-verify-'));

let bad = 0;
for (const key of files) {
  const full = resolveAlias(roots, key);
  process.stdout.write(`${key.padEnd(52)} `);
  if (!full) {
    bad++;
    console.log('FAIL ← 无法解析 root 别名（见 zh-plugins.json 的 roots）');
    continue;
  }
  try {
    if (/\.md$/.test(full)) {
      const line = fs.readFileSync(full, 'utf8').split(/\r?\n/).find((l) => l.startsWith('description:'));
      if (!line || !line.slice('description:'.length).trim()) throw new Error('description 行无效');
      console.log('OK (markdown frontmatter)');
      continue;
    }
    const src = fs.readFileSync(full, 'utf8');
    let code = src;
    if (/\.ts$/.test(full)) {
      if (!esbuild) throw new Error('找不到 esbuild（无法转译 .ts）');
      code = esbuild.transformSync(src, { loader: 'ts', format: 'esm', target: 'es2022' }).code;
    }
    const out = path.join(tmp, path.basename(full).replace(/\.ts$/, '.mjs')) + (/(\.mjs|\.js)$/.test(full) ? '' : '.mjs');
    fs.writeFileSync(out, code, 'utf8');
    execFileSync(process.execPath, ['--check', out], { stdio: 'pipe' });
    console.log('OK');
  } catch (err) {
    bad++;
    const first = String(err.message || err).split('\n')[0];
    const detail = err.errors?.[0] ? `${err.errors[0].text} @ ${err.errors[0].location?.line}:${err.errors[0].location?.column}` : first;
    console.log('FAIL ← ' + detail);
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `\n${bad} 个文件有语法问题 → 请运行 node patch.mjs --dict zh-plugins.json --revert` : '\n全部通过');
process.exitCode = bad ? 1 : 0;
