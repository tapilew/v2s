/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
	addColumn,
	appendRows,
	createSheet,
	editCell,
	parseCell,
	parseLibrary,
	relativeTime,
	removeRow,
	removeSource,
	renameSheet,
	sheetSummary,
	toCsv,
} from "./spreadsheet";

const first = { id: "s1", at: 1000, text: "Pagué 45 de luz y 12 de almuerzo" };
const second = { id: "s2", at: 2000, text: "Ayer 30 de gasolina" };

const base = () =>
	createSheet(
		"finanzas",
		"Movimientos",
		["Fecha", "Concepto", "Monto"],
		[
			{ cells: ["2026-09-10", "Luz", 45], unverified: [] },
			{ cells: ["2026-09-10", "Almuerzo", 12], unverified: [] },
		],
		first,
		5000,
	);

describe("parseCell", () => {
	test("reads Spanish and English number formats", () => {
		expect(parseCell("38,5")).toBe(38.5);
		expect(parseCell("38.5")).toBe(38.5);
		expect(parseCell("1.200")).toBe(1200);
		expect(parseCell("1,200")).toBe(1200);
		expect(parseCell("1.200.000")).toBe(1200000);
		expect(parseCell("1.200,50")).toBe(1200.5);
		expect(parseCell("1,200.50")).toBe(1200.5);
		expect(parseCell("-7")).toBe(-7);
		expect(parseCell("45")).toBe(45);
	});

	test("keeps dates, text and blanks as they are", () => {
		expect(parseCell("2026-09-10")).toBe("2026-09-10");
		expect(parseCell("  Yappy ")).toBe("Yappy");
		expect(parseCell("   ")).toBeNull();
		expect(parseCell("12 dólares")).toBe("12 dólares");
	});
});

describe("sheet operations", () => {
	test("createSheet pads and truncates rows to the column count", () => {
		const sheet = createSheet(
			"salud",
			"  ",
			["A", "B"],
			[
				{ cells: ["x"], unverified: [] },
				{ cells: ["y", 2, "extra"], unverified: [1, 2] },
			],
			first,
			1,
		);
		expect(sheet.name).toBe("Hoja sin nombre");
		expect(sheet.rows.map((row) => row.cells)).toEqual([
			["x", null],
			["y", 2],
		]);
		expect(sheet.rows[1].unverified).toEqual([1]);
		expect(sheet.rows.map((row) => row.sourceId)).toEqual(["s1", "s1"]);
	});

	test("appendRows keeps the source and removeSource undoes it", () => {
		const grown = appendRows(
			base(),
			[{ cells: ["2026-09-09", "Gasolina", 30], unverified: [] }],
			second,
			6000,
		);
		expect(grown.rows).toHaveLength(3);
		expect(grown.sources.map((source) => source.id)).toEqual(["s1", "s2"]);
		expect(grown.updatedAt).toBe(6000);
		const undone = removeSource(grown, "s2", 7000);
		expect(undone.rows).toHaveLength(2);
		expect(undone.sources).toHaveLength(1);
	});

	test("editCell parses numbers and clears the unverified flag", () => {
		const sheet = createSheet(
			"finanzas",
			"M",
			["Concepto", "Monto"],
			[{ cells: ["Luz", 99], unverified: [1] }],
			first,
			1,
		);
		const rowId = sheet.rows[0].id;
		const edited = editCell(sheet, rowId, 1, "45,50", 2);
		expect(edited.rows[0].cells).toEqual(["Luz", 45.5]);
		expect(edited.rows[0].unverified).toEqual([]);
		expect(editCell(edited, rowId, 0, "", 3).rows[0].cells[0]).toBeNull();
	});

	test("removeRow, renameSheet and addColumn", () => {
		const sheet = base();
		expect(removeRow(sheet, sheet.rows[0].id, 9).rows).toHaveLength(1);
		expect(renameSheet(sheet, " Gastos ", 9).name).toBe("Gastos");
		expect(renameSheet(sheet, "  ", 9).name).toBe("Movimientos");
		const wider = addColumn(sheet, "Método", 9);
		expect(wider.columns).toEqual(["Fecha", "Concepto", "Monto", "Método"]);
		expect(wider.rows[0].cells).toEqual(["2026-09-10", "Luz", 45, null]);
	});

	test("sheetSummary totals only columns where every filled cell is a number", () => {
		const sheet = appendRows(
			base(),
			[{ cells: [null, "Sin monto", null], unverified: [] }],
			second,
			1,
		);
		expect(sheetSummary(sheet)).toEqual({ rows: 3, totals: [null, null, 57] });
		const mixed = editCell(sheet, sheet.rows[0].id, 2, "unos 45", 2);
		expect(sheetSummary(mixed).totals[2]).toBeNull();
	});

	test("toCsv writes a BOM, CRLF lines and quotes only when needed", () => {
		const sheet = appendRows(
			base(),
			[{ cells: ["2026-09-09", 'Taxi, "rápido"', null], unverified: [] }],
			second,
			1,
		);
		expect(toCsv(sheet)).toBe(
			'\uFEFFFecha,Concepto,Monto\r\n2026-09-10,Luz,45\r\n2026-09-10,Almuerzo,12\r\n2026-09-09,"Taxi, ""rápido""",\r\n',
		);
	});
});

describe("parseLibrary", () => {
	test("keeps well-formed sheets and pending entries, drops the rest", () => {
		const sheet = base();
		const text = JSON.stringify({
			sheets: [
				sheet,
				{ ...sheet, id: 7 },
				{ ...sheet, mode: "otro" },
				{
					...sheet,
					id: "x",
					rows: [{ id: "r", cells: ["a", 1, "b", "c"], unverified: [0, 9] }],
					sources: [null],
					updatedAt: "ayer",
				},
			],
			pending: [
				{ id: "p1", at: 1, text: "hola", target: "new" },
				{ id: "p2", at: 2, text: "hola", target: { sheetId: sheet.id } },
				{ id: "p3", at: "nope", text: "hola" },
			],
		});
		const parsed = parseLibrary(text);
		expect(parsed?.dropped).toBe(3);
		expect(parsed?.library.sheets.map((found) => found.id)).toEqual([
			sheet.id,
			"x",
		]);
		expect(parsed?.library.sheets[1].rows[0]).toEqual({
			id: "r",
			cells: ["a", 1, "b"],
			sourceId: "",
			unverified: [0],
		});
		expect(parsed?.library.sheets[1].updatedAt).toBe(sheet.createdAt);
		expect(parsed?.library.pending.map((entry) => entry.target)).toEqual([
			"new",
			{ sheetId: sheet.id },
		]);
	});

	test("rejects anything that is not a library", () => {
		expect(parseLibrary("{")).toBeNull();
		expect(parseLibrary("[]")).toBeNull();
		expect(parseLibrary('{"pending": []}')).toBeNull();
		expect(parseLibrary('{"sheets": []}')).toEqual({
			library: { sheets: [], pending: [] },
			dropped: 0,
		});
	});
});

describe("relativeTime", () => {
	test("rounds to the nearest unit", () => {
		const now = 10_000_000;
		expect(relativeTime(now - 20_000, now)).toBe("ahora");
		expect(relativeTime(now - 5 * 60_000, now)).toBe("hace 5 min");
		expect(relativeTime(now - 2 * 3_600_000, now)).toBe("hace 2 h");
		expect(relativeTime(now - 3 * 86_400_000, now)).toBe("hace 3 d");
	});
});
