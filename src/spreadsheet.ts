export type ModeId = "finanzas" | "salud";

export const MODE_IDS: readonly ModeId[] = ["finanzas", "salud"];

export type Cell = string | number | null;

export type Row = {
	id: string;
	cells: Cell[];
	sourceId: string;
	unverified: number[];
};

export type DraftRow = { cells: Cell[]; unverified: number[] };

export type Source = { id: string; at: number; text: string };

export type Sheet = {
	id: string;
	name: string;
	mode: ModeId;
	columns: string[];
	rows: Row[];
	sources: Source[];
	createdAt: number;
	updatedAt: number;
};

export type Target = "new" | { sheetId: string };

// The words are saved here before the model runs, so a crash mid-generation never loses them.
export type Pending = { id: string; at: number; text: string; target: Target };

export type Library = { sheets: Sheet[]; pending: Pending[] };

export type TypeTotals = { Ingreso: number; Gasto: number; Ahorro: number };

export type Summary = {
	rows: number;
	totals: (number | null)[];
	byType: { column: number; totals: TypeTotals } | null;
};

const MONEY_COLUMN = /monto|total|precio|importe|valor|cantidad/i;

export const TYPES = ["Ingreso", "Gasto", "Ahorro"] as const;

export const EMPTY_LIBRARY: Library = { sheets: [], pending: [] };

const NUMERIC = /^-?\d+(?:[.,]\d+)*$/;

// "38,5" and "38.5" are decimals; "1.200", "1,200" and "1.200.000" are thousands groups; "1.200,50" mixes both.
export const parseCell = (text: string): Cell => {
	const trimmed = text.trim();
	if (trimmed === "") return null;
	if (!NUMERIC.test(trimmed)) return trimmed;
	const separators = trimmed.match(/[.,]/g) ?? [];
	if (separators.length === 0) return Number(trimmed);
	const last = trimmed.lastIndexOf(separators[separators.length - 1]);
	const tail = trimmed.slice(last + 1);
	const mixed = new Set(separators).size > 1;
	const grouped = !mixed && (separators.length > 1 || tail.length === 3);
	const digits = trimmed.replace(/[.,]/g, "");
	const value = grouped
		? Number(digits)
		: Number(`${digits.slice(0, digits.length - tail.length)}.${tail}`);
	return Number.isFinite(value) ? value : trimmed;
};

export const cellText = (cell: Cell | undefined) =>
	cell === null || cell === undefined ? "" : String(cell);

const fit = (cells: readonly Cell[], width: number): Cell[] =>
	Array.from({ length: width }, (_, index) => cells[index] ?? null);

const rowsFrom = (
	drafts: readonly DraftRow[],
	source: Source,
	width: number,
): Row[] =>
	drafts.map((draft, index) => ({
		id: `${source.id}-${index}`,
		cells: fit(draft.cells, width),
		sourceId: source.id,
		unverified: draft.unverified.filter((column) => column < width),
	}));

export const createSheet = (
	mode: ModeId,
	name: string,
	columns: readonly string[],
	rows: readonly DraftRow[],
	source: Source,
	now: number,
): Sheet => ({
	id: `${now.toString(36)}-${source.id}`,
	name: name.trim() || "Hoja sin nombre",
	mode,
	columns: [...columns],
	rows: rowsFrom(rows, source, columns.length),
	sources: [source],
	createdAt: now,
	updatedAt: now,
});

export const appendRows = (
	sheet: Sheet,
	rows: readonly DraftRow[],
	source: Source,
	now: number,
): Sheet => ({
	...sheet,
	rows: [...sheet.rows, ...rowsFrom(rows, source, sheet.columns.length)],
	sources: [...sheet.sources, source],
	updatedAt: now,
});

export const editCell = (
	sheet: Sheet,
	rowId: string,
	column: number,
	value: string,
	now: number,
): Sheet => ({
	...sheet,
	rows: sheet.rows.map((row) =>
		row.id !== rowId
			? row
			: {
					...row,
					cells: row.cells.map((cell, index) =>
						index === column ? parseCell(value) : cell,
					),
					unverified: row.unverified.filter((index) => index !== column),
				},
	),
	updatedAt: now,
});

export const removeRow = (sheet: Sheet, rowId: string, now: number): Sheet => ({
	...sheet,
	rows: sheet.rows.filter((row) => row.id !== rowId),
	updatedAt: now,
});

export const renameSheet = (sheet: Sheet, name: string, now: number): Sheet =>
	name.trim() === "" ? sheet : { ...sheet, name: name.trim(), updatedAt: now };

export const addColumn = (sheet: Sheet, name: string, now: number): Sheet => ({
	...sheet,
	columns: [
		...sheet.columns,
		name.trim() || `Columna ${sheet.columns.length + 1}`,
	],
	rows: sheet.rows.map((row) => ({ ...row, cells: [...row.cells, null] })),
	updatedAt: now,
});

export const removeSource = (
	sheet: Sheet,
	sourceId: string,
	now: number,
): Sheet => ({
	...sheet,
	rows: sheet.rows.filter((row) => row.sourceId !== sourceId),
	sources: sheet.sources.filter((source) => source.id !== sourceId),
	updatedAt: now,
});

const columnValues = (sheet: Sheet, column: number) =>
	sheet.rows
		.map((row) => row.cells[column] ?? null)
		.filter((cell): cell is Exclude<Cell, null> => cell !== null);

const round = (value: number) => Math.round(value * 100) / 100;

// Only money-like columns get a total; a Tipo column splits the first one by Ingreso, Gasto and Ahorro.
export const sheetSummary = (sheet: Sheet): Summary => {
	const totals = sheet.columns.map((name, column) => {
		if (!MONEY_COLUMN.test(name)) return null;
		const values = columnValues(sheet, column);
		if (
			values.length === 0 ||
			!values.every((cell) => typeof cell === "number")
		)
			return null;
		return round(values.reduce<number>((sum, cell) => sum + Number(cell), 0));
	});
	const money = totals.findIndex((total) => total !== null);
	const type = sheet.columns.findIndex((_, column) => {
		const values = columnValues(sheet, column);
		return (
			values.length > 0 &&
			values.every((cell) => TYPES.some((known) => known === cell))
		);
	});
	if (money === -1 || type === -1)
		return { rows: sheet.rows.length, totals, byType: null };
	const byType: TypeTotals = { Ingreso: 0, Gasto: 0, Ahorro: 0 };
	for (const row of sheet.rows) {
		const kind = row.cells[type];
		const amount = row.cells[money];
		if (typeof amount === "number" && TYPES.some((known) => known === kind))
			byType[kind as keyof TypeTotals] = round(
				byType[kind as keyof TypeTotals] + amount,
			);
	}
	return {
		rows: sheet.rows.length,
		totals,
		byType: { column: money, totals: byType },
	};
};

const csvField = (value: Cell) => {
	const text = cellText(value);
	return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

// The BOM makes Sheets and Excel read the file as UTF-8, so "Categoría" survives.
export const toCsv = (sheet: Sheet): string =>
	`\uFEFF${[sheet.columns, ...sheet.rows.map((row) => row.cells)]
		.map((line) => line.map(csvField).join(","))
		.join("\r\n")}\r\n`;

export const csvFileName = (sheet: Sheet) =>
	`${sheet.name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "hoja"}.csv`;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isCell = (value: unknown): value is Cell =>
	value === null ||
	typeof value === "string" ||
	(typeof value === "number" && Number.isFinite(value));

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const isModeId = (value: unknown): value is ModeId =>
	MODE_IDS.some((id) => id === value);

const sourceFrom = (value: unknown): Source | null =>
	isRecord(value) &&
	typeof value.id === "string" &&
	isFiniteNumber(value.at) &&
	typeof value.text === "string"
		? { id: value.id, at: value.at, text: value.text }
		: null;

const rowFrom = (value: unknown, width: number): Row | null => {
	if (!isRecord(value)) return null;
	const { id, cells, sourceId, unverified } = value;
	if (typeof id !== "string" || !Array.isArray(cells)) return null;
	return {
		id,
		cells: fit(
			cells.map((cell) => (isCell(cell) ? cell : null)),
			width,
		),
		sourceId: typeof sourceId === "string" ? sourceId : "",
		unverified: Array.isArray(unverified)
			? unverified.filter(
					(index): index is number => isFiniteNumber(index) && index < width,
				)
			: [],
	};
};

export const sheetFrom = (value: unknown): Sheet | null => {
	if (!isRecord(value)) return null;
	const { id, name, mode, columns, rows, sources, createdAt, updatedAt } =
		value;
	if (
		typeof id !== "string" ||
		typeof name !== "string" ||
		!isModeId(mode) ||
		!Array.isArray(columns) ||
		!columns.every((column) => typeof column === "string") ||
		!Array.isArray(rows) ||
		!isFiniteNumber(createdAt)
	)
		return null;
	return {
		id,
		name,
		mode,
		columns,
		rows: rows
			.map((row) => rowFrom(row, columns.length))
			.filter((row): row is Row => row !== null),
		sources: Array.isArray(sources)
			? sources
					.map(sourceFrom)
					.filter((source): source is Source => source !== null)
			: [],
		createdAt,
		updatedAt: isFiniteNumber(updatedAt) ? updatedAt : createdAt,
	};
};

const pendingFrom = (value: unknown): Pending | null => {
	if (!isRecord(value)) return null;
	const { id, at, text, target } = value;
	if (typeof id !== "string" || !isFiniteNumber(at) || typeof text !== "string")
		return null;
	const wanted: Target =
		isRecord(target) && typeof target.sheetId === "string"
			? { sheetId: target.sheetId }
			: "new";
	return { id, at, text, target: wanted };
};

export const parseLibrary = (
	text: string,
): { library: Library; dropped: number } | null => {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isRecord(raw) || !Array.isArray(raw.sheets)) return null;
	const sheets = raw.sheets
		.map(sheetFrom)
		.filter((sheet): sheet is Sheet => sheet !== null);
	const rawPending = Array.isArray(raw.pending) ? raw.pending : [];
	const pending = rawPending
		.map(pendingFrom)
		.filter((entry): entry is Pending => entry !== null);
	return {
		library: { sheets, pending },
		dropped:
			raw.sheets.length - sheets.length + rawPending.length - pending.length,
	};
};

export const byRecent = (sheets: readonly Sheet[]): Sheet[] =>
	[...sheets].sort((a, b) => b.updatedAt - a.updatedAt);

export const relativeTime = (at: number, now: number) => {
	const minutes = Math.max(0, Math.round((now - at) / 60000));
	if (minutes < 1) return "ahora";
	if (minutes < 60) return `hace ${minutes} min`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `hace ${hours} h`;
	const days = Math.round(hours / 24);
	return `hace ${days} d`;
};
