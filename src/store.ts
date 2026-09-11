import { File, Paths } from "expo-file-system";
import { isRecord, type LooseRecord } from "./sheet";

export type RecordsRead =
	| { kind: "ok"; records: LooseRecord[] }
	| { kind: "absent" }
	| { kind: "quarantined" };

const recordFrom = (value: unknown): LooseRecord | null => {
	if (!isRecord(value)) return null;
	const { id, at, source, extraction, unverified } = value;
	if (
		typeof id !== "string" ||
		typeof source !== "string" ||
		typeof at !== "number" ||
		!Number.isFinite(at)
	)
		return null;
	return {
		id,
		at,
		source,
		extraction: extraction ?? null,
		unverified: Array.isArray(unverified)
			? unverified.filter((path): path is string => typeof path === "string")
			: [],
	};
};

export const parseRecords = (
	text: string,
): { records: LooseRecord[]; dropped: number } | null => {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (!Array.isArray(raw)) return null;
	const records = raw
		.map(recordFrom)
		.filter((found): found is LooseRecord => found !== null);
	return { records, dropped: raw.length - records.length };
};

const documentFile = (name: string) => new File(Paths.document, name);

const replaceFile = (name: string, text: string) => {
	const next = documentFile(`${name}.tmp`);
	if (next.exists) next.delete();
	next.create();
	next.write(text);
	next.moveSync(documentFile(name), { overwrite: true });
};

export const openRecordStore = (base: string) => {
	const name = `${base}.json`;
	const aside = (label: string) =>
		documentFile(`${base}.${label}-${Date.now()}.json`);

	const quarantine = () => {
		try {
			documentFile(name).moveSync(aside("corrupt"));
		} catch {}
	};

	// The next save rewrites the file without the dropped records, so the original text stays beside it.
	const keepOriginal = (text: string) => {
		try {
			const copy = aside("salvaged");
			copy.create();
			copy.write(text);
		} catch {}
	};

	return {
		load: (): RecordsRead => {
			try {
				const stale = documentFile(`${name}.tmp`);
				if (stale.exists) stale.delete();
			} catch {}
			let text: string;
			try {
				const file = documentFile(name);
				if (!file.exists) return { kind: "absent" };
				text = file.textSync();
			} catch {
				quarantine();
				return { kind: "quarantined" };
			}
			const parsed = parseRecords(text);
			if (!parsed) {
				quarantine();
				return { kind: "quarantined" };
			}
			if (parsed.dropped > 0) keepOriginal(text);
			return { kind: "ok", records: parsed.records };
		},
		save: (records: readonly LooseRecord[]) =>
			replaceFile(name, JSON.stringify(records)),
	};
};

export const openTextStore = (base: string) => {
	const name = `${base}.txt`;
	return {
		load: (): string => {
			try {
				const file = documentFile(name);
				return file.exists ? file.textSync() : "";
			} catch {
				return "";
			}
		},
		save: (text: string) => {
			try {
				replaceFile(name, text);
			} catch {}
		},
	};
};
