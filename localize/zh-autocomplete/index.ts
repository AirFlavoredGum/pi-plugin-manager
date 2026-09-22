/**
 * zh-autocomplete — 把「斜杠命令补全里的说明」显示成中文
 *
 * 只影响 TUI 显示层：包装官方补全 provider，把补全列表里命中的 description 换成中文。
 * **不修改任何插件文件，也不改动发给模型的文本**（技能/工具的 description 原样保留）。
 *
 * 词典：同目录 dict.json（英文原文 → 中文），由
 *   <localize>\plugin\build-autocomplete-dict.mjs 生成（路径可用 PI_ZH_AUTOCOMPLETE_DIR 覆盖）。
 * 词典缺失或损坏 → 本扩展自动什么都不做（补全保持英文）。
 *
 * 想临时关掉：把本目录改名（例如 index.ts.disabled），或 /reload 前删掉。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const HERE = dirname(fileURLToPath(import.meta.url));
const DICT_FILE = join(HERE, "dict.json");

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

let cache: Map<string, string> | null = null;

function dict(): Map<string, string> {
	if (cache) return cache;
	const map = new Map<string, string>();
	try {
		if (existsSync(DICT_FILE)) {
			const raw = JSON.parse(readFileSync(DICT_FILE, "utf8")) as Record<string, unknown>;
			for (const [en, zh] of Object.entries(raw)) {
				if (en.startsWith("_") || typeof zh !== "string") continue;
				map.set(norm(en), zh);
			}
		}
	} catch {
		// 词典坏了：不干预
	}
	cache = map;
	return map;
}

/** 命中就返回中文，否则 undefined（保持英文）。支持 `[来源] xxx` 前缀。 */
function translate(description?: string): string | undefined {
	if (!description) return undefined;
	const map = dict();
	if (map.size === 0) return undefined;
	const direct = map.get(norm(description));
	if (direct) return direct;
	const prefixed = /^(\[[^\]]+\]\s*)([\s\S]+)$/.exec(description);
	if (prefixed) {
		const zh = map.get(norm(prefixed[2]));
		if (zh) return prefixed[1] + zh;
	}
	return undefined;
}

export default function zhAutocomplete(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		try {
			const ui = ctx?.ui as unknown as { addAutocompleteProvider?: (f: unknown) => void } | undefined;
			if (!ui || typeof ui.addAutocompleteProvider !== "function") return;
			if (dict().size === 0) return;

			ui.addAutocompleteProvider((current: any) => ({
				triggerCharacters: current?.triggerCharacters,
				async getSuggestions(...args: unknown[]) {
					const result = await current.getSuggestions(...args);
					try {
						if (!result || !Array.isArray(result.items)) return result;
						return {
							...result,
							items: result.items.map((item: any) => {
								const zh = translate(item?.description);
								return zh ? { ...item, description: zh } : item;
							}),
						};
					} catch {
						return result;
					}
				},
				applyCompletion(...args: unknown[]) {
					return (current.applyCompletion as (...a: unknown[]) => unknown)(...args);
				},
				shouldTriggerFileCompletion: current?.shouldTriggerFileCompletion
					? (...args: unknown[]) => (current.shouldTriggerFileCompletion as (...a: unknown[]) => boolean)(...args)
					: undefined,
			}));
		} catch {
			// 任何异常都不影响补全
		}
	});
}
