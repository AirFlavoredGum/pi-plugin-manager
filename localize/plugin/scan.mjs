// 扫一遍已装插件里的 registerCommand + description（做词典前的摸底）
//   node plugin/scan.mjs
import fs from 'node:fs';
import path from 'node:path';
import { NPM_DIR } from './paths.mjs';

const REL = [
  'pi-subagents/src/slash/slash-commands.js',
  'pi-subagents/src/slash/prompt-workflows.js',
  'pi-subagents/src/extension/herdr-pi-bridge.js',
  'pi-subagents/src/watchdog/register-main.js',
  'pi-goal-x/extensions/goal-commands.ts',
  'pi-web-access/dist/index.js',
  '@plannotator/pi-extension/index.ts',
  '@gotgenes/pi-permission-system/src/config/config-modal.ts',
];
const FILES = REL.map((r) => path.join(NPM_DIR, r).replace(/\\/g, '/'));

const out = [];
for (const f of FILES) {
  let s;
  try { s = fs.readFileSync(f, 'utf8'); } catch { console.log('!! 读不到', f); continue; }
  const re = /registerCommand\(\s*(["'`])([\s\S]*?)\1/g;
  let m;
  while ((m = re.exec(s))) {
    const name = m[2];
    const tail = s.slice(m.index, m.index + 700);
    const dm = tail.match(/description:\s*(["'`])([\s\S]*?)\1/);
    out.push({ file: f.split('/node_modules/')[1], name, desc: dm ? dm[2] : null });
  }
}
console.log('总数:', out.length);
for (const o of out) console.log(`${o.file} | /${o.name} | ${o.desc === null ? '(无 description)' : o.desc}`);
fs.writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'scan.json'), JSON.stringify(out, null, 1), 'utf8');
