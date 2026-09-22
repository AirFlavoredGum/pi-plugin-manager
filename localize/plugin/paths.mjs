/**
 * 各脚本共用的路径解析（paths.mjs）
 *
 * 设计目标：仓库不能写死某台机器的盘符，换人 / 换安装位置也能跑。
 * 所有路径都按下面的优先级解析，都能用环境变量覆盖：
 *
 *   AGENT_DIR            终端 agent 目录        PI_CODING_AGENT_DIR
 *   NPM_DIR              已装插件所在目录        PI_PLUGIN_NM_DIR
 *   PKG_DIR              pi 本体包目录          PI_PKG_DIR
 *   ZH_AUTOCOMPLETE_DIR  zh-autocomplete 扩展   PI_ZH_AUTOCOMPLETE_DIR
 *   PLUGIN_MANAGER_DIR   plugin-manager 扩展    PI_PLUGIN_MANAGER_DIR
 *
 * 找不到时退回作者本机默认值（D:/pi-agent/...），此时后续脚本会给出直观的错误。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const toPosix = (p) => String(p).replace(/\\/g, '/');
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LOCALIZE_DIR = path.resolve(HERE, '..');

export const AGENT_DIR = toPosix(process.env.PI_CODING_AGENT_DIR ?? 'D:/pi-agent/agent');
const PI_ROOT_DEFAULT = path.dirname(AGENT_DIR);
export const NPM_DIR = toPosix(process.env.PI_PLUGIN_NM_DIR ?? path.join(AGENT_DIR, 'npm', 'node_modules'));

const REL_PKG = ['node_modules', '@earendil-works', 'pi-coding-agent'];

/** 自动定位 pi 本体（@earendil-works/pi-coding-agent）包目录 */
export function detectPkgDir() {
	const candidates = [];
	if (process.env.PI_PKG_DIR) candidates.push(process.env.PI_PKG_DIR);
	candidates.push(path.join(PI_ROOT_DEFAULT, 'current', ...REL_PKG));
	candidates.push(path.join(PI_ROOT_DEFAULT, ...REL_PKG));
	for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
		if (!dir) continue;
		candidates.push(path.join(dir, ...REL_PKG));
		candidates.push(path.join(path.dirname(dir), ...REL_PKG));
	}
	candidates.push('D:/pi-agent/current/node_modules/@earendil-works/pi-coding-agent');
	for (const c of candidates) {
		try {
			if (c && fs.existsSync(path.join(c, 'package.json'))) return toPosix(c);
		} catch {
			// 下一个
		}
	}
	return toPosix(candidates[candidates.length - 1]);
}

export const PKG_DIR = detectPkgDir();
export const CHUNK_DIR = toPosix(path.join(PKG_DIR, 'dist', 'bundle', 'chunks'));

export const ZH_AUTOCOMPLETE_DIR = toPosix(
	process.env.PI_ZH_AUTOCOMPLETE_DIR ?? path.join(AGENT_DIR, 'extensions', 'zh-autocomplete'),
);
export const PLUGIN_MANAGER_DIR = toPosix(
	process.env.PI_PLUGIN_MANAGER_DIR ?? path.join(AGENT_DIR, 'extensions', 'plugin-manager'),
);

/** 插件包的 `别名:相对路径` → 真实路径；相对路径按 base 解析（默认 NPM_DIR） */
export function resolveAlias(roots, key, base = NPM_DIR) {
	const m = /^([A-Za-z0-9_.-]+):(.+)$/.exec(key);
	if (!m) return null;
	const value = String(roots?.[m[1]] ?? '').replace(/\\/g, '/');
	if (!value) return null;
	const dir = path.isAbsolute(value) ? value : path.join(base, value).replace(/\\/g, '/');
	return toPosix(path.join(dir, m[2]));
}

/** 在 chunks 目录里找包含某段文字的打包文件（chunk 名带哈希，pi 升级会变） */
export function findChunkContaining(needle) {
	if (!fs.existsSync(CHUNK_DIR)) return null;
	for (const f of fs.readdirSync(CHUNK_DIR).filter((n) => n.endsWith('.js')).sort()) {
		try {
			if (fs.readFileSync(path.join(CHUNK_DIR, f), 'utf8').includes(needle)) return toPosix(path.join(CHUNK_DIR, f));
		} catch {
			// 下一个
		}
	}
	return null;
}

/** pi 自带的 esbuild（用于把 .ts 转成 .mjs 再做 node --check） */
export function loadEsbuild() {
	for (const id of [path.join(PKG_DIR, 'node_modules', 'esbuild'), 'esbuild']) {
		try {
			return require(id);
		} catch {
			// 下一个
		}
	}
	return null;
}

/** jiti 的 ESM 入口（用于按运行时同一条链路加载 .ts 扩展） */
export function jitiEntry() {
	for (const id of [path.join(NPM_DIR, 'jiti', 'lib', 'jiti.mjs'), path.join(AGENT_DIR, 'npm', 'node_modules', 'jiti', 'lib', 'jiti.mjs')]) {
		try {
			if (fs.existsSync(id)) return toPosix(id);
		} catch {
			// 下一个
		}
	}
	return null;
}
