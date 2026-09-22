// 提取 /settings 面板条目：{id:"x",label:"...",description:"...",...}
//   node extract-settings.mjs [chunk目录]
import fs from 'node:fs';
import path from 'node:path';
import { CHUNK_DIR, LOCALIZE_DIR } from './plugin/paths.mjs';

const dir = process.argv[2] ?? CHUNK_DIR;
const src = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
  .join('\n');

const re = /\{id:"([a-z0-9-]+)",label:"((?:[^"\\]|\\.)*)",description:"((?:[^"\\]|\\.)*)"/g;
let m;
const rows = [];
while ((m = re.exec(src))) rows.push({ id: m[1], label: m[2], desc: m[3] });

console.log('条目数:', rows.length);
fs.writeFileSync(path.join(LOCALIZE_DIR, 'settings-items.json'), JSON.stringify(rows, null, 1), 'utf8');
for (const r of rows) console.log(`- ${r.label}\n    ${r.desc}`);
