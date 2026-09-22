// 提取键盘快捷键说明，格式: "tui.editor.cursorUp":{defaultKeys:"up",description:"Move cursor up"}
//   node extract-keys.mjs [chunk目录]
import fs from 'node:fs';
import path from 'node:path';
import { CHUNK_DIR, LOCALIZE_DIR } from './plugin/paths.mjs';

const dir = process.argv[2] ?? CHUNK_DIR;
const src = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
  .join('\n');

const re = /"([a-zA-Z][\w.]*)":\s*\{\s*defaultKeys:\s*(?:"(?:[^"\\]|\\.)*"|\[[^\]]*\])\s*,\s*description:\s*"((?:[^"\\]|\\.)*)"/g;
let m;
const rows = [];
while ((m = re.exec(src))) rows.push([m[1], m[2]]);

console.log('快捷键说明:', rows.length);
for (const [id, d] of rows) console.log(`  ${id.padEnd(42)} ${d}`);
fs.writeFileSync(path.join(LOCALIZE_DIR, 'keybindings.json'), JSON.stringify(rows, null, 1), 'utf8');
