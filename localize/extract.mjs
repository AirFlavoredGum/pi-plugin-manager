// 从 pi 打包产物中提取"用户可见文案"候选，用于人工挑选翻译
//   node extract.mjs [chunk目录] [输出文件]
import fs from 'node:fs';
import path from 'node:path';
import { CHUNK_DIR, LOCALIZE_DIR } from './plugin/paths.mjs';

const dir = process.argv[2] ?? CHUNK_DIR;
const OUT = process.argv[3] ?? path.join(LOCALIZE_DIR, 'extracted.json');

const KEYS = ['label', 'title', 'description', 'placeholder', 'hint', 'message', 'text'];
const all = {};

for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const key of KEYS) {
    const re = new RegExp(`\\b${key}:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'g');
    let m;
    while ((m = re.exec(src))) {
      const v = m[1];
      // 只保留像"英文句子/短语"的：含空格、含小写字母、非代码片段
      if (!/[a-z]/.test(v) || !/ /.test(v) || v.length < 4 || v.length > 200) continue;
      if (/[;{}()=<>]|\bvar \b|\btypeof |__require|\$\{/.test(v)) continue;
      const k = `${key}:"${v}"`;
      all[k] ??= { key, text: v, files: {}, count: 0 };
      all[k].count++;
      all[k].files[f] = (all[k].files[f] ?? 0) + 1;
    }
  }
}

const rows = Object.values(all).sort((a, b) => a.key.localeCompare(b.key));
fs.writeFileSync(OUT, JSON.stringify(rows, null, 1), 'utf8');

console.log('候选总数:', rows.length);
for (const k of KEYS) console.log(`  ${k}: ${rows.filter((r) => r.key === k).length}`);
const files = new Set(rows.flatMap((r) => Object.keys(r.files)));
console.log('涉及文件:', [...files].join(', '));
console.log('写入:', OUT);
