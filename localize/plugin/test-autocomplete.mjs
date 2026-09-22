#!/usr/bin/env node
/**
 * 离线测试 zh-autocomplete 扩展的映射逻辑（不启动 pi、不联网、不调模型）
 *
 *   node plugin/test-autocomplete.mjs
 *
 * 做法：用 pi 自己用的 jiti 加载那个 .ts，喂一个假的 pi / 假 provider，
 * 断言「斜杠命令补全」里带 [来源] 前缀的英文说明能被换成中文，且英文原样兜底。
 */
import path from 'node:path';
import { ZH_AUTOCOMPLETE_DIR, jitiEntry, toPosix } from './paths.mjs';

const jitiPath = jitiEntry();
if (!jitiPath) {
  console.error('找不到 jiti（请先装 pi 或设 PI_PLUGIN_NM_DIR）');
  process.exit(1);
}
const { createJiti } = await import(`file:///${jitiPath}`);
const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: false, interopDefault: true });
const mod = await jiti.import(toPosix(path.join(ZH_AUTOCOMPLETE_DIR, 'index.ts')));
const register = mod.default ?? mod;

let wrapper = null;
const fakePi = { on: (event, handler) => { if (event === 'session_start') handler({}, { ui: { addAutocompleteProvider: (f) => { wrapper = f(current); } } }); } };
const current = {
  triggerCharacters: ['@'],
  async getSuggestions(lines, cursorLine, cursorCol) {
    return {
      prefix: '/',
      items: [
        { value: '/subagents', label: '/subagents', description: '[u] Administer subagents: inspect metadata and update models, thinking, or prompts' },
        { value: '/skill:pi-subagents', label: '/skill:pi-subagents', description: '[u] Technical guidance for operator-requested delegation to builtin or custom\nsubagents: bounded handoffs, parallel review, scripted workflows, async work,\nforked context, isolation, and coordinated execution.' },
        { value: '/skill:pi-lens-ast-grep', label: '/skill:pi-lens-ast-grep', description: '[u] Use when searching or replacing code patterns - use ast-grep instead of text search for semantic accuracy' },
        { value: '/lens-tdi', label: '/lens-tdi', description: '[u] Show Technical Debt Index (TDI) and project health trend. Usage: /lens-tdi' },
        { value: '/untranslated', label: '/untranslated', description: 'Some brand new English description nobody translated' },
        { value: '/nodesc', label: '/nodesc' },
      ],
    };
  },
  applyCompletion: () => ({ lines: [], cursorLine: 0, cursorCol: 0 }),
  shouldTriggerFileCompletion: () => true,
};

register(fakePi);
if (!wrapper) throw new Error('扩展没有注册 autocomplete provider');
const res = await wrapper.getSuggestions([], 0, 1, {});

let bad = 0;
const expectZh = new Set(['/subagents', '/skill:pi-subagents', '/skill:pi-lens-ast-grep', '/lens-tdi']);
for (const item of res.items) {
  const zh = /[一-鿿]/.test(item.description ?? '');
  const want = expectZh.has(item.label);
  const ok = want ? zh : (item.label === '/untranslated' ? !zh : true);
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${item.label.padEnd(24)} ${item.description ?? '(无说明)'}`);
}

// 兜底：applyCompletion 必须仍然转发给原 provider
const applied = wrapper.applyCompletion([], 0, 0, res.items[0], '/');
if (!applied || typeof applied !== 'object') { bad++; console.log('FAIL applyCompletion 没有转发'); }
// 触发字符必须继承，否则 @ 补全会被破坏
if (wrapper.triggerCharacters?.[0] !== '@') { bad++; console.log('FAIL triggerCharacters 未继承'); }

console.log(bad ? `\n${bad} 项失败` : '\n全部通过');
process.exitCode = bad ? 1 : 0;
