import { foldText, numbersIn } from "../grounding";
import type { ModelSpec } from "../models";
import {
	type Cell,
	type DraftRow,
	isRecord,
	type ModeId,
	parseCell,
	type Sheet,
} from "../spreadsheet";
import {
	type DateSupport,
	groundDate,
	ISO_DATE,
	isoDate,
	isWeekday,
	supportedDates,
	weekdayDate,
	weekdayIndex,
} from "./dates";
import { finanzas } from "./finanzas";
import { salud } from "./salud";

export type CompletionRequest = {
	history: Array<{ role: "system" | "user"; content: string }>;
	responseFormat: {
		type: "json_schema";
		json_schema: { name: string; schema: Record<string, unknown> };
	};
	generationParams: { temp: number; predict: number };
};

export type Generated = {
	title: string | null;
	columns: string[];
	rows: DraftRow[];
};

// One submit is two completions: list what was said, then turn each element into a row.
export type Job = {
	text: string;
	columns: string[] | null;
	list: CompletionRequest;
	rows: (items: readonly string[]) => CompletionRequest;
};

export type ModeRules = {
	label: string;
	subtitle: string;
	rules: string;
	demo: {
		sentence: string;
		listText: string;
		newRowsText: string;
		updateSentence: string;
		updateListText: string;
		updateRow: Record<string, Cell>;
	};
};

export type Harness = ModeRules & { id: ModeId; extractor: ModelSpec };

export const MAX_COLUMNS = 8;
export const MAX_ITEMS = 12;
export const MAX_ROWS = 20;

const text = (maxLength: number) => ({ type: "string", maxLength });

export const LIST_SCHEMA = {
	type: "object",
	properties: {
		elementos: { type: "array", minItems: 1, maxItems: 20, items: text(90) },
	},
	required: ["elementos"],
};

export const newSchema = (n: number) => ({
	type: "object",
	properties: {
		titulo: text(40),
		columnas: {
			type: "array",
			minItems: 2,
			maxItems: MAX_COLUMNS,
			items: text(24),
		},
		filas: {
			type: "array",
			minItems: n,
			maxItems: n,
			items: {
				type: "array",
				minItems: 2,
				maxItems: MAX_COLUMNS,
				items: text(60),
			},
		},
	},
	required: ["titulo", "columnas", "filas"],
});

export const updateSchema = (n: number, width: number) => ({
	type: "object",
	properties: {
		filas: {
			type: "array",
			minItems: n,
			maxItems: n,
			items: {
				type: "array",
				minItems: width,
				maxItems: width,
				items: text(60),
			},
		},
	},
	required: ["filas"],
});

export const LIST_SYSTEM =
	'Lista cada cosa registrable que menciona el texto, una por elemento, copiando las palabras del texto. Separa cada movimiento de dinero, cada equipo, cada medicamento y cada medición. "dos resonadores y un tomógrafo" son dos elementos. Un saludo o el nombre del lugar no es un elemento. ' +
	"Cada elemento incluye todo lo que se dijo de esa cosa: su monto, su método de pago, su marca o su dosis, en el mismo elemento.\n" +
	'Ejemplo. Texto: "Pagué 45 de luz con Yappy y 12 de almuerzo" Elementos: ["Pagué 45 de luz con Yappy","12 de almuerzo"]';

export const commonRules = (now: Date) =>
	'Conviertes elementos ya listados en filas de una hoja de cálculo: exactamente una fila por elemento, en orden. Usa solo lo que dice el texto; deja "" cuando falta un dato; nunca inventes números. ' +
	`Fechas AAAA-MM-DD solo si el texto nombra el día; hoy es ${isoDate(now)}. Sin abreviaturas. Español.`;

const request = (
	system: string,
	user: string,
	schema: Record<string, unknown>,
	predict: number,
): CompletionRequest => ({
	history: [
		{ role: "system", content: system },
		{ role: "user", content: user },
	],
	responseFormat: {
		type: "json_schema",
		json_schema: { name: "hoja", schema },
	},
	generationParams: { temp: 0, predict },
});

export const listRequest = (source: string): CompletionRequest =>
	request(LIST_SYSTEM, `Texto: "${source}"`, LIST_SCHEMA, 200);

const rowsUser = (source: string, items: readonly string[]) =>
	`Texto: "${source}"\nElementos: ${JSON.stringify(items.slice(0, MAX_ITEMS))}`;

const itemCount = (items: readonly string[]) =>
	Math.max(1, Math.min(MAX_ITEMS, items.length));

export const newSheetRequest = (
	rules: ModeRules,
	source: string,
	items: readonly string[],
	now: Date,
): CompletionRequest =>
	request(
		`${commonRules(now)} ${rules.rules}`,
		rowsUser(source, items),
		newSchema(itemCount(items)),
		500,
	);

const cellString = (cell: Cell) => (cell === null ? "" : String(cell));

export const updateSheetRequest = (
	rules: ModeRules,
	source: string,
	items: readonly string[],
	columns: readonly string[],
	sampleRows: ReadonlyArray<readonly Cell[]>,
	now: Date,
): CompletionRequest => {
	const samples = sampleRows.slice(0, 3).map((row) => row.map(cellString));
	const suffix =
		`\nAhora agregas filas a una hoja existente. Columnas: ${columns.join(" | ")}. ` +
		(samples.length > 0
			? `Filas ya en la hoja: ${JSON.stringify(samples)}. `
			: "") +
		`Cada fila nueva con exactamente ${columns.length} celdas en ese orden.`;
	return request(
		`${commonRules(now)} ${rules.rules}${suffix}`,
		rowsUser(source, items),
		updateSchema(itemCount(items), columns.length),
		500,
	);
};

export const parseJsonObject = (source: string): unknown => {
	const start = source.indexOf("{");
	const end = source.lastIndexOf("}");
	if (start === -1 || end < start) return null;
	try {
		return JSON.parse(source.slice(start, end + 1));
	} catch {
		return null;
	}
};

const stringList = (value: unknown): string[] | null =>
	Array.isArray(value) && value.every((item) => typeof item === "string")
		? value
		: null;

export const parseList = (modelText: string): string[] | null => {
	const parsed = parseJsonObject(modelText);
	if (!isRecord(parsed)) return null;
	const items = stringList(parsed.elementos)
		?.map((item) => item.trim())
		.filter((item) => item !== "")
		.slice(0, MAX_ITEMS);
	return items && items.length > 0 ? items : null;
};

const cleanColumn = (name: string, index: number) =>
	name.trim().slice(0, 24) || `Columna ${index + 1}`;

const cellOf = (value: unknown): Cell =>
	typeof value === "number" && Number.isFinite(value)
		? value
		: typeof value === "string"
			? parseCell(value)
			: null;

// "un tomógrafo" counts as one, so a Cantidad of 1 is grounded.
const saidNumbers = (source: string) => {
	const said = new Set(
		numbersIn(source).map((number) => Math.trunc(Math.abs(number))),
	);
	if (/\b(un|una)\b/iu.test(foldText(source))) said.add(1);
	return said;
};

const isDateColumn = (name: string) => /fecha/i.test(name);

type Grounding = {
	said: ReadonlySet<number>;
	dates: DateSupport;
	folded: string;
	now: Date;
};

// Dates are checked against the days the text names; a weekday written as a concept moves to the date column.
const groundRow = (
	cells: Cell[],
	columns: readonly string[],
	grounding: Grounding,
): DraftRow => {
	const dateColumn = columns.findIndex(isDateColumn);
	const unverified = new Set<number>();
	let weekday = -1;
	const grounded = cells.map((cell, index) => {
		if (index === dateColumn) return cell;
		if (typeof cell === "string" && isWeekday(cell)) {
			weekday = weekdayIndex(cell);
			unverified.add(index);
			return null;
		}
		if (
			typeof cell === "number" &&
			!grounding.said.has(Math.trunc(Math.abs(cell)))
		)
			unverified.add(index);
		return cell;
	});
	if (dateColumn !== -1) {
		const cell = grounded[dateColumn];
		const named =
			weekday !== -1 ? isoDate(weekdayDate(weekday, grounding.now)) : null;
		grounded[dateColumn] =
			named && grounding.dates.dates.includes(named)
				? named
				: typeof cell === "string" && ISO_DATE.test(cell)
					? groundDate(cell, grounding.dates, grounding.now)
					: cell;
	}
	return { cells: grounded, unverified: [...unverified].sort((a, b) => a - b) };
};

const dedupe = (rows: readonly DraftRow[]) => {
	const seen = new Set<string>();
	return rows.filter((row) => {
		const key = JSON.stringify(row.cells);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
};

// A cell identical across every row of the batch (the client name, a shared date) is no evidence for any one row.
const sharedColumns = (rows: readonly DraftRow[]) => {
	if (rows.length < 2) return new Set<number>();
	const [first] = rows;
	return new Set(
		first.cells.flatMap((cell, index) =>
			rows.every((row) => cellString(row.cells[index]) === cellString(cell))
				? [index]
				: [],
		),
	);
};

const STEM = 5;

const textSupports = (cell: string, folded: string) =>
	(foldText(cell).match(/\p{L}+/gu) ?? []).some(
		(word) => word.length >= STEM && folded.includes(word.slice(0, STEM)),
	);

const isSupported = (
	row: DraftRow,
	shared: ReadonlySet<number>,
	folded: string,
) =>
	row.cells.some((cell, index) => {
		if (shared.has(index) || cell === null) return false;
		if (typeof cell === "number") return !row.unverified.includes(index);
		return textSupports(cell, folded);
	});

const flagAll = (row: DraftRow): DraftRow => ({
	...row,
	unverified: row.cells.flatMap((cell, index) =>
		cell === null ? [] : [index],
	),
});

export const assemble = (
	source: string,
	modelText: string,
	now: Date,
	columns?: readonly string[],
): Generated | null => {
	const parsed = parseJsonObject(modelText);
	if (!isRecord(parsed)) return null;
	const named = columns
		? [...columns]
		: stringList(parsed.columnas)?.slice(0, MAX_COLUMNS).map(cleanColumn);
	if (!named || named.length < (columns ? 1 : 2)) return null;
	if (!Array.isArray(parsed.filas)) return null;
	const grounding: Grounding = {
		said: saidNumbers(source),
		dates: supportedDates(source, now),
		folded: foldText(source),
		now,
	};
	const grounded = dedupe(
		parsed.filas
			.slice(0, MAX_ROWS)
			.filter((row): row is unknown[] => Array.isArray(row))
			.map((row) =>
				groundRow(
					named.map((_, index) => cellOf(row[index])),
					named,
					grounding,
				),
			)
			.filter((row) => row.cells.some((cell) => cell !== null)),
	);
	if (grounded.length === 0) return null;
	const shared = sharedColumns(grounded);
	const supported = grounded.filter((row) =>
		isSupported(row, shared, grounding.folded),
	);
	const rows = supported.length > 0 ? supported : [flagAll(grounded[0])];
	const title =
		typeof parsed.titulo === "string" ? parsed.titulo.trim().slice(0, 40) : "";
	return { title: columns ? null : title || null, columns: named, rows };
};

export const HARNESS: Readonly<Record<ModeId, Harness>> = {
	finanzas,
	salud,
};

export const newSheetJob = (mode: ModeId, source: string, now: Date): Job => ({
	text: source,
	columns: null,
	list: listRequest(source),
	rows: (items) => newSheetRequest(HARNESS[mode], source, items, now),
});

export const updateSheetJob = (
	mode: ModeId,
	source: string,
	sheet: Sheet,
	now: Date,
): Job => ({
	text: source,
	columns: sheet.columns,
	list: listRequest(source),
	rows: (items) =>
		updateSheetRequest(
			HARNESS[mode],
			source,
			items,
			sheet.columns,
			sheet.rows.slice(-3).map((row) => row.cells),
			now,
		),
});

const foldName = (name: string) => foldText(name).trim();

export const demoListText = (mode: ModeId, columns: string[] | null) =>
	columns === null
		? HARNESS[mode].demo.listText
		: HARNESS[mode].demo.updateListText;

// The demo engine answers an update with cells matched to the sheet's own columns, so any schema fills.
export const demoRowsText = (mode: ModeId, columns: string[] | null) => {
	const { demo } = HARNESS[mode];
	if (columns === null) return demo.newRowsText;
	const byName = new Map(
		Object.entries(demo.updateRow).map(([key, value]) => [
			foldName(key),
			cellString(value),
		]),
	);
	const row = columns.map((column) => byName.get(foldName(column)) ?? "");
	return JSON.stringify({ filas: [row] });
};
