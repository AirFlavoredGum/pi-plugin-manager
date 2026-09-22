// 同上，第二批插件（pi-lens / pi-simplify / mem0 / rpiv-*）
//   node plugin/scan2.mjs
import fs from 'node:fs';
import path from 'node:path';
import { NPM_DIR } from './paths.mjs';

const REL = [
  'pi-lens/dist/index.js',
  'pi-simplify/dist/index.js',
  '@amaster.ai/pi-memory-mem0/dist/index.js',
  '@juicesharp/rpiv-todo/todo.ts',
  '@juicesharp/rpiv-todo/index.ts',
  '@juicesharp/rpiv-ask-user-question/index.ts',
];
const FILES = REL.map((r) => path.join(NPM_DIR, r).replace(/\\/g, '/'));

for (const f of FILES) {
  let s;
  try { s = fs.readFileSync(f, 'utf8'); } catch { console.log('!! 读不到', f); continue; }
  console.log('=========', f.split('/node_modules/')[1]);
  const re = /registerCommand\(\s*(["'`])([\s\S]*?)\1/g;
  let m, n = 0;
  while ((m = re.exec(s))) {
    n++;
    const tail = s.slice(m.index, m.index + 900);
    const dm = tail.match(/description:\s*(["'`])([\s\S]*?)\1/);
    console.log(`  /${m[2]}  →  ${dm ? dm[2].replace(/\s+/g, ' ') : '(无 description)'}`);
  }
  if (!n) console.log('  (没有 registerCommand)');
}
