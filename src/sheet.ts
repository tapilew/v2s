import type { ModelSpec } from "./models";

export type ModeId = "finanzas" | "salud";

export const MODE_IDS: readonly ModeId[] = ["finanzas", "salud"];

export type Cell = string | number | null;

export type Cells = Readonly<Record<string, Cell>>;

// extraction stays null until the model fills it; the words are saved first so they survive a crash.
export type SourceRecord<E> = {
	id: string;
	at: number;
	source: string;
	extraction: E | null;
	unverified: string[];
};

export type Draft<E> = { extraction: E; unverified: string[] };

export type ExtractionRequest = {
	history: Array<{ role: "system" | "user"; content: string }>;
	responseFormat: {
		type: "json_schema";
		json_schema: { name: string; schema: Record<string, unknown> };
	};
	generationParams: { temp: number; predict: number };
};

export type Tone =
	| "neutral"
	| "income"
	| "expense"
	| "saving"
	| "confirmed"
	| "reported"
	| "estimated"
	| "unknown"
	| "renewal";

export type Badge = { label: string; tone: Tone };

export type SummaryItem = { label: string; value: string; tone: Tone };

export type FieldInput =
	| { kind: "text" }
	| { kind: "number" }
	| { kind: "date" }
	| { kind: "choice"; options: readonly string[] }
	| { kind: "readonly" };

export type Field = { key: string; label: string; input: FieldInput };

export type SheetRow = {
	key: string;
	recordId: string;
	index: number;
	cells: Cells;
	unverified: readonly string[];
	factors: string | null;
};

export type TableLine = {
	row: SheetRow;
	date: string;
	title: string;
	subtitle: string;
	amount: Badge;
};

export type UnitLine = {
	row: SheetRow;
	title: string;
	detail: string;
	status: Badge;
	tags: Badge[];
};

export type ClientGroup = {
	key: string;
	name: string;
	meta: string;
	units: UnitLine[];
};

export type SheetView =
	| {
			kind: "table";
			headers: {
				date: string;
				title: string;
				subtitle: string;
				amount: string;
			};
			lines: TableLine[];
	  }
	| { kind: "cards"; clients: ClientGroup[] };

export type ModeSpec<E> = {
	label: string;
	subtitle: string;
	sheetTitle: string;
	placeholder: string;
	csvName: string;
	fields: readonly Field[];
	request: (text: string, now: Date) => ExtractionRequest;
	assemble: (text: string, modelText: string, now: Date) => Draft<E> | null;
	parse: (value: unknown) => E | null;
	view: (records: readonly SourceRecord<E>[], now: Date) => SheetView;
	summary: (records: readonly SourceRecord<E>[], now: Date) => SummaryItem[];
	csv: (records: readonly SourceRecord<E>[], now: Date) => string;
	edit: (draft: Draft<E>, index: number, key: string, value: Cell) => Draft<E>;
	remove: (draft: Draft<E>, index: number) => Draft<E> | null;
	followUp: {
		ask: (extraction: E) => string | null;
		answer: (source: string, question: string, answer: string) => string;
	} | null;
	demo: {
		seed: (now: Date) => SourceRecord<E>[];
		example: string;
		modelText: string;
	};
};

export type LooseRecord = SourceRecord<unknown>;

export type Mode = {
	id: ModeId;
	extractor: ModelSpec;
	label: string;
	subtitle: string;
	sheetTitle: string;
	placeholder: string;
	csvName: string;
	fields: readonly Field[];
	request: (text: string, now: Date) => ExtractionRequest;
	assemble: (
		text: string,
		modelText: string,
		now: Date,
	) => Draft<unknown> | null;
	admit: (records: readonly LooseRecord[]) => LooseRecord[];
	view: (records: readonly LooseRecord[], now: Date) => SheetView;
	summary: (records: readonly LooseRecord[], now: Date) => SummaryItem[];
	csv: (records: readonly LooseRecord[], now: Date) => string;
	edit: (
		record: LooseRecord,
		index: number,
		key: string,
		value: Cell,
	) => LooseRecord;
	remove: (record: LooseRecord, index: number) => LooseRecord | null;
	ask: (record: LooseRecord) => string | null;
	answer: (source: string, question: string, answer: string) => string;
	demo: {
		seed: (now: Date) => LooseRecord[];
		example: string;
		modelText: string;
	};
};

// The app holds records of every mode side by side, so each mode re-parses its own extraction instead of trusting a cast.
export const defineMode = <E>(
	id: ModeId,
	extractor: ModelSpec,
	spec: ModeSpec<E>,
): Mode => {
	const typed = (record: LooseRecord): SourceRecord<E> => {
		const extraction =
			record.extraction === null ? null : spec.parse(record.extraction);
		return {
			...record,
			extraction,
			unverified: extraction === null ? [] : record.unverified,
		};
	};
	const all = (records: readonly LooseRecord[]) => records.map(typed);
	const draftOf = (record: LooseRecord) => {
		const { extraction, unverified } = typed(record);
		return extraction === null ? null : { extraction, unverified };
	};
	return {
		id,
		extractor,
		label: spec.label,
		subtitle: spec.subtitle,
		sheetTitle: spec.sheetTitle,
		placeholder: spec.placeholder,
		csvName: spec.csvName,
		fields: spec.fields,
		request: spec.request,
		assemble: spec.assemble,
		admit: all,
		view: (records, now) => spec.view(all(records), now),
		summary: (records, now) => spec.summary(all(records), now),
		csv: (records, now) => spec.csv(all(records), now),
		edit: (record, index, key, value) => {
			const draft = draftOf(record);
			return draft === null
				? record
				: { ...record, ...spec.edit(draft, index, key, value) };
		},
		remove: (record, index) => {
			const draft = draftOf(record);
			if (draft === null) return null;
			const left = spec.remove(draft, index);
			return left === null ? null : { ...record, ...left };
		},
		ask: (record) => {
			const { extraction } = typed(record);
			return extraction === null || spec.followUp === null
				? null
				: spec.followUp.ask(extraction);
		},
		answer: (source, question, answer) =>
			spec.followUp === null
				? source
				: spec.followUp.answer(source, question, answer),
		demo: {
			seed: spec.demo.seed,
			example: spec.demo.example,
			modelText: spec.demo.modelText,
		},
	};
};

export const sheetRows = (view: SheetView): SheetRow[] =>
	view.kind === "table"
		? view.lines.map((line) => line.row)
		: view.clients.flatMap((client) => client.units.map((unit) => unit.row));

const csvField = (value: Cell) => {
	const text = value === null ? "" : String(value);
	return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

// The BOM makes Sheets and Excel read the file as UTF-8, so "Categoría" survives.
export const toCsv = (
	fields: readonly Field[],
	rows: ReadonlyArray<Cells>,
): string =>
	`\uFEFF${[
		fields.map((field) => field.label),
		...rows.map((cells) => fields.map((field) => cells[field.key] ?? null)),
	]
		.map((line) => line.map(csvField).join(","))
		.join("\r\n")}\r\n`;

export const isoDate = (at: number | Date) => {
	const date = new Date(at);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const MONTHS = [
	"ene",
	"feb",
	"mar",
	"abr",
	"may",
	"jun",
	"jul",
	"ago",
	"sep",
	"oct",
	"nov",
	"dic",
];

export const shortDate = (iso: Cell) => {
	const match =
		typeof iso === "string" ? iso.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
	return match
		? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]}`
		: String(iso ?? "");
};

export const parseJsonObject = (text: string): unknown => {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end < start) return null;
	try {
		return JSON.parse(text.slice(start, end + 1));
	} catch {
		return null;
	}
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
