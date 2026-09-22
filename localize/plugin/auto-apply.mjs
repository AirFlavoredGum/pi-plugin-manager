#!/usr/bin/env node
/**
 * pi-zh-localize · auto-apply.mjs — 「pi 更新后自动重跑汉化」（默认关闭）
 *
 * 为什么需要它：pi 每次升级/重装都会覆盖 dist，汉化就掉了，以前只能手动重跑一次。
 * 这个脚本让 /plugin-manager 在启动时自动重跑 —— 但只在**确实掉了**的时候。
 *
 * 判断“汉化还在不在”用的是内容探测，不是时间戳：
 *   上次成功汉化时记下命中过的主 chunk 文件名 + 一条中文标记，
 *   下次只需读那一个文件做一次 includes()（约 10ms）就知道汉化是否还在。
 *   （不用 mtime/大小指纹：补丁本身就会改这些文件，指纹会自相矛盾。）
 *
 * 安全设计（本脚本的重点）：
 *   1. 默认关闭 —— 必须显式 `--enable`，或在面板里把那一行切成开启
 *   2. 汉化仍在 → 直接跳过（约 10ms），不跑 patch、不碰任何文件
 *   3. 单实例锁 —— 并发启动两个 pi 时只有一个真正执行
 *   4. 走的还是 patch.mjs --apply --verify（先备份英文原文，再跑 pi --version 自检）
 *   5. **自检失败就自动还原** —— 宁可退回英文原版，也不留下一个启动不了的 pi
 *   6. 同一个 pi 版本失败过就不再重复折腾（不刷屏），下次 pi 升级会重新尝试
 *   7. 全程写 auto-apply.log，状态写 auto-apply.json，你随时能看清它做过什么
 *   8. `--dry-run` 只报告会做什么，一个字节都不写
 *
 * 退出码（面板据此决定用 info / warning / error 通知）：
 *   0 正常（无需动手 / 汉化仍在 / 成功重跑 / 已被手动汉化只补记）
 *   3 重跑成功但有词条失配（pi 改了文案，需要人工更新词典）
 *   2 重跑失败（已自动还原英文原版），或脚本自身出错
 *   4 被锁跳过（另一个进程正在跑）
 *
 * 用法：
 *   node plugin/auto-apply.mjs                 # 按需重跑（面板启动时调用的就是它）
 *   node plugin/auto-apply.mjs --dry-run       # 只看会不会重跑
 *   node plugin/auto-apply.mjs --enable|--disable
 *   node plugin/auto-apply.mjs --status
 *   node plugin/auto-apply.mjs --forget        # 清掉缓存的 chunk 名/标记（下次强制体检）
 *   加 --json 输出机器可读的单行 JSON
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { LOCALIZE_DIR, PKG_DIR, toPosix } from './paths.mjs';

const TOOL_VERSION = (() => {
	try { return JSON.parse(fs.readFileSync(path.join(LOCALIZE_DIR, 'package.json'), 'utf8')).version; } catch { return '0.0.0'; }
})();

const PATCH = path.join(LOCALIZE_DIR, 'patch.mjs');
const DICT_MAIN = path.join(LOCALIZE_DIR, 'zh-dict.json');
const DICT_PLUGINS = path.join(LOCALIZE_DIR, 'zh-plugins.json');
const REPORT = path.join(LOCALIZE_DIR, 'last-report.json');
const STATE_FILE = path.join(LOCALIZE_DIR, 'auto-apply.json');
const LOCK_FILE = path.join(LOCALIZE_DIR, '.auto-apply.lock');
const LOG_FILE = path.join(LOCALIZE_DIR, 'auto-apply.log');
const CHUNK_DIR = path.join(PKG_DIR, 'dist', 'bundle', 'chunks');
const LOCK_STALE_MS = 10 * 60 * 1000;
const LOG_MAX_BYTES = 200 * 1024;

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const JSON_OUT = flag('--json');
const DRY_RUN = flag('--dry-run');

// ---------------------------------------------------------------------------
// 状态文件
// ---------------------------------------------------------------------------

function defaultState() {
	return {
		_说明: '由 localize/plugin/auto-apply.mjs 与 /plugin-manager 面板共同维护。enabled = 是否允许 pi 更新后自动重跑汉化（默认 false）。mainChunk/sampleZh 是“汉化还在不在”的 10ms 快速探测缓存。',
		enabled: false,
		appliedPiVersion: null,
		mainChunk: null,
		sampleZh: null,
		failedPiVersion: null,
		lastAttempt: null,
	};
}

function readState() {
	try {
		return { ...defaultState(), ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
	} catch {
		return defaultState();
	}
}

function writeState(next) {
	if (DRY_RUN) return next;
	fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
	return next;
}

function piVersion() {
	try { return JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8')).version ?? null; } catch { return null; }
}

function dictSampleZh() {
	try {
		const dict = JSON.parse(fs.readFileSync(DICT_MAIN, 'utf8'));
		return dict.entries?.find((e) => typeof e.zh === 'string' && e.zh.trim())?.zh ?? null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// 快速探测：汉化还在不在（约 10ms，只读一个文件）
// ---------------------------------------------------------------------------

/**
 * @returns true 汉化仍在 | false 已不在 | null 没法便宜判断（需要跑 patch.mjs --check）
 */
function stillApplied(state) {
	const sample = state.sampleZh ?? dictSampleZh();
	if (!state.mainChunk || !sample) return null;
	const file = path.join(CHUNK_DIR, state.mainChunk);
	try {
		if (!fs.statSync(file).isFile()) return null;
		return fs.readFileSync(file, 'utf8').includes(sample);
	} catch {
		return false; // 上次命中的 chunk 都不见了 → 肯定掉了
	}
}

// ---------------------------------------------------------------------------
// 单实例锁
// ---------------------------------------------------------------------------

function acquireLock() {
	const payload = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
	try {
		fs.writeFileSync(LOCK_FILE, payload, { flag: 'wx' });
		return true;
	} catch {
		try {
			// 僵尸锁（超过 10 分钟）才抢过来
			if (Date.now() - fs.statSync(LOCK_FILE).mtimeMs > LOCK_STALE_MS) {
				fs.writeFileSync(LOCK_FILE, payload);
				return true;
			}
		} catch {
			try { fs.writeFileSync(LOCK_FILE, payload, { flag: 'wx' }); return true; } catch { return false; }
		}
		return false;
	}
}

function releaseLock() {
	try { fs.unlinkSync(LOCK_FILE); } catch { /* 已经不在了 */ }
}

// ---------------------------------------------------------------------------
// 日志
// ---------------------------------------------------------------------------

function log(line) {
	const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
	try {
		if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > LOG_MAX_BYTES) {
			fs.writeFileSync(LOG_FILE, fs.readFileSync(LOG_FILE, 'utf8').split('\n').slice(-400).join('\n'), 'utf8');
		}
		fs.appendFileSync(LOG_FILE, `[${stamp}] ${line}\n`, 'utf8');
	} catch {
		// 日志写不进去不能影响主流程
	}
}

// ---------------------------------------------------------------------------
// 跑 patch.mjs / 读报告
// ---------------------------------------------------------------------------

function runPatch(args, dict) {
	const full = [PATCH, ...args];
	if (dict) full.push('--dict', dict);
	const r = spawnSync(process.execPath, full, { encoding: 'utf8', timeout: 15 * 60 * 1000 });
	return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const lastReport = () => { try { return JSON.parse(fs.readFileSync(REPORT, 'utf8')); } catch { return null; } };

const statsOf = (report) => ({
	applied: report?.applied?.length ?? 0,
	already: report?.already?.length ?? 0,
	unmatched: report?.unmatched?.length ?? 0,
	errors: report?.errors?.length ?? 0,
	skipped: report?.skipped?.length ?? 0,
	blocked: report?.blocked?.length ?? 0,
});

const summarize = (s) => `已汉化 ${s.applied} · 已是中文 ${s.already} · 失配 ${s.unmatched} · 错误 ${s.errors}`;

/** 只读体检当前汉化状态（不写任何文件） */
function localizeState() {
	if (!fs.existsSync(PATCH) || !fs.existsSync(DICT_MAIN)) return { state: 'missing', why: '找不到 patch.mjs 或 zh-dict.json' };
	const r = runPatch(['--check', '--quiet']);
	const report = lastReport();
	const stats = statsOf(report);
	const state = stats.errors > 0 ? 'error' : stats.applied > 0 ? 'off' : stats.already > 0 ? 'on' : 'unknown';
	return { state, stats, code: r.code, mainChunk: report?.resolved?.main ?? null };
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

function finish(payload, human, exitCode) {
	const out = { toolVersion: TOOL_VERSION, ...payload };
	if (JSON_OUT) console.log(JSON.stringify(out));
	else if (human) console.log(human);
	process.exitCode = exitCode;
	return out;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function main() {
	const state = readState();

	if (flag('--version') || flag('-V')) {
		console.log(`pi-zh-localize auto-apply v${TOOL_VERSION}`);
		return;
	}

	if (flag('--help') || flag('-h')) {
		console.log(`pi-zh-localize auto-apply v${TOOL_VERSION}  （pi 更新后自动重跑汉化，默认关闭）

  node plugin/auto-apply.mjs                 按需重跑（面板启动时调用的就是它）
  node plugin/auto-apply.mjs --dry-run       只看会做什么，不写任何文件
  node plugin/auto-apply.mjs --enable        允许自动重跑
  node plugin/auto-apply.mjs --disable       禁止自动重跑
  node plugin/auto-apply.mjs --status        看现状
  node plugin/auto-apply.mjs --forget        清掉快速探测缓存（下次强制完整体检）
  通用：--json 机器可读输出

状态文件: ${STATE_FILE}
日志:     ${LOG_FILE}
pi 目录:  ${PKG_DIR}`);
		return;
	}

	if (flag('--enable') || flag('--disable') || flag('--forget')) {
		const enabled = flag('--enable') ? true : flag('--disable') ? false : state.enabled;
		const cleared = flag('--forget');
		writeState({
			...state,
			enabled,
			mainChunk: cleared ? null : state.mainChunk,
			sampleZh: cleared ? null : state.sampleZh,
			failedPiVersion: flag('--disable') || cleared ? null : state.failedPiVersion,
		});
		const what = flag('--forget') ? '已清掉快速探测缓存' : enabled ? '已开启：pi 更新后会自动重跑汉化' : '已关闭：pi 更新后不再自动重跑';
		log(`set enabled=${enabled}${cleared ? ' forget' : ''}${DRY_RUN ? ' (dry-run，未写入)' : ''}`);
		return finish({ action: flag('--forget') ? 'forget' : enabled ? 'enabled' : 'disabled', enabled, cleared, stateFile: toPosix(STATE_FILE), dryRun: DRY_RUN }, what, 0);
	}

	if (flag('--status')) {
		const applied = stillApplied(state);
		return finish(
			{
				action: 'status',
				enabled: state.enabled,
				stillApplied: applied,
				mainChunk: state.mainChunk,
				appliedPiVersion: state.appliedPiVersion,
				piVersion: piVersion(),
				failedPiVersion: state.failedPiVersion,
				lastAttempt: state.lastAttempt,
				stateFile: toPosix(STATE_FILE),
				logFile: toPosix(LOG_FILE),
				piDir: toPosix(PKG_DIR),
			},
			[
				`自动重跑汉化     : ${state.enabled ? '已开启' : '已关闭（默认）'}`,
				`pi 版本          : ${piVersion() ?? '?'}（上次成功汉化时 ${state.appliedPiVersion ?? '未记录'}）`,
				`汉化是否还在     : ${applied === null ? '未缓存，下次会体检' : applied ? '在（快速探测命中）' : '已不在（下次启动会重跑）'}`,
				`上次命中的 chunk : ${state.mainChunk ?? '未记录'}`,
				`上次尝试         : ${state.lastAttempt ? `${state.lastAttempt.at} ${state.lastAttempt.result} — ${state.lastAttempt.detail ?? ''}` : '无'}`,
				`状态文件         : ${STATE_FILE}`,
				`日志             : ${LOG_FILE}`,
			].join('\n'),
			0,
		);
	}

	// ---- 默认动作：按需重跑 ----
	if (!state.enabled) {
		return finish({ action: 'skip', reason: 'auto-apply 未开启', enabled: false }, 'auto-apply 未开启，什么也没做', 0);
	}

	if (!fs.existsSync(PATCH) || !fs.existsSync(DICT_MAIN)) {
		return finish({ action: 'skip', reason: '找不到 patch.mjs 或 zh-dict.json' }, '跳过：找不到汉化词典', 0);
	}
	if (!fs.existsSync(CHUNK_DIR)) {
		return finish({ action: 'skip', reason: '不是标准 pi 安装（找不到 dist/bundle/chunks）', chunksDir: toPosix(CHUNK_DIR) }, `跳过：找不到 ${CHUNK_DIR}`, 0);
	}

	// 1) 便宜路径：汉化还在 → 什么都不做
	const applied = stillApplied(state);
	if (applied === true) {
		if (state.appliedPiVersion !== piVersion()) {
			writeState({ ...state, appliedPiVersion: piVersion() });
			log(`skip: pi ${piVersion()} 但汉化仍在（${state.mainChunk}），只更新记录的版本号`);
		}
		return finish({ action: 'skip', reason: '汉化仍然生效', mainChunk: state.mainChunk, piVersion: piVersion() }, '汉化仍然是生效的，无需重跑', 0);
	}

	// 2) 同一 pi 版本已失败过 → 不重复折腾
	if (state.failedPiVersion && state.failedPiVersion === piVersion()) {
		log(`skip: pi ${piVersion()} 上次已失败，不重复尝试`);
		return finish(
			{ action: 'skip', reason: '同一 pi 版本上次重跑失败过，不重复尝试', failedPiVersion: state.failedPiVersion },
			'跳过：同一个 pi 版本上上次重跑失败过（已还原英文原版），等升级 pi 或手动处理',
			0,
		);
	}

	// 3) 完整体检（约 0.5s），拿到确定结论
	const before = localizeState();
	const needApply = before.state !== 'on';

	if (DRY_RUN) {
		log(`dry-run: 探测=${applied}，体检=${before.state}，${needApply ? '会重跑' : '不需要'}`);
		return finish(
			{ action: needApply ? 'would-run' : 'would-skip', reason: needApply ? '汉化已不在' : '汉化仍在', probe: applied, currentState: before.state, stats: before.stats },
			`${needApply ? '会重跑汉化' : '不需要重跑'}：体检结果 ${before.state}（${summarize(before.stats)}），探测=${applied === null ? '未缓存' : applied}`,
			0,
		);
	}

	if (!needApply) {
		// 体检说汉化在（例如缓存没命中但别的 chunk 命中了）：补记缓存
		writeState({ ...state, mainChunk: before.mainChunk ?? state.mainChunk, sampleZh: state.sampleZh ?? dictSampleZh(), appliedPiVersion: piVersion(), failedPiVersion: null, lastAttempt: { at: new Date().toISOString(), result: 'noop-already-on', detail: summarize(before.stats) } });
		log(`noop: 体检=${before.state}，补记 mainChunk=${before.mainChunk}`);
		return finish({ action: 'noop', reason: '已是汉化状态', stats: before.stats, mainChunk: before.mainChunk }, '已经是汉化的，只补记了探测缓存', 0);
	}

	if (!acquireLock()) {
		log('skip: 另一个进程正在运行');
		return finish({ action: 'skip', reason: '另一个进程正在运行（锁被占用）' }, '跳过：另一个 auto-apply 正在运行', 4);
	}

	try {
		log(`run: pi ${piVersion()}，汉化已不在（探测=${applied}，体检=${before.state}），开始重跑`);

		// 主词典：应用 + 自检。退出码非 0 = 自检没过（下次 pi 起不来）→ 立刻还原
		const main = runPatch(['--apply', '--verify']);
		const report = lastReport();
		const mainStats = statsOf(report);

		if (main.code !== 0) {
			const why = (main.stderr || main.stdout).trim().split('\n').slice(-2).join(' | ');
			log(`FAIL: 主词典自检未通过（exit ${main.code}），自动还原 —— ${why}`);
			runPatch(['--revert', '--keep-intent']);
			if (fs.existsSync(DICT_PLUGINS)) runPatch(['--revert', '--keep-intent'], DICT_PLUGINS);
			writeState({
				...state,
				mainChunk: null,
				sampleZh: null,
				failedPiVersion: piVersion(),
				lastAttempt: { at: new Date().toISOString(), result: 'failed-reverted', detail: `自检未通过，已还原英文原版（exit ${main.code}）` },
			});
			return finish(
				{ action: 'failed-reverted', reason: '自检未通过，已自动还原', exitCode: main.code, stats: mainStats, reverted: true, piVersion: piVersion() },
				[
					`pi 升级到 ${piVersion() ?? '?'} 后重跑汉化失败，已自动还原为英文原版（自检 pi --version 没过）。`,
					`  原因：${why || '(无输出)'}`,
					`  统计：${summarize(mainStats)}`,
					'pi 仍然可以正常启动；想看是哪几条词条：node patch.mjs --check',
				].join('\n'),
				2,
			);
		}

		// 插件词典：失败不牵连主词典（主词典已经过自检）
		let pluginStats = null;
		let pluginFailed = false;
		if (fs.existsSync(DICT_PLUGINS)) {
			const plug = runPatch(['--apply'], DICT_PLUGINS);
			pluginStats = statsOf(lastReport());
			pluginFailed = plug.code !== 0;
			if (pluginFailed) {
				log(`WARN: 插件词典 apply 失败（exit ${plug.code}），单独还原插件词典`);
				runPatch(['--revert', '--keep-intent'], DICT_PLUGINS);
			}
		}

		const mainChunk = report?.resolved?.main ?? state.mainChunk ?? null;
		writeState({
			...state,
			appliedPiVersion: piVersion(),
			mainChunk,
			sampleZh: dictSampleZh(),
			failedPiVersion: null,
			lastAttempt: {
				at: new Date().toISOString(),
				result: 'applied',
				detail: `${summarize(mainStats)}${pluginStats ? `；插件词典 ${summarize(pluginStats)}` : ''}`,
			},
		});

		const warn = mainStats.unmatched > 0 || mainStats.errors > 0 || mainStats.blocked > 0 || pluginFailed || (pluginStats?.unmatched ?? 0) > 0;
		const detail = `主词典：${summarize(mainStats)}${pluginStats ? `；插件词典：${summarize(pluginStats)}` : ''}`;
		log(`${warn ? 'WARN' : 'OK'}: 重跑完成 —— ${detail}（mainChunk=${mainChunk}）`);

		return finish(
			{ action: 'applied', stats: mainStats, pluginStats, pluginFailed, piVersion: piVersion(), mainChunk },
			[
				`pi 升级到 ${piVersion() ?? '?'}，已自动重跑汉化（重启 pi 后生效）`,
				`  ${detail}`,
				...(warn ? ['  有词条失配或被拦下：跑 node patch.mjs --check 看是哪几条（失配的保持英文，不会改坏别处）'] : []),
			].join('\n'),
			warn ? 3 : 0,
		);
	} finally {
		releaseLock();
	}
}

try {
	main();
} catch (error) {
	const why = error instanceof Error ? error.message : String(error);
	log(`ERROR: ${why}`);
	finish({ action: 'error', reason: why }, `auto-apply 出错：${why}`, 2);
}
