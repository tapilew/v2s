import { File, Paths } from "expo-file-system";
import {
	type Consultation,
	type NoteEdit,
	type NoteStatus,
	noteFrom,
	type Physician,
} from "./clinical-note";

export type StoreRead =
	| { kind: "ok"; consultations: Consultation[] }
	| { kind: "absent" }
	| { kind: "quarantined" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const filled = (value: unknown) =>
	typeof value === "string" && value.trim() !== "" ? value.trim() : null;

export const physicianFrom = (value: unknown): Physician | null => {
	if (!isRecord(value)) return null;
	const name = filled(value.name);
	const license = filled(value.license);
	return name && license ? { name, license } : null;
};

// A damaged signature reopens the note as a draft: a second review is safe, a note wrongly shown as signed is not.
const statusFrom = (value: unknown): NoteStatus => {
	if (!isRecord(value) || value.kind !== "signed" || !isNumber(value.at))
		return { kind: "draft" };
	const physician = physicianFrom(value.physician);
	return physician
		? { kind: "signed", at: value.at, physician }
		: { kind: "draft" };
};

const editFrom = (value: unknown): NoteEdit | null => {
	if (!isRecord(value) || !isNumber(value.at) || typeof value.path !== "string")
		return null;
	const text = (field: unknown) => (typeof field === "string" ? field : null);
	return {
		at: value.at,
		path: value.path,
		before: text(value.before),
		after: text(value.after),
		afterSigning: value.afterSigning === true,
	};
};

const consultationFrom = (value: unknown): Consultation | null => {
	if (!isRecord(value)) return null;
	const { id, at, transcript, edits, unverified } = value;
	if (typeof id !== "string" || typeof transcript !== "string" || !isNumber(at))
		return null;
	return {
		id,
		at,
		transcript,
		note: noteFrom(value.note),
		status: statusFrom(value.status),
		edits: Array.isArray(edits)
			? edits.flatMap((raw) => {
					const edit = editFrom(raw);
					return edit ? [edit] : [];
				})
			: [],
		unverified: Array.isArray(unverified)
			? unverified.filter((flag): flag is string => typeof flag === "string")
			: [],
	};
};

export const parseConsultations = (
	text: string,
): { consultations: Consultation[]; dropped: number } | null => {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (!Array.isArray(raw)) return null;
	const consultations = raw
		.map(consultationFrom)
		.filter((found): found is Consultation => found !== null);
	return { consultations, dropped: raw.length - consultations.length };
};

const documentFile = (name: string) => new File(Paths.document, `${name}.json`);

const replaceFile = (name: string, text: string) => {
	const next = new File(Paths.document, `${name}.tmp.json`);
	if (next.exists) next.delete();
	next.create();
	next.write(text);
	next.moveSync(documentFile(name), { overwrite: true });
};

export const openStore = (name: string) => {
	const aside = (label: string) =>
		new File(Paths.document, `${name}.${label}-${Date.now()}.json`);

	const discardTemp = () => {
		try {
			const stale = new File(Paths.document, `${name}.tmp.json`);
			if (stale.exists) stale.delete();
		} catch {}
	};

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
		load: (): StoreRead => {
			discardTemp();
			let text: string;
			try {
				const current = documentFile(name);
				if (!current.exists) return { kind: "absent" };
				text = current.textSync();
			} catch {
				quarantine();
				return { kind: "quarantined" };
			}
			const parsed = parseConsultations(text);
			if (!parsed) {
				quarantine();
				return { kind: "quarantined" };
			}
			if (parsed.dropped > 0) keepOriginal(text);
			return { kind: "ok", consultations: parsed.consultations };
		},
		save: (consultations: readonly Consultation[]) =>
			replaceFile(name, JSON.stringify(consultations)),
	};
};

export const openPhysicianProfile = (name: string) => ({
	load: (): Physician | null => {
		try {
			const file = documentFile(name);
			return file.exists ? physicianFrom(JSON.parse(file.textSync())) : null;
		} catch {
			return null;
		}
	},
	save: (physician: Physician) => replaceFile(name, JSON.stringify(physician)),
});
