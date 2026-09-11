import { File, Paths } from "expo-file-system";
import { extractionFrom, type Visit } from "./installed-base";

export type StoreRead =
	| { kind: "ok"; visits: Visit[] }
	| { kind: "absent" }
	| { kind: "quarantined" };

const visitFrom = (value: unknown): Visit | null => {
	if (typeof value !== "object" || value === null) return null;
	const { id, at, said, extraction } = value as Record<string, unknown>;
	if (
		typeof id !== "string" ||
		typeof said !== "string" ||
		typeof at !== "number" ||
		!Number.isFinite(at)
	)
		return null;
	return { id, at, said, extraction: extractionFrom(extraction) };
};

export const parseVisits = (
	text: string,
): { visits: Visit[]; dropped: number } | null => {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (!Array.isArray(raw)) return null;
	const visits = raw
		.map(visitFrom)
		.filter((visit): visit is Visit => visit !== null);
	return { visits, dropped: raw.length - visits.length };
};

export const openStore = (name: string) => {
	const file = () => new File(Paths.document, `${name}.json`);
	const temp = () => new File(Paths.document, `${name}.tmp.json`);
	const aside = (label: string) =>
		new File(Paths.document, `${name}.${label}-${Date.now()}.json`);

	const discardTemp = () => {
		try {
			const stale = temp();
			if (stale.exists) stale.delete();
		} catch {}
	};

	const quarantine = () => {
		try {
			file().moveSync(aside("corrupt"));
		} catch {}
	};

	// The next save rewrites the file without the dropped entries, so the original text stays beside it.
	const keepOriginal = (text: string) => {
		try {
			const copy = aside("salvaged");
			copy.create();
			copy.write(text);
		} catch {}
	};

	return {
		load: (): StoreRead => {
			discardTemp();
			let text: string;
			try {
				const current = file();
				if (!current.exists) return { kind: "absent" };
				text = current.textSync();
			} catch {
				quarantine();
				return { kind: "quarantined" };
			}
			const parsed = parseVisits(text);
			if (!parsed) {
				quarantine();
				return { kind: "quarantined" };
			}
			if (parsed.dropped > 0) keepOriginal(text);
			return { kind: "ok", visits: parsed.visits };
		},
		save: (visits: readonly Visit[]) => {
			const next = temp();
			if (next.exists) next.delete();
			next.create();
			next.write(JSON.stringify(visits));
			next.moveSync(file(), { overwrite: true });
		},
	};
};
