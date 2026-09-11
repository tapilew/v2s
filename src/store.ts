import { File, Paths } from "expo-file-system";
import { type Library, parseLibrary } from "./spreadsheet";

export type LibraryRead =
	| { kind: "ok"; library: Library }
	| { kind: "absent" }
	| { kind: "quarantined" };

const documentFile = (name: string) => new File(Paths.document, name);

const replaceFile = (name: string, text: string) => {
	const next = documentFile(`${name}.tmp`);
	if (next.exists) next.delete();
	next.create();
	next.write(text);
	next.moveSync(documentFile(name), { overwrite: true });
};

export const openLibraryStore = (base: string) => {
	const name = `${base}.json`;
	const aside = (label: string) =>
		documentFile(`${base}.${label}-${Date.now()}.json`);

	const quarantine = () => {
		try {
			documentFile(name).moveSync(aside("corrupt"));
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
		load: (): LibraryRead => {
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
			const parsed = parseLibrary(text);
			if (!parsed) {
				quarantine();
				return { kind: "quarantined" };
			}
			if (parsed.dropped > 0) keepOriginal(text);
			return { kind: "ok", library: parsed.library };
		},
		save: (library: Library) => replaceFile(name, JSON.stringify(library)),
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
