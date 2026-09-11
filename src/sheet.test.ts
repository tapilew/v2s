/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import type { ModelSpec } from "./models";
import {
	defineMode,
	type Field,
	type ModeSpec,
	sheetRows,
	shortDate,
	toCsv,
} from "./sheet";

const fields: Field[] = [
	{ key: "concepto", label: "Concepto", input: { kind: "text" } },
	{ key: "monto", label: "Monto", input: { kind: "number" } },
	{ key: "texto", label: "Texto original", input: { kind: "readonly" } },
];

describe("toCsv", () => {
	test("starts with a BOM, ends rows with CRLF and quotes per RFC 4180", () => {
		expect(
			toCsv(fields, [
				{ concepto: "Luz", monto: 45, texto: "Pagué 45 de luz" },
				{ concepto: 'Pizza "grande"', monto: 12.5, texto: "uno, dos\nfin" },
				{ concepto: null },
			]),
		).toBe(
			'\uFEFFConcepto,Monto,Texto original\r\nLuz,45,Pagué 45 de luz\r\n"Pizza ""grande""",12.5,"uno, dos\nfin"\r\n,,\r\n',
		);
	});
});

describe("shortDate", () => {
	test("reads ISO dates and passes anything else through", () => {
		expect(shortDate("2026-09-01")).toBe("1 sep");
		expect(shortDate("ayer")).toBe("ayer");
		expect(shortDate(null)).toBe("");
	});
});

type Items = string[];

const items = (value: unknown): Items | null =>
	Array.isArray(value) && value.every((item) => typeof item === "string")
		? value
		: null;

const spec: ModeSpec<Items> = {
	label: "Prueba",
	subtitle: "Una lista",
	sheetTitle: "Cosas",
	placeholder: "Escribe",
	csvName: "prueba.csv",
	fields,
	request: () => ({
		history: [],
		responseFormat: {
			type: "json_schema",
			json_schema: { name: "x", schema: {} },
		},
		generationParams: { temp: 0, predict: 1 },
	}),
	assemble: (_, modelText) => {
		const found = items(JSON.parse(modelText));
		return found ? { extraction: found, unverified: [] } : null;
	},
	parse: items,
	view: (records) => ({
		kind: "table",
		headers: { date: "", title: "", subtitle: "", amount: "" },
		lines: records.flatMap((record) =>
			(record.extraction ?? []).map((item, index) => ({
				row: {
					key: `${record.id}/${index}`,
					recordId: record.id,
					index,
					cells: { concepto: item },
					unverified: [],
					factors: null,
				},
				date: "",
				title: item,
				subtitle: "",
				amount: { label: "", tone: "neutral" },
			})),
		),
	}),
	summary: (records) => [
		{ label: "Filas", value: String(records.length), tone: "neutral" },
	],
	csv: () => "",
	edit: (draft, index, _, value) => ({
		extraction: draft.extraction.map((item, at) =>
			at === index ? String(value) : item,
		),
		unverified: [],
	}),
	remove: (draft, index) => {
		const left = draft.extraction.filter((_, at) => at !== index);
		return left.length > 0 ? { extraction: left, unverified: [] } : null;
	},
	followUp: {
		ask: (extraction) => (extraction.length < 2 ? "¿Algo más?" : null),
		answer: (source, question, answer) => `${source} | ${question} ${answer}`,
	},
	demo: { seed: () => [], example: "ejemplo", modelText: "[]" },
};

const extractor = { sdkConstant: "QWEN3_1_7B_INST_Q4" } as ModelSpec;
const mode = defineMode("finanzas", extractor, spec);

const record = (extraction: unknown, unverified: string[] = []) => ({
	id: "r",
	at: 1,
	source: "texto",
	extraction,
	unverified,
});

describe("defineMode", () => {
	test("admit turns an extraction the mode can't read into a pending record", () => {
		expect(
			mode.admit([record(["a"], ["0.x"]), record([3], ["0.x"]), record(null)]),
		).toEqual([record(["a"], ["0.x"]), record(null), record(null)]);
	});

	test("view skips unreadable extractions", () => {
		const view = mode.view(
			[record(["a", "b"]), record({ roto: true })],
			new Date(),
		);
		expect(sheetRows(view).map((row) => row.key)).toEqual(["r/0", "r/1"]);
	});

	test("edit and remove go through the typed extraction", () => {
		expect(
			mode.edit(record(["a", "b"]), 1, "concepto", "c").extraction,
		).toEqual(["a", "c"]);
		expect(mode.edit(record(null), 0, "concepto", "c")).toEqual(record(null));
		expect(mode.remove(record(["a", "b"]), 0)?.extraction).toEqual(["b"]);
		expect(mode.remove(record(["a"]), 0)).toBeNull();
	});

	test("ask and answer use the follow-up when the mode has one", () => {
		expect(mode.ask(record(["a"]))).toBe("¿Algo más?");
		expect(mode.ask(record(null))).toBeNull();
		expect(mode.answer("vi a", "¿Algo más?", "b")).toBe("vi a | ¿Algo más? b");
		const silent = defineMode("salud", extractor, { ...spec, followUp: null });
		expect(silent.ask(record(["a"]))).toBeNull();
		expect(silent.answer("vi a", "¿Algo más?", "b")).toBe("vi a");
	});
});
