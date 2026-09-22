// 用法: node ctx.mjs <关键词> [前] [后] [最多命中数]
// 在 pi 的打包 chunk 里查一段文字的上下文（判断该不该翻 / 抄锚点用）。
// chunk 名带哈希，会随 pi 升级变化，所以这里自动搜索而不是写死文件名。
import fs from 'node:fs';
import path from 'node:path';
import { CHUNK_DIR, findChunkContaining } from './plugin/paths.mjs';

const [needle, before = 200, after = 600, max = 3] = process.argv.slice(2);
if (!needle) {
  console.error('用法: node ctx.mjs <关键词> [前] [后] [最多命中数]');
  process.exit(2);
}

const file = findChunkContaining(needle);
if (!file) {
  console.error(`在 ${CHUNK_DIR} 里找不到包含该关键词的文件: ${needle}`);
  process.exit(1);
}
const src = fs.readFileSync(file, 'utf8');
console.log(`文件: ${path.relative(CHUNK_DIR, file)}  (${src.length} 字符)`);

let idx = 0, n = 0;
while (n < Number(max)) {
  const i = src.indexOf(needle, idx);
  if (i < 0) break;
  idx = i + needle.length;
  n++;
  console.log(`\n===== 命中 ${n} @ ${i} =====`);
  console.log(src.slice(Math.max(0, i - Number(before)), i + Number(after)));
}
if (n === 0) console.log('未命中:', needle);
