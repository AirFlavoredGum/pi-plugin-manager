/**
 * Plugin Manager — /plugin-manager (v1.1.0)
 *
 * 面板里有三样东西：
 *   1. 你下载/安装的插件（settings.json 里的 packages）自带的 extensions / skills / prompts / themes
 *   2. pi 界面汉化开关（可选组件 localize/patch.mjs）—— 同时管主词典（pi 界面）与 zh-plugins.json（插件补全说明）
 *   3. 「pi 更新后自动重跑汉化」开关（默认关闭）—— 开启后，每次 pi 启动检查一次汉化是否还在，
 *      掉了就用 patch.mjs --apply --verify 补回来；自检没过则自动还原成英文并通知你。
 *      细节：localize/plugin/auto-apply.mjs（状态文件 auto-apply.json，日志 auto-apply.log）
 *
 * 每个插件名后面会自动跟一个小括号简介：
 *   - 默认读该插件自己的 package.json 的 description，所以**新装的插件自动就有**，不用维护
 *   - 想改成自己的说法（比如中文），编辑本目录下的 descriptions.json：
 *       { "npm:pi-subagents": "多代理编排" }
 *     这里的条目优先于 package.json
 *
 * 自动发现的本地资源（~/.pi/agent/skills、extensions、prompts、themes）默认**不显示**，
 * 因为那部分是 DIY 资源、不是"下载的插件"。把 SCOPE 改成 "all" 即可一起管理。
 *
 * 按键：
 *   ↑ / ↓      移动
 *   space      切换开关 —— 可以连续切换任意多个，面板不会关闭
 *   /          搜索（插件名、简介、资源名都能搜到）
 *   r          重新扫描（识别新装的插件 / 重新检测汉化状态）
 *   esc enter  关闭；有改动时自动 reload，让开关立即生效
 *
 * 写入 settings.json 的就是官方 pattern 语法（与 `pi config` 完全互通）：
 *   "path" 包含   "!glob" 排除   "+path" 强制包含   "-path" 强制排除
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
	SettingsManager,
	DefaultPackageManager,
	getAgentDir,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExecResult,
	type ExtensionContext,
	type PathMetadata,
	type ResolvedPaths,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

type ResourceType = "extensions" | "skills" | "prompts" | "themes";

const RESOURCE_TYPES: ResourceType[] = ["extensions", "skills", "prompts", "themes"];

const TYPE_LABELS: Record<ResourceType, string> = {
	extensions: "Extensions",
	skills: "Skills",
	prompts: "Prompts",
	themes: "Themes",
};

/** "packages" = 只显示已安装插件（默认）；"all" = 连自动发现的本地资源一起显示 */
const SCOPE: "packages" | "all" = "packages";

/** 面板版本号（与 package.json 的 version 保持一致） */
const VERSION = "1.1.0";

/**
 * 本扩展所在目录。仓库里是 <root>/extensions/index.ts，本地安装是 <agent>/extensions/plugin-manager/index.ts，
 * 两种情况都靠它定位同目录或上一级的 descriptions.json。
 */
const EXT_DIR = dirname(fileURLToPath(import.meta.url));

/** descriptions.json：先看扩展自己目录，再看包根目录（仓库布局） */
function findOverridesFile(): string | undefined {
	for (const candidate of [join(EXT_DIR, "descriptions.json"), join(EXT_DIR, "..", "descriptions.json")]) {
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

const OVERRIDES_FILE = findOverridesFile();

const NODE_BIN = process.versions.bun ? "node" : process.execPath;

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

interface Item {
	path: string;
	enabled: boolean;
	resourceType: ResourceType;
	displayName: string;
	metadata: PathMetadata;
}

/** 一个插件（settings.json 里的一个 package 条目） */
interface PluginInfo {
	source: string;
	version?: string;
	/** 最终显示的小括号内容（超出 descriptions.json 覆盖） */
	description?: string;
	/** package.json 里的原始 description，即使被覆盖也保留，供搜索匹配 */
	rawDescription?: string;
	/** 解析不出任何资源时的提示 */
	note?: string;
}

interface Group {
	key: string;
	label: string;
	version?: string;
	description?: string;
	altDescription?: string;
	note?: string;
	items: Map<ResourceType, Item[]>;
}

type LocalizeState = "on" | "off" | "partial" | "unknown" | "missing";

interface LocalizeInfo {
	state: LocalizeState;
	detail: string;
	script?: string;
	/** localize/package.json 里的版本号（装了才有） */
	version?: string;
}

/** localize/auto-apply.json：由 auto-apply.mjs 与面板共同维护 */
interface AutoApplyState {
	enabled?: boolean;
	appliedPiVersion?: string | null;
	mainChunk?: string | null;
	sampleZh?: string | null;
	failedPiVersion?: string | null;
	lastAttempt?: { at?: string; result?: string; detail?: string } | null;
}

type Row =
	| {
			kind: "header";
			label: string;
			/** 有 items = 资源类型表头（带启用计数） */
			items?: Item[];
			/** plugin = 插件表头（带版本 + 小括号简介） */
			plugin?: { version?: string; description?: string; note?: string };
	  }
	| { kind: "item"; item: Item }
	| { kind: "localize" }
	| { kind: "autoApply" };

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

const isOverridePattern = (p: string) => p.startsWith("!") || p.startsWith("+") || p.startsWith("-");
const stripPatternPrefix = (p: string) => (isOverridePattern(p) ? p.slice(1) : p);
/** pi 内部匹配时会做 posix 归一化，这里也统一成正斜杠，方便与手写条目互操作 */
const toPosix = (p: string) => p.replace(/\\/g, "/");

function normPattern(pattern: string): string {
	let value = toPosix(stripPatternPrefix(pattern));
	if (value.startsWith("./")) value = value.slice(2);
	return value;
}

function baseName(filePath: string): string {
	return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

function displayNameFor(resourceType: ResourceType, filePath: string): string {
	const fileName = baseName(filePath);
	const parts = filePath.split(/[\\/]/).filter(Boolean);
	const parent = parts.length >= 2 ? parts[parts.length - 2] : "";
	if (resourceType === "extensions" && parent && parent !== "extensions") return `${parent}/${fileName}`;
	if (resourceType === "skills" && fileName === "SKILL.md") return parent;
	return fileName;
}

/** 左右对齐一行（自动截断） */
function padBetween(left: string, right: string, width: number): string {
	const gap = width - visibleWidth(left) - visibleWidth(right);
	if (gap >= 1) return left + " ".repeat(gap) + right;
	return truncateToWidth(`${left} ${right}`, width, "...");
}

/** descriptions.json：{ "npm:xxx": "自定义简介" }，下划线开头的键忽略（当注释用） */
function readDescriptionOverrides(): Record<string, string> {
	if (!OVERRIDES_FILE) return {};
	try {
		const parsed = JSON.parse(readFileSync(OVERRIDES_FILE, "utf8")) as Record<string, unknown>;
		const out: Record<string, string> = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (key.startsWith("_")) continue;
			if (typeof value === "string" && value.trim()) out[key] = value.trim();
		}
		return out;
	} catch {
		return {};
	}
}

/** 从插件的 package.json 读 name / version / description（自动，新装插件无需配置） */
function readPluginInfo(source: string, baseDir: string | undefined, overrides: Record<string, string>): PluginInfo {
	const info: PluginInfo = { source };
	if (baseDir) {
		try {
			const pkg = JSON.parse(readFileSync(join(baseDir, "package.json"), "utf8")) as Record<string, unknown>;
			if (typeof pkg.version === "string") info.version = pkg.version;
			if (typeof pkg.description === "string" && pkg.description.trim()) info.description = pkg.description.trim();
		} catch {
			// 没有 package.json 或格式不对：不影响开关功能
		}
	} else {
		info.note = "找不到安装目录";
	}
	info.rawDescription = info.description;
	if (overrides[source]) info.description = overrides[source];
	return info;
}
function buildGroups(resolved: ResolvedPaths, plugins: Map<string, PluginInfo>): Group[] {
	const bySource = new Map<string, Group>();
	const ensure = (source: string): Group => {
		let group = bySource.get(source);
		if (!group) {
			const info = plugins.get(source);
			group = {
				key: source,
				label: source,
				version: info?.version,
				description: info?.description,
				altDescription: info?.rawDescription,
				note: info?.note,
				items: new Map(),
			};
			bySource.set(source, group);
		}
		return group;
	};

	// 先按 settings.json 里配置的插件建组：即使一个资源都没解析出来也要显示，不能静默消失
	for (const source of plugins.keys()) ensure(source);

	for (const resourceType of RESOURCE_TYPES) {
		for (const resource of resolved[resourceType] ?? []) {
			const metadata = resource.metadata;
			if (SCOPE === "packages" && metadata.origin !== "package") continue;
			const group = ensure(metadata.source);
			const bucket = group.items.get(resourceType) ?? [];
			bucket.push({
				path: resource.path,
				enabled: resource.enabled,
				resourceType,
				displayName: displayNameFor(resourceType, resource.path),
				metadata,
			});
			group.items.set(resourceType, bucket);
		}
	}

	return [...bySource.values()].sort((a, b) => a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// 汉化
// ---------------------------------------------------------------------------

/**
 * 找可选的汉化组件（localize/patch.mjs）。优先级：
 *   1. 环境变量 PI_LOCALIZE_DIR
 *   2. 与本扩展同一个包里的 localize/（仓库 / git 安装布局）
 *   3. <pi 根目录>/localize（作者本机布局：D:\pi-agent\localize）
 * 找不到就返回 undefined，面板只是不显示汉化那一项，插件开关不受影响。
 */
function findLocalizeScript(): string | undefined {
	const candidates = [
		process.env.PI_LOCALIZE_DIR,
		join(EXT_DIR, "..", "localize"),
		join(EXT_DIR, "localize"),
		join(dirname(getAgentDir()), "localize"),
	];
	for (const dir of candidates) {
		if (!dir) continue;
		const script = join(dir, "patch.mjs");
		if (existsSync(script)) return script;
	}
	return undefined;
}

/** 读 localize 组件自己的版本号（localize/package.json） */
function readLocalizeVersion(script: string | undefined): string | undefined {
	if (!script) return undefined;
	try {
		const pkg = JSON.parse(readFileSync(join(dirname(script), "package.json"), "utf8")) as Record<string, unknown>;
		return typeof pkg.version === "string" ? pkg.version : undefined;
	} catch {
		return undefined;
	}
}

// ---------------------------------------------------------------------------
// 自动重跑汉化（auto-apply.json 的读写；真正的逻辑在 localize/plugin/auto-apply.mjs）
// ---------------------------------------------------------------------------

const autoApplyFile = (script: string) => join(dirname(script), "auto-apply.json");

function readAutoApplyState(script: string): AutoApplyState {
	try {
		return JSON.parse(readFileSync(autoApplyFile(script), "utf8")) as AutoApplyState;
	} catch {
		return {};
	}
}

/** 只改 enabled，其余字段（快速探测缓存、上次尝试）原样保留 */
function writeAutoApplyEnabled(script: string, enabled: boolean): void {
	let raw: Record<string, unknown> = {};
	try {
		raw = JSON.parse(readFileSync(autoApplyFile(script), "utf8")) as Record<string, unknown>;
	} catch {
		// 还没有状态文件：新建一份
	}
	raw.enabled = enabled;
	raw.lastAttempt = {
		at: new Date().toISOString(),
		result: enabled ? "enabled-by-panel" : "disabled-by-panel",
		detail: enabled ? "面板里开启" : "面板里关闭",
	};
	writeFileSync(autoApplyFile(script), `${JSON.stringify(raw, null, 2)}\n`, "utf8");
}

/**
 * 面板里手动关掉汉化 = 「我要英文」：顺手关掉自动重跑，
 * 否则下次启动 auto-apply 又把它打回来（见 patch.mjs --revert 的同一处理）。
 */
function disableAutoApply(script: string): void {
	try {
		const file = autoApplyFile(script);
		if (!existsSync(file)) return;
		const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
		if (raw.enabled !== true) return;
		raw.enabled = false;
		raw.lastAttempt = { at: new Date().toISOString(), result: "disabled-by-revert", detail: "面板里关掉了汉化界面" };
		writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
	} catch {
		// 状态文件读写失败不能影响汉化本身
	}
}

/** 手动汉化成功后清掉快速探测缓存，让下次启动重新体检一次并补记（不跑外部命令） */
function clearAutoApplyCache(script: string): void {
	try {
		const file = autoApplyFile(script);
		if (!existsSync(file)) return;
		const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
		raw.mainChunk = null;
		raw.sampleZh = null;
		writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
	} catch {
		// 缓存清不掉只是多跑一次体检，不影响功能
	}
}

/**
 * 与主词典一起管理的附加词典（存在才加）：
 *   - 主词典（不传 --dict）   = pi 自己的界面文案
 *   - zh-plugins.json        = 已装插件的斜杠命令 / 提示词模板说明
 */
function localizeDicts(dir: string): { label: string; file?: string }[] {
	const dicts: { label: string; file?: string }[] = [{ label: "界面" }];
	if (existsSync(join(dir, "zh-plugins.json"))) dicts.push({ label: "插件", file: join(dir, "zh-plugins.json") });
	return dicts;
}

function localizeArgs(script: string, action: string[], dict?: string): string[] {
	return dict ? [script, ...action, "--dict", dict] : [script, ...action];
}

/**
 * 跑一次 `patch.mjs --check`，从 last-report.json 判断当前是汉化还是英文原版。
 * report.applied = 还需要汉化的条数，report.already = 已经是中文的条数。
 */
async function readLocalizeInfo(
	script: string | undefined,
	exec: (cmd: string, args: string[], opts?: { timeout?: number }) => Promise<ExecResult>,
): Promise<LocalizeInfo> {
	if (!script) return { state: "missing", detail: "未找到 patch.mjs" };
	const withVersion = (info: LocalizeInfo): LocalizeInfo => ({ ...info, version: readLocalizeVersion(script) });
	try {
		let pending = 0;
		let done = 0;
		let missed = 0;
		let code = 0;
		let stderr = "";
		for (const dict of localizeDicts(dirname(script))) {
			const result = await exec(NODE_BIN, localizeArgs(script, ["--check"], dict.file), { timeout: 180000 });
			if (result.code !== 0) {
				code = result.code;
				stderr = result.stderr.trim();
			}
			let report: { applied?: unknown[]; already?: unknown[]; unmatched?: unknown[] };
			try {
				report = JSON.parse(readFileSync(join(dirname(script), "last-report.json"), "utf8")) as typeof report;
			} catch {
				continue;
			}
			pending += report.applied?.length ?? 0;
			done += report.already?.length ?? 0;
			missed += report.unmatched?.length ?? 0;
		}
		const suffix = missed > 0 ? `，${missed} 条失配` : "";
		if (code !== 0 && pending === 0 && done === 0) {
			return withVersion({ state: "unknown", detail: stderr.slice(0, 60) || "检测失败", script });
		}
		if (pending === 0 && done > 0) return withVersion({ state: "on", detail: `已汉化 ${done} 条${suffix}`, script });
		if (done === 0 && pending > 0)
			return withVersion({ state: "off", detail: `英文原版 · 可汉化 ${pending} 条${suffix}`, script });
		return withVersion({ state: "partial", detail: `已汉化 ${done} · 待汉化 ${pending}${suffix}`, script });
	} catch (error) {
		return withVersion({
			state: "unknown",
			detail: `检测失败：${error instanceof Error ? error.message : String(error)}`,
			script,
		});
	}
}

// ---------------------------------------------------------------------------
// 面板
// ---------------------------------------------------------------------------

interface Deps {
	settings: SettingsManager;
	exec: (cmd: string, args: string[], opts?: { timeout?: number }) => Promise<ExecResult>;
	resolvePackages: () => Promise<ResolvedPaths>;
	installedPath: (source: string) => string | undefined;
	localizeScript: string | undefined;
	localize: LocalizeInfo;
	/** pi 更新后自动重跑汉化（auto-apply.json） */
	autoApply: AutoApplyState;
	/** 当前解析出来的资源快照（r 刷新时会被替换） */
	resolved?: ResolvedPaths;
	/** 插件简介覆盖表（来自 descriptions.json） */
	overrides: Record<string, string>;
}

class PluginManagerPanel implements Component {
	private tui: TUI;
	private theme: Theme;
	private deps: Deps;
	private done: (dirty: boolean) => void;

	private groups: Group[] = [];
	private filtered: Row[] = [];
	private selected = 0;
	private query = "";
	private searching = false;
	private status = "";
	private statusKind: "info" | "on" | "off" | "error" = "info";
	private changed = 0;
	private busy = false;

	constructor(tui: TUI, theme: Theme, deps: Deps, done: (dirty: boolean) => void) {
		this.tui = tui;
		this.theme = theme;
		this.deps = deps;
		this.done = done;
		this.loadGroups();
	}

	private setStatus(text: string, kind: "info" | "on" | "off" | "error" = "info"): void {
		this.status = text;
		this.statusKind = kind;
	}

	private loadGroups(): void {
		const resolved = this.deps.resolved ?? { extensions: [], skills: [], prompts: [], themes: [] };

		// 先从已解析的资源里收集每个插件的安装目录：这是最可靠的来源
		// （getInstalledPath 对 Windows 绝对路径不一定能用）
		const baseDirs = new Map<string, string>();
		for (const resourceType of RESOURCE_TYPES) {
			for (const resource of resolved[resourceType] ?? []) {
				if (SCOPE === "packages" && resource.metadata.origin !== "package") continue;
				const dir = resource.metadata.baseDir ?? dirname(resource.path);
				if (dir && !baseDirs.has(resource.metadata.source)) baseDirs.set(resource.metadata.source, dir);
			}
		}

		const plugins = new Map<string, PluginInfo>();
		for (const entry of this.deps.settings.getGlobalSettings().packages ?? []) {
			const source = typeof entry === "string" ? entry : entry.source;
			if (typeof source !== "string") continue;
			const baseDir = baseDirs.get(source) ?? this.deps.installedPath(source);
			plugins.set(source, readPluginInfo(source, baseDir, this.deps.overrides));
		}
		// 兜底：settings 里没列但解析出来了的包
		for (const [source, dir] of baseDirs) {
			if (!plugins.has(source)) plugins.set(source, readPluginInfo(source, dir, this.deps.overrides));
		}

		this.groups = buildGroups(resolved, plugins);
		this.filterRows();
	}

	// -- 过滤 ----------------------------------------------------------------

	private matches(text: string, query: string): boolean {
		return !query || text.toLowerCase().includes(query);
	}

	private filterRows(): void {
		const query = this.query.trim().toLowerCase();
		const rows: Row[] = [];

		if (this.matches("界面 汉化 本地化 localization localize 中文 自动 auto auto-apply 重跑 更新 升级", query)) {
			rows.push({ kind: "header", label: "界面" });
			rows.push({ kind: "localize" });
			if (this.deps.localizeScript) rows.push({ kind: "autoApply" });
		}

		for (const group of this.groups) {
			// 插件名 / 版本 / 简介命中 => 整组保留（覆盖后的中文简介与原始英文描述都算）
			const groupHit =
				!query ||
				this.matches(`${group.label} ${group.version ?? ""} ${group.description ?? ""} ${group.altDescription ?? ""}`, query);
			const children: Row[] = [];
			const allItems: Item[] = [];
			for (const resourceType of RESOURCE_TYPES) {
				const items = (group.items.get(resourceType) ?? [])
					.filter((item) => groupHit || this.matches(`${item.displayName} ${item.path}`, query))
					.sort((a, b) => a.displayName.localeCompare(b.displayName));
				if (items.length === 0) continue;
				children.push({ kind: "header", label: `   ${TYPE_LABELS[resourceType]}`, items });
				for (const item of items) children.push({ kind: "item", item });
				allItems.push(...items);
			}
			if (children.length === 0 && !(query === "" || groupHit)) continue;
			rows.push({
				kind: "header",
				label: group.label,
				items: allItems,
				plugin: { version: group.version, description: group.description, note: group.note },
			});
			rows.push(...children);
		}

		this.filtered = rows;
		const first = this.filtered.findIndex((row) => row.kind !== "header");
		this.selected = first >= 0 ? first : 0;
	}

	private move(direction: 1 | -1): void {
		let index = this.selected + direction;
		while (index >= 0 && index < this.filtered.length) {
			if (this.filtered[index].kind !== "header") {
				this.selected = index;
				return;
			}
			index += direction;
		}
	}

	private currentRow(): Row | undefined {
		const row = this.filtered[this.selected];
		return row && row.kind !== "header" ? row : undefined;
	}

	// -- 开关：插件资源 --------------------------------------------------------

	private packagePattern(item: Item): string {
		const baseDir = item.metadata.baseDir ?? dirname(item.path);
		return normPattern(relative(baseDir, item.path));
	}

	private writeTopLevel(resourceType: ResourceType, patterns: string[]): void {
		const sm = this.deps.settings;
		if (resourceType === "extensions") sm.setExtensionPaths(patterns);
		else if (resourceType === "skills") sm.setSkillPaths(patterns);
		else if (resourceType === "prompts") sm.setPromptTemplatePaths(patterns);
		else sm.setThemePaths(patterns);
	}

	private togglePackageResource(item: Item, enabled: boolean): void {
		const packages = [...(this.deps.settings.getGlobalSettings().packages ?? [])] as Array<
			string | Record<string, unknown>
		>;
		const index = packages.findIndex(
			(p) => (typeof p === "string" ? p : (p.source as string)) === item.metadata.source,
		);
		if (index === -1) {
			this.setStatus(`settings.json 的 packages 里找不到 ${item.metadata.source}`, "error");
			return;
		}
		let pkg = packages[index];
		if (typeof pkg === "string") {
			pkg = { source: pkg };
			packages[index] = pkg;
		}
		const pattern = this.packagePattern(item);
		const current = (pkg[item.resourceType] as string[] | undefined) ?? [];
		const updated = current.filter((entry) => normPattern(entry) !== pattern);
		updated.push(`${enabled ? "+" : "-"}${pattern}`);
		pkg[item.resourceType] = updated.length > 0 ? updated : undefined;
		// 该插件的过滤规则被清空后，收回成最简的字符串写法
		if (!RESOURCE_TYPES.some((type) => pkg[type] !== undefined)) packages[index] = pkg.source as string;
		this.deps.settings.setPackages(packages as never);
		item.enabled = enabled;
	}

	/** SCOPE === "all" 时用于开关自动发现的本地资源 */
	private toggleTopLevelResource(item: Item, enabled: boolean): void {
		const current = (this.deps.settings.getGlobalSettings()[item.resourceType] ?? []) as string[];
		const baseDir = item.metadata.baseDir ?? getAgentDir();
		const pattern = normPattern(relative(baseDir, item.path));
		const updated = current.filter((entry) => normPattern(entry) !== pattern);
		updated.push(`${enabled ? "+" : "-"}${pattern}`);
		this.writeTopLevel(item.resourceType, updated);
		item.enabled = enabled;
	}

	// -- 开关：汉化 ------------------------------------------------------------

	private async toggleLocalize(): Promise<void> {
		if (this.busy) return;
		const info = this.deps.localize;
		if (info.state === "missing") {
			this.setStatus("未找到 localize/patch.mjs，无法切换汉化", "error");
			return;
		}
		const script = info.script ?? this.deps.localizeScript;
		if (!script) {
			this.setStatus("未找到 localize/patch.mjs，无法切换汉化", "error");
			return;
		}

		const enable = info.state !== "on";
		this.busy = true;
		this.setStatus(enable ? "正在应用汉化补丁…" : "正在还原英文原版…");
		this.tui.requestRender();
		try {
			const dicts = localizeDicts(dirname(script));
			let code = 0;
			let output = "";
			for (const [index, dict] of dicts.entries()) {
				// 只对主词典跑 --verify（会启动一次 CLI 自检），插件词典跳过以省时间
				const action = enable ? (index === 0 ? ["--apply", "--verify"] : ["--apply"]) : ["--revert"];
				const result = await this.deps.exec(NODE_BIN, localizeArgs(script, action, dict.file), { timeout: 300000 });
				if (result.code !== 0 && code === 0) {
					code = result.code;
					output = `${dict.label}词典：${(result.stderr || result.stdout).trim()}`;
				}
			}
			const next = await readLocalizeInfo(script, this.deps.exec);
			this.deps.localize = next;
			// 手动关掉汉化 = 「我要英文」：顺手关掉自动重跑，否则下次启动又被打回来
			if (!enable) {
				disableAutoApply(script);
				this.deps.autoApply = { ...(this.deps.autoApply ?? {}), enabled: false };
			} else if (code === 0 && next.state === "on") {
				// 手动汉化成功：清掉快速探测缓存，下次启动重新体检并补记
				clearAutoApplyCache(script);
			}
			if (code !== 0) {
				this.setStatus(`汉化脚本退出码 ${code}：${output.slice(0, 80)}`, "error");
			} else if (next.state === (enable ? "on" : "off")) {
				this.changed++;
				this.setStatus(`汉化已${enable ? "应用" : "还原"}，重启 pi 后生效`, enable ? "on" : "off");
			} else {
				this.setStatus(`脚本已执行，但状态仍为：${next.detail}`, "error");
			}
		} catch (error) {
			this.setStatus(`汉化脚本执行失败：${error instanceof Error ? error.message : String(error)}`, "error");
		} finally {
			this.busy = false;
			this.tui.requestRender();
		}
	}

	// -- 交互 ------------------------------------------------------------------

	private toggleCurrent(): void {
		const row = this.currentRow();
		if (!row) return;
		if (row.kind === "localize") {
			void this.toggleLocalize();
			return;
		}
		if (row.kind === "autoApply") {
			this.toggleAutoApply();
			return;
		}
		const item = row.item;
		const enabled = !item.enabled;
		if (item.metadata.origin === "package") this.togglePackageResource(item, enabled);
		else this.toggleTopLevelResource(item, enabled);
		this.changed++;
		this.setStatus(`${item.displayName}：${enabled ? "已启用" : "已关闭"}`, enabled ? "on" : "off");
	}

	/** 切换「pi 更新后自动重跑汉化」。不动 changed：这与 settings.json 无关，关闭面板不需要 reload */
	private toggleAutoApply(): void {
		const script = this.deps.localizeScript;
		if (!script) {
			this.setStatus("未找到 localize/patch.mjs，无法设置自动重跑", "error");
			return;
		}
		const enabled = this.deps.autoApply?.enabled !== true;
		try {
			writeAutoApplyEnabled(script, enabled);
			this.deps.autoApply = { ...(this.deps.autoApply ?? {}), enabled };
			this.setStatus(
				enabled
					? "已开启：pi 更新后会自动重跑汉化（下次启动生效；掉线会自动还原并通知你）"
					: "已关闭：pi 更新后不再自动重跑汉化",
				enabled ? "on" : "off",
			);
		} catch (error) {
			this.setStatus(`写入 auto-apply.json 失败：${error instanceof Error ? error.message : String(error)}`, "error");
		}
	}

	/** r：重新读 settings.json、重新解析资源、重新读简介、重新检测汉化状态 */
	private async refresh(): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		const previous = this.currentRow();
		const previousKey =
			previous?.kind === "item" ? previous.item.path : previous?.kind === "localize" ? "localize" : undefined;
		this.setStatus("重新扫描…");
		this.tui.requestRender();
		try {
			await this.deps.settings.reload();
			this.deps.resolved = await this.deps.resolvePackages();
			this.deps.overrides = readDescriptionOverrides();
			this.deps.localize = await readLocalizeInfo(this.deps.localizeScript, this.deps.exec);
			if (this.deps.localizeScript) this.deps.autoApply = readAutoApplyState(this.deps.localizeScript);
			this.loadGroups();
			if (previousKey) {
				const index = this.filtered.findIndex((row) =>
					row.kind === "localize"
						? previousKey === "localize"
						: row.kind === "item" && row.item.path === previousKey,
				);
				if (index >= 0) this.selected = index;
			}
			this.setStatus("已重新扫描");
		} catch (error) {
			this.setStatus(`重新扫描失败：${error instanceof Error ? error.message : String(error)}`, "error");
		} finally {
			this.busy = false;
			this.tui.requestRender();
		}
	}

	// -- 渲染 ------------------------------------------------------------------

	private localizeCheckbox(): string {
		const t = this.theme;
		switch (this.deps.localize.state) {
			case "on":
				return t.fg("success", t.bold("[x]"));
			case "off":
				return t.fg("dim", "[ ]");
			case "partial":
				return t.fg("warning", t.bold("[~]"));
			default:
				return t.fg("error", "[?]");
		}
	}

	private itemLine(item: Item, isSelected: boolean, width: number): string {
		const t = this.theme;
		const box = item.enabled ? t.fg("success", t.bold("[x]")) : t.fg("dim", "[ ]");
		const cursor = isSelected ? t.fg("accent", "> ") : "  ";
		const prefix = `${cursor}    ${box} `;
		const tag = item.enabled ? "启用" : "关闭";
		const room = Math.max(4, width - visibleWidth(prefix) - visibleWidth(tag) - 2);
		let name = truncateToWidth(item.displayName, room, "...");
		name = t.fg(item.enabled ? "text" : "dim", name);
		if (isSelected) name = t.bold(name);
		return padBetween(`${prefix}${name}`, `${t.fg(item.enabled ? "success" : "dim", tag)}  `, width);
	}

	private localizeLine(isSelected: boolean, width: number): string {
		const t = this.theme;
		const info = this.deps.localize;
		const on = info.state === "on";
		const cursor = isSelected ? t.fg("accent", "> ") : "  ";
		const prefix = `${cursor}    ${this.localizeCheckbox()} `;
		const tag =
			info.state === "on" ? "已汉化" : info.state === "off" ? "英文" : info.state === "partial" ? "部分" : "未知";
		const tagColor =
			info.state === "on" ? "success" : info.state === "off" ? "dim" : info.state === "partial" ? "warning" : "error";
		const room = Math.max(8, width - visibleWidth(prefix) - visibleWidth(tag) - visibleWidth(info.detail) - 4);
		const label = `汉化界面${info.version ? ` v${info.version}` : ""}（重启 pi 生效）`;
		let name = truncateToWidth(label, room, "...");
		name = t.fg(on ? "text" : "dim", name);
		if (isSelected) name = t.bold(name);
		const detail = t.fg("dim", ` ${info.detail}`);
		return padBetween(`${prefix}${name}${detail}`, `${t.fg(tagColor, tag)}  `, width);
	}

	private autoApplyLine(isSelected: boolean, width: number): string {
		const t = this.theme;
		const state = this.deps.autoApply ?? {};
		const enabled = state.enabled === true;
		const cursor = isSelected ? t.fg("accent", "> ") : "  ";
		const box = enabled ? t.fg("success", t.bold("[x]")) : t.fg("dim", "[ ]");
		const prefix = `${cursor}    ${box} `;
		const tag = enabled ? "开启" : "关闭";
		const detailText = enabled
			? ` 上次汉化 pi ${state.appliedPiVersion ?? "未记录"}`
			: " 默认关闭";
		const room = Math.max(8, width - visibleWidth(prefix) - visibleWidth(tag) - visibleWidth(detailText) - 4);
		let name = truncateToWidth("pi 更新后自动重跑汉化", room, "...");
		name = t.fg(enabled ? "text" : "dim", name);
		if (isSelected) name = t.bold(name);
		return padBetween(
			`${prefix}${name}${t.fg("dim", detailText)}`,
			`${t.fg(enabled ? "success" : "dim", tag)}  `,
			width,
		);
	}

	private headerLines(
		row: { label: string; items?: Item[]; plugin?: { version?: string; description?: string; note?: string } },
		width: number,
	): string[] {
		const t = this.theme;

		// 资源类型表头：带启用计数
		if (row.items && !row.plugin) {
			const label = `  ${t.fg("muted", t.bold(row.label))}`;
			const on = row.items.filter((item) => item.enabled).length;
			const total = row.items.length;
			const color = on === total ? "success" : on === 0 ? "dim" : "muted";
			return [padBetween(label, `${t.fg(color, `启用 ${on}/${total}`)}  `, width)];
		}

		// 插件表头：名称 + 版本 + 小括号简介 + 计数
		if (row.plugin) {
			const info = row.plugin;
			const items = row.items ?? [];
			const on = items.filter((item) => item.enabled).length;
			const total = items.length;
			const countColor = total === 0 ? "error" : on === total ? "success" : on === 0 ? "dim" : "muted";
			const countText = `${t.fg(countColor, total === 0 ? "无资源" : `启用 ${on}/${total}`)}  `;

			const head =
				`  ${t.fg("accent", t.bold(row.label))}${info.version ? t.fg("dim", ` ${info.version}`) : ""}`;
			const base = padBetween(head, countText, width);

			const text = info.description ?? (total === 0 ? (info.note ?? "未解析出资源，插件可能没装好") : undefined);
			if (!text) return [base];

			const color = info.description ? "muted" : "warning";
			const inline = `(${text})`;
			const headWidth = visibleWidth(`  ${row.label}${info.version ? ` ${info.version}` : ""}`);
			const room = width - headWidth - visibleWidth(countText) - 3;

			// 放得下就内联在插件名后面；放不下（或太窄没意义）就换到下一行整行显示
			if (room >= 24 && visibleWidth(inline) <= room) {
				return [padBetween(`${head} ${t.fg(color, inline)}`, countText, width)];
			}
			return [base, `    ${t.fg(color, truncateToWidth(inline, Math.max(8, width - 4), "..."))}`];
		}

		// 普通小标题（界面）
		return [truncateToWidth(`  ${t.fg("muted", t.bold(row.label))}`, width, "...")];
	}

	render(width: number): string[] {
		const t = this.theme;
		const border = (s: string) => t.fg("border", s);
		const visible = Math.max(5, (this.tui.terminal?.rows ?? 24) - 9);
		const lines: string[] = [];
		const inner = Math.max(1, width);

		const allItems = this.filtered.filter((row) => row.kind === "item").map((row) => row.item);
		const totalOn = allItems.filter((item) => item.enabled).length;

		lines.push(border("─".repeat(inner)));

		const title = `  ${t.fg("accent", t.bold("Plugin Manager"))}${t.fg("dim", ` v${VERSION}`)}`;
		const summary =
			t.fg("success", `启用 ${totalOn}`) + t.fg("dim", " · ") + t.fg("dim", `关闭 ${allItems.length - totalOn}`) + "  ";
		lines.push(padBetween(title, summary, inner));

		const searchPrefix = this.searching ? t.fg("accent", "搜索 ") : t.fg("dim", "搜索 ");
		const queryText = this.query
			? t.fg("text", this.query)
			: t.fg("dim", this.searching ? "(输入以过滤)" : "按 / 过滤");
		const pending = this.changed > 0 ? t.fg("warning", `待生效 ${this.changed} 项 · esc 应用  `) : "";
		lines.push(padBetween(`  ${searchPrefix}${queryText}${this.searching ? "▏" : ""}`, pending, inner));

		lines.push("");

		// 先渲染全部行（数量很小），再按“行”而不是“条目数”开窗：
		// 插件表头可能带第二行简介，按条目数开窗会顶破终端高度。
		const allLines: string[] = [];
		const lineRowIndex: number[] = [];
		for (let i = 0; i < this.filtered.length; i++) {
			const row = this.filtered[i];
			if (!row) continue;
			const rendered =
				row.kind === "header"
					? this.headerLines(row, width)
					: row.kind === "localize"
						? [this.localizeLine(i === this.selected, width)]
						: row.kind === "autoApply"
							? [this.autoApplyLine(i === this.selected, width)]
							: [this.itemLine(row.item, i === this.selected, width)];
			for (const line of rendered) {
				allLines.push(line);
				lineRowIndex.push(i);
			}
		}

		if (allLines.length === 0) {
			lines.push(`  ${t.fg("muted", "没有匹配的资源")}`);
		} else {
			const selectedLine = lineRowIndex.indexOf(this.selected);
			const half = Math.floor(visible / 2);
			const start = Math.max(0, Math.min(selectedLine - half, allLines.length - visible));
			const end = Math.min(start + visible, allLines.length);
			lines.push(...allLines.slice(start, end));
			if (allLines.length > visible) {
				const count = this.filtered.filter((r) => r.kind !== "header").length;
				const index = this.filtered.slice(0, this.selected).filter((r) => r.kind !== "header").length + 1;
				lines.push(t.fg("dim", `  (${index}/${count})`));
			}
		}

		lines.push("");
		if (this.status) {
			const color =
				this.statusKind === "on"
					? "success"
					: this.statusKind === "off"
						? "warning"
						: this.statusKind === "error"
							? "error"
							: "muted";
			lines.push(truncateToWidth(`  ${t.fg(color, this.status)}`, width, "..."));
		}
		lines.push(
			truncateToWidth(
				`  ${t.fg("dim", "↑↓ 移动 · space 切换（可连续多个）· / 搜索 · r 刷新 · esc 关闭并生效")}`,
				width,
				"",
			),
		);
		lines.push(border("─".repeat(inner)));
		return lines;
	}

	invalidate(): void {
		// 每次 render 都实时计算，无需清理缓存
	}

	handleInput(data: string): void {
		if (this.searching) {
			if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) this.searching = false;
			else if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
				this.query = this.query.slice(0, -1);
				this.filterRows();
			} else if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) !== 127) {
				this.query += data;
				this.filterRows();
			}
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || matchesKey(data, Key.ctrl("c"))) {
			this.done(this.changed > 0);
			return;
		}
		if (matchesKey(data, Key.up)) this.move(-1);
		else if (matchesKey(data, Key.down)) this.move(1);
		else if (matchesKey(data, Key.pageUp)) for (let i = 0; i < 8; i++) this.move(-1);
		else if (matchesKey(data, Key.pageDown)) for (let i = 0; i < 8; i++) this.move(1);
		else if (matchesKey(data, Key.space)) this.toggleCurrent();
		else if (data === "r" || data === "R") {
			void this.refresh();
			return;
		} else if (data === "/") {
			this.searching = true;
			this.setStatus("");
		}
		this.tui.requestRender();
	}
}

// ---------------------------------------------------------------------------
// 自动重跑（把逻辑交给 auto-apply.mjs，面板只负责触发 + 把结果告诉你）
// ---------------------------------------------------------------------------

/**
 * 跑一次 auto-apply.mjs，按它的 action / 退出码决定要不要打扰你：
 *   applied          成功了 → info（有失配就 warning）
 *   failed-reverted  自检没过、已自动还原英文 → error
 *   skip / noop      没动手 → 静默
 */
async function runAutoApply(runner: string, ctx: ExtensionContext, pi: ExtensionAPI): Promise<void> {
	try {
		const result = await pi.exec(NODE_BIN, [runner, "--json"], { timeout: 900000 });
		const lastLine =
			(result.stdout ?? "")
				.trim()
				.split("\n")
				.filter(Boolean)
				.pop() ?? "";
		let payload: {
			action?: string;
			reason?: string;
			stats?: { applied?: number; already?: number; unmatched?: number; errors?: number };
		} = {};
		try {
			payload = JSON.parse(lastLine) as typeof payload;
		} catch {
			// 拿不到结构化结果就只看退出码
		}
		const code = result.code ?? 0;
		const s = payload.stats;
		const line = s
			? `主词典：已汉化 ${s.applied ?? 0} · 已是中文 ${s.already ?? 0} · 失配 ${s.unmatched ?? 0} · 错误 ${s.errors ?? 0}`
			: (payload.reason ?? "");

		if (payload.action === "applied") {
			const warn = code === 3;
			ctx.ui.notify(
				[
					"pi 升级后已自动重跑汉化（重启 pi 后生效）",
					`  ${line}`,
					...(warn ? ["  有词条失配或被拦下：node patch.mjs --check 看是哪几条（失配的保持英文）"] : []),
				].join("\n"),
				warn ? "warning" : "info",
			);
			return;
		}
		if (payload.action === "failed-reverted") {
			ctx.ui.notify(
				[
					"pi 升级后重跑汉化失败，已自动还原为英文原版（pi 仍能正常启动）",
					`  ${line}`,
					"  想看原因：node patch.mjs --check",
				].join("\n"),
				"error",
			);
			return;
		}
		if (payload.action === "skip" || payload.action === "noop") return; // 没事就不打扰
		if (code !== 0 && code !== 4) {
			const why = (result.stderr || result.stdout || "").trim().split("\n").slice(-2).join(" ").slice(0, 200);
			ctx.ui.notify(`自动重跑汉化出错（exit ${code}）：${why}`, "warning");
		}
	} catch (error) {
		ctx.ui.notify(`自动重跑汉化失败：${error instanceof Error ? error.message : String(error)}`, "warning");
	}
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export default function pluginManagerExtension(pi: ExtensionAPI) {
	/**
	 * pi 启动时按需重跑汉化 —— 只有在面板里显式开启过才会做（默认关闭）。
	 * 不 await：汉化重跑要几秒，不能让 pi 启动干等；结果回来了再通知。
	 */
	pi.on("session_start", (event: { reason?: string }, ctx: ExtensionContext) => {
		if (event?.reason !== "startup") return; // /new、/reload、fork 不重复跑
		if (ctx.mode !== "tui" && ctx.mode !== "rpc") return; // 非交互模式（-p / json）不折腾
		const script = findLocalizeScript();
		if (!script) return;
		if (readAutoApplyState(script).enabled !== true) return; // 一次小文件读就结束
		const runner = join(dirname(script), "plugin", "auto-apply.mjs");
		if (!existsSync(runner)) return;
		void runAutoApply(runner, ctx, pi);
	});

	pi.registerCommand("plugin-manager", {
		description: `开关已安装插件（extensions/skills/prompts/themes）与界面汉化 · v${VERSION}`,
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/plugin-manager 需要 TUI 交互模式", "error");
				return;
			}

			const cwd = ctx.cwd;
			const agentDir = getAgentDir();
			const exec = (command: string, args: string[], options?: { timeout?: number }) =>
				pi.exec(command, args, options);

			// 只管全局安装的插件（pi install 默认写全局）
			const settings = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
			const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager: settings });

			const deps: Deps = {
				settings,
				exec,
				resolvePackages: async () => await manager.resolve(),
				installedPath: (source: string) => manager.getInstalledPath(source, "user"),
				localizeScript: findLocalizeScript(),
				localize: { state: "unknown", detail: "检测中…" },
				autoApply: {},
				overrides: readDescriptionOverrides(),
				resolved: undefined,
			};
			deps.localize.script = deps.localizeScript;
			if (deps.localizeScript) deps.autoApply = readAutoApplyState(deps.localizeScript);

			ctx.ui.setStatus("plugin-manager", "正在扫描插件…");
			try {
				deps.resolved = await deps.resolvePackages();
				deps.localize = await readLocalizeInfo(deps.localizeScript, exec);
			} catch (error) {
				ctx.ui.setStatus("plugin-manager", undefined);
				ctx.ui.notify(`扫描失败：${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}
			ctx.ui.setStatus("plugin-manager", undefined);

			const changed = await ctx.ui.custom<boolean>((tui, theme, _keybindings, done) =>
				new PluginManagerPanel(tui, theme, deps, done),
			);

			if (!changed) return;

			await settings.flush();

			try {
				await ctx.reload();
			} catch (error) {
				ctx.ui.notify(
					`已写入 settings.json，但 reload 失败：${error instanceof Error ? error.message : String(error)}`,
					"warning",
				);
			}
		},
	});
}
