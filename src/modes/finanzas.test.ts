/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Cells, Draft, SourceRecord } from "../sheet";
import { finanzas, type Movimiento } from "./finanzas";

const NOW = new Date(2026, 8, 10, 14, 5);
const TODAY = "2026-09-10";
const YESTERDAY = "2026-09-09";

const QWEN = "QWEN3_1_7B_INST_Q4";
const MEDPSY = "HEALTHCARE_1_7B_MEDICAL_Q4_K_M";

const readEval = (path: string) =>
	readFileSync(`${import.meta.dir}/../../eval/${path}`, "utf8");

const probeRuns: Array<{
	kind: string;
	model: string;
	text: string;
	out: string;
}> = readEval("probe/finance-results.jsonl")
	.trim()
	.split("\n")
	.map((line) => JSON.parse(line));

const probeOut = (model: string, text: string) => {
	const run = probeRuns.find(
		(entry) =>
			entry.kind === "rows" && entry.model === model && entry.text === text,
	);
	if (!run) throw new Error(`no probe output for ${model}: ${text}`);
	return run.out;
};

type GoldRow = {
	concepto: string;
	tipo: string;
	categoria: string;
	monto: number;
	metodo: string | null;
};

const goldCases: Array<{ id: string; text: string; gold: GoldRow[] }> =
	JSON.parse(readEval("finanzas.json"));

const goldCase = (id: string) => {
	const found = goldCases.find((entry) => entry.id === id);
	if (!found) throw new Error(`no gold case ${id}`);
	return found;
};

const modelText = (movimientos: readonly object[]) =>
	JSON.stringify({
		movimientos: movimientos.map((movimiento) => ({
			fecha: null,
			...movimiento,
		})),
	});

type Movement = { cells: Cells; unverified: string[] };

const movement = (cells: Cells, unverified: string[] = []): Movement => ({
	cells: { fecha: TODAY, metodo: null, ...cells },
	unverified,
});

const movementsOf = (draft: Draft<Movimiento[]> | null): Movement[] =>
	draft === null
		? []
		: draft.extraction.map((cells, index) => ({
				cells,
				unverified: draft.unverified.flatMap((path) =>
					path.startsWith(`${index}.`) ? [path.slice(`${index}.`.length)] : [],
				),
			}));

const assemble = (text: string, output: string, now = NOW) =>
	movementsOf(finanzas.assemble(text, output, now));

const cellsOf = (text: string, rows: readonly object[], now = NOW) =>
	assemble(text, modelText(rows), now).map((draft) => draft.cells);

const LUZ =
	"Hoy pagué 45 dólares de luz con Yappy y 12 de almuerzo en efectivo.";
const QUINCENA =
	"Me cayó la quincena, 850 dólares, y pasé 100 a la cuenta de ahorros.";
const GASOLINA = "Gasté 60 en gasolina con tarjeta.";
const UTILES = "Ayer compré útiles escolares por 38.50 y el taxi fue 6.";
const MITAD = "Recibí 200 de un trabajo extra y ahorré la mitad.";
const ALQUILER = "Pagué el alquiler, 550, por transferencia.";

describe("request", () => {
	test("sends the few-shot prompt with the cash and own-account rule", () => {
		const request = finanzas.request(LUZ, NOW);
		expect(request.history.map((message) => message.role)).toEqual([
			"system",
			"user",
		]);
		expect(request.history[1].content).toBe(`Texto: ${LUZ}`);
		const system = request.history[0].content;
		expect(system).toContain("nunca inventes montos");
		expect(system).toContain(
			"Sacar efectivo del cajero o mover dinero entre tus propias cuentas no es un gasto y no crea ninguna fila, salvo un depósito a la cuenta de ahorros, que es Ahorro.",
		);
		expect(system).toContain("Texto: Compré el súper por 80 dólares");
		expect(request.responseFormat.json_schema.name).toBe("filas");
		expect(request.generationParams).toEqual({ temp: 0, predict: 300 });
	});
});

describe("assemble on Qwen3 probe outputs", () => {
	test("luz with Yappy and almuerzo in cash", () => {
		expect(assemble(LUZ, probeOut(QWEN, LUZ))).toEqual([
			movement({
				concepto: "Luz",
				tipo: "Gasto",
				categoria: "Servicios",
				monto: 45,
				metodo: "Yappy",
			}),
			movement({
				concepto: "Almuerzo",
				tipo: "Gasto",
				categoria: "Alimentación",
				monto: 12,
				metodo: "Efectivo",
			}),
		]);
	});

	test("quincena becomes income and the invented transfers are dropped", () => {
		expect(assemble(QUINCENA, probeOut(QWEN, QUINCENA))).toEqual([
			movement({
				concepto: "Quincena",
				tipo: "Ingreso",
				categoria: "Ingreso",
				monto: 850,
			}),
			movement({
				concepto: "Depósito a cuenta de ahorros",
				tipo: "Ahorro",
				categoria: "Ahorro",
				monto: 100,
			}),
		]);
	});

	test("gasolina with card", () => {
		expect(assemble(GASOLINA, probeOut(QWEN, GASOLINA))).toEqual([
			movement({
				concepto: "Gasolina",
				tipo: "Gasto",
				categoria: "Transporte",
				monto: 60,
				metodo: "Tarjeta",
			}),
		]);
	});

	test("ayer dates both rows and the invented card is dropped", () => {
		expect(assemble(UTILES, probeOut(QWEN, UTILES))).toEqual([
			movement({
				fecha: YESTERDAY,
				concepto: "Útiles escolares",
				tipo: "Gasto",
				categoria: "Educación",
				monto: 38.5,
			}),
			movement({
				fecha: YESTERDAY,
				concepto: "Taxi",
				tipo: "Gasto",
				categoria: "Transporte",
				monto: 6,
			}),
		]);
	});

	test("recibí makes income and la mitad leaves monto unverified", () => {
		expect(assemble(MITAD, probeOut(QWEN, MITAD))).toEqual([
			movement({
				concepto: "Trabajo extra",
				tipo: "Ingreso",
				categoria: "Ingreso",
				monto: 200,
			}),
			movement(
				{ concepto: "Ahorro", tipo: "Ahorro", categoria: "Ahorro", monto: 100 },
				["monto"],
			),
		]);
		expect(
			finanzas.assemble(MITAD, probeOut(QWEN, MITAD), NOW)?.unverified,
		).toEqual(["1.monto"]);
	});

	test("alquiler by transfer", () => {
		expect(assemble(ALQUILER, probeOut(QWEN, ALQUILER))).toEqual([
			movement({
				concepto: "Alquiler",
				tipo: "Gasto",
				categoria: "Vivienda",
				monto: 550,
				metodo: "Transferencia",
			}),
		]);
	});
});

describe("assemble on MedPsy probe outputs", () => {
	test("the card it invented for luz becomes the Yappy said in that clause", () => {
		expect(assemble(LUZ, probeOut(MEDPSY, LUZ))).toEqual([
			movement({
				concepto: "Luz",
				tipo: "Gasto",
				categoria: "Servicios",
				monto: 45,
				metodo: "Yappy",
			}),
		]);
	});

	test("a quincena filed as a health expense becomes income dated today", () => {
		expect(assemble(QUINCENA, probeOut(MEDPSY, QUINCENA))).toEqual([
			movement({
				concepto: "Caida de quincena",
				tipo: "Ingreso",
				categoria: "Ingreso",
				monto: 850,
			}),
		]);
	});

	test("gasolina with card", () => {
		expect(assemble(GASOLINA, probeOut(MEDPSY, GASOLINA))).toEqual([
			movement({
				concepto: "Gasolina",
				tipo: "Gasto",
				categoria: "Transporte",
				monto: 60,
				metodo: "Tarjeta",
			}),
		]);
	});

	test("capitalized Ayer still dates the row", () => {
		expect(assemble(UTILES, probeOut(MEDPSY, UTILES))).toEqual([
			movement({
				fecha: YESTERDAY,
				concepto: "Compras de útiles escolares",
				tipo: "Gasto",
				categoria: "Educación",
				monto: 38.5,
			}),
		]);
	});

	test("income category follows tipo and la mitad stays unverified", () => {
		expect(assemble(MITAD, probeOut(MEDPSY, MITAD))).toEqual([
			movement({
				concepto: "Trabajo extra",
				tipo: "Ingreso",
				categoria: "Ingreso",
				monto: 200,
			}),
			movement(
				{ concepto: "Ahorro", tipo: "Ahorro", categoria: "Ahorro", monto: 100 },
				["monto"],
			),
		]);
	});

	test("a second row backed by the same 550 is unverified", () => {
		expect(assemble(ALQUILER, probeOut(MEDPSY, ALQUILER))).toEqual([
			movement({
				concepto: "Alquiler",
				tipo: "Gasto",
				categoria: "Vivienda",
				monto: 550,
				metodo: "Transferencia",
			}),
			movement(
				{
					concepto: "Pagos de impuestos",
					tipo: "Gasto",
					categoria: "Compras",
					monto: 550,
					metodo: "Transferencia",
				},
				["monto"],
			),
		]);
	});
});

describe("assemble on gold rows", () => {
	for (const { id, text, gold } of goldCases) {
		test(`${id} survives every rule unchanged: ${text}`, () => {
			expect(assemble(text, modelText(gold))).toEqual(
				gold.map((row) => movement(row)),
			);
		});
	}
});

describe("assemble on corrupted gold rows", () => {
	test("an invented method is dropped when the text names none", () => {
		const { text, gold } = goldCase("f4");
		expect(
			cellsOf(
				text,
				gold.map((row) => ({ ...row, metodo: "Tarjeta" })),
			).map((cells) => cells.metodo),
		).toEqual([null, null]);
	});

	test("a quincena filed as an expense becomes income", () => {
		const { text, gold } = goldCase("f2");
		const [quincena, ahorro] = gold;
		expect(
			cellsOf(text, [
				{ ...quincena, tipo: "Gasto", categoria: "Salud" },
				{ ...ahorro, tipo: "Gasto", categoria: "Otro" },
			]).map(({ tipo, categoria }) => [tipo, categoria]),
		).toEqual([
			["Ingreso", "Ingreso"],
			["Ahorro", "Ahorro"],
		]);
	});

	test("vendí and me dieron make the empanadas income", () => {
		const { text, gold } = goldCase("f8");
		expect(
			cellsOf(
				text,
				gold.map((row) => ({ ...row, tipo: "Gasto", categoria: "Compras" })),
			).map(({ tipo, categoria }) => [tipo, categoria]),
		).toEqual([["Ingreso", "Ingreso"]]);
	});

	test("plan de ahorro makes the deposit a saving", () => {
		const { text, gold } = goldCase("f6");
		expect(
			cellsOf(
				text,
				gold.map((row) => ({ ...row, tipo: "Gasto", categoria: "Otro" })),
			).map(({ tipo, categoria }) => [tipo, categoria]),
		).toEqual([["Ahorro", "Ahorro"]]);
	});

	test("one 550 backs only one row", () => {
		const { text, gold } = goldCase("f5");
		expect(
			finanzas.assemble(text, modelText([...gold, gold[0]]), NOW)?.unverified,
		).toEqual(["1.monto"]);
	});

	test("an amount said twice backs two rows", () => {
		expect(
			finanzas.assemble(
				"Pagué 12 de almuerzo y 12 de taxi.",
				modelText([
					{
						concepto: "Almuerzo",
						tipo: "Gasto",
						categoria: "Alimentación",
						monto: 12,
						metodo: null,
					},
					{
						concepto: "Taxi",
						tipo: "Gasto",
						categoria: "Transporte",
						monto: 12,
						metodo: null,
					},
				]),
				NOW,
			)?.unverified,
		).toEqual([]);
	});

	test("half of an amount is kept but flagged", () => {
		expect(
			assemble(
				MITAD,
				modelText([
					{
						concepto: "Trabajo extra",
						tipo: "Ingreso",
						categoria: "Ingreso",
						monto: 200,
						metodo: null,
					},
					{
						concepto: "Ahorro",
						tipo: "Ahorro",
						categoria: "Ahorro",
						monto: 100,
						metodo: null,
					},
				]),
			),
		).toEqual([
			movement({
				concepto: "Trabajo extra",
				tipo: "Ingreso",
				categoria: "Ingreso",
				monto: 200,
			}),
			movement(
				{ concepto: "Ahorro", tipo: "Ahorro", categoria: "Ahorro", monto: 100 },
				["monto"],
			),
		]);
	});

	test("an expense filed under Ingreso or Ahorro takes its keyword category, else Otro", () => {
		const { text, gold } = goldCase("f9");
		expect(
			cellsOf(text, [
				{ ...gold[0], categoria: "Ingreso" },
				{ ...gold[1], categoria: "Ahorro" },
			]).map(({ tipo, categoria }) => [tipo, categoria]),
		).toEqual([
			["Gasto", "Servicios"],
			["Gasto", "Entretenimiento"],
		]);
		expect(
			cellsOf("Pagué 40 de un regalo.", [
				{
					concepto: "Regalo",
					tipo: "Gasto",
					categoria: "Ingreso",
					monto: 40,
					metodo: null,
				},
			]).map(({ tipo, categoria }) => [tipo, categoria]),
		).toEqual([["Gasto", "Otro"]]);
	});
});

describe("categoria", () => {
	test("the demo capture files 12 de almuerzo under Alimentación, not Compras", () => {
		expect(
			assemble(finanzas.demo.example, finanzas.demo.modelText).map(
				({ cells }) => [cells.concepto, cells.categoria],
			),
		).toEqual([
			["Luz", "Servicios"],
			["Almuerzo", "Alimentación"],
		]);
	});

	test("gasolina con tarjeta is Transporte from the concepto or its clause", () => {
		const gasolina = {
			tipo: "Gasto",
			categoria: "Compras",
			monto: 60,
			metodo: "Tarjeta",
		};
		for (const concepto of ["Gasolina", "Tanque lleno"])
			expect(
				cellsOf(GASOLINA, [{ ...gasolina, concepto }]).map(
					(cells) => cells.categoria,
				),
			).toEqual(["Transporte"]);
	});

	test("a salary stays Ingreso even when it names a food word", () => {
		expect(
			cellsOf("Me pagaron el sueldo del restaurante, 900 dólares.", [
				{
					concepto: "Sueldo del restaurante",
					tipo: "Gasto",
					categoria: "Alimentación",
					monto: 900,
					metodo: null,
				},
			]).map(({ tipo, categoria }) => [tipo, categoria]),
		).toEqual([["Ingreso", "Ingreso"]]);
	});

	test("a concepto with no keyword keeps the model's category", () => {
		expect(
			cellsOf("Compré un regalo por 40 con tarjeta.", [
				{
					concepto: "Regalo",
					tipo: "Gasto",
					categoria: "Compras",
					monto: 40,
					metodo: "Tarjeta",
				},
			]).map((cells) => cells.categoria),
		).toEqual(["Compras"]);
	});
});

describe("model output parsing", () => {
	test("skips bad items and falls back on bad enum values", () => {
		expect(
			assemble(
				"Gasté 20 en un viaje y 30 en el cine.",
				JSON.stringify({
					movimientos: [
						"viaje",
						null,
						{ concepto: "Nada", monto: "mucho" },
						{ concepto: "", monto: 5 },
						{ concepto: "Gratis", monto: 0 },
						{
							concepto: "Viaje",
							tipo: "gasto",
							categoria: "Movilidad",
							monto: 20,
							metodo: "Bitcoin",
							fecha: 7,
						},
						{
							concepto: " Cine ",
							tipo: "Regalo",
							categoria: "entretenimiento",
							monto: -30,
						},
					],
				}),
			),
		).toEqual([
			movement({
				concepto: "Viaje",
				tipo: "Gasto",
				categoria: "Otro",
				monto: 20,
			}),
			movement({
				concepto: "Cine",
				tipo: "Gasto",
				categoria: "Entretenimiento",
				monto: 30,
			}),
		]);
	});

	test("reads JSON wrapped in prose and yields null for garbage", () => {
		const wrapped = `Claro:\n\`\`\`json\n${probeOut(QWEN, GASOLINA)}\n\`\`\``;
		expect(assemble(GASOLINA, wrapped)).toHaveLength(1);
		expect(finanzas.assemble(GASOLINA, "no sé", NOW)).toBeNull();
		expect(finanzas.assemble(GASOLINA, '{"filas": []}', NOW)).toBeNull();
		expect(
			finanzas.assemble(GASOLINA, '{"movimientos": {"monto": 60}}', NOW),
		).toBeNull();
	});

	test("reads a spoken amount", () => {
		expect(
			cellsOf("Pagué cuarenta y cinco de luz.", [
				{ concepto: "Luz", tipo: "Gasto", categoria: "Servicios", monto: 45 },
			]),
		).toEqual([
			{
				fecha: TODAY,
				concepto: "Luz",
				tipo: "Gasto",
				categoria: "Servicios",
				monto: 45,
				metodo: null,
			},
		]);
	});
});

describe("fecha", () => {
	const fechaOf = (text: string, fecha: string | null, now = NOW) =>
		cellsOf(
			text,
			[
				{
					concepto: "Taxi",
					tipo: "Gasto",
					categoria: "Transporte",
					monto: 6,
					fecha,
				},
			],
			now,
		)[0].fecha;

	test("null and hoy are today", () => {
		expect(fechaOf("Ayer el taxi fue 6.", null)).toBe(TODAY);
		expect(fechaOf("Hoy el taxi fue 6.", "hoy")).toBe(TODAY);
	});

	test("ayer, anteayer and antier count back from today", () => {
		expect(fechaOf("Ayer el taxi fue 6.", "ayer")).toBe(YESTERDAY);
		expect(fechaOf("Anteayer el taxi fue 6.", "anteayer")).toBe("2026-09-08");
		expect(fechaOf("Antier el taxi fue 6.", "antier")).toBe("2026-09-08");
		expect(
			fechaOf("Ayer el taxi fue 6.", "ayer", new Date(2026, 8, 1, 9)),
		).toBe("2026-08-31");
	});

	test("an explicit day and month resolve in the current year", () => {
		expect(fechaOf("El 15 de agosto el taxi fue 6.", "15 de agosto")).toBe(
			"2026-08-15",
		);
		expect(fechaOf("El quince de agosto el taxi fue 6.", "15 de agosto")).toBe(
			"2026-08-15",
		);
		expect(fechaOf("El 15/08 el taxi fue 6.", "15/08")).toBe("2026-08-15");
		expect(fechaOf("El 15 de agosto el taxi fue 6.", "2026-08-15")).toBe(
			"2026-08-15",
		);
	});

	test("a date the text doesn't contain falls back to today", () => {
		expect(fechaOf("El taxi fue 6.", "ayer")).toBe(TODAY);
		expect(fechaOf("El 15 de agosto el taxi fue 6.", "16 de agosto")).toBe(
			TODAY,
		);
		expect(fechaOf("El 31/02 el taxi fue 6.", "31/02")).toBe(TODAY);
		expect(fechaOf("El taxi fue 6.", "la semana pasada")).toBe(TODAY);
	});
});

describe("metodo", () => {
	const metodoOf = (text: string, metodo: string, monto: number) =>
		cellsOf(text, [
			{ concepto: "Pago", tipo: "Gasto", categoria: "Otro", monto, metodo },
		])[0].metodo;

	test("maps crédito, débito, cash and ACH to the listed methods", () => {
		expect(metodoOf("Pagué 20 del súper con débito.", "Efectivo", 20)).toBe(
			"Tarjeta",
		);
		expect(metodoOf("Pagué 20 con la de crédito.", "Tarjeta", 20)).toBe(
			"Tarjeta",
		);
		expect(metodoOf("Pagué 20 en cash.", "Yappy", 20)).toBe("Efectivo");
		expect(metodoOf("Pagué 20 por ACH.", "Tarjeta", 20)).toBe("Transferencia");
	});

	test("prefers the method in the clause of the row's amount", () => {
		expect(
			cellsOf(LUZ, [
				{
					concepto: "Luz",
					tipo: "Gasto",
					categoria: "Servicios",
					monto: 45,
					metodo: "Efectivo",
				},
				{
					concepto: "Almuerzo",
					tipo: "Gasto",
					categoria: "Alimentación",
					monto: 12,
					metodo: "Yappy",
				},
			]).map((cells) => cells.metodo),
		).toEqual(["Yappy", "Efectivo"]);
	});

	test("a model null stays null even when the text names a method", () => {
		expect(
			cellsOf(GASOLINA, [
				{
					concepto: "Gasolina",
					tipo: "Gasto",
					categoria: "Transporte",
					monto: 60,
					metodo: null,
				},
			])[0].metodo,
		).toBeNull();
	});
});

describe("tipo", () => {
	const tipoOf = (
		text: string,
		monto: number,
		concepto = "Pago",
		tipo = "Gasto",
	) =>
		cellsOf(text, [
			{ concepto, tipo, categoria: "Otro", monto, metodo: null },
		])[0].tipo;

	test("income words override an expense", () => {
		expect(tipoOf("Me depositaron el sueldo, 900.", 900)).toBe("Ingreso");
		expect(tipoOf("Salario de 1,500 dólares.", 1500)).toBe("Ingreso");
		expect(tipoOf("Me pagaron 120 por la mudanza.", 120)).toBe("Ingreso");
		expect(tipoOf("Cobré 75 de una deuda.", 75)).toBe("Ingreso");
		expect(tipoOf("Vendí la bicicleta en 90.", 90)).toBe("Ingreso");
	});

	test("saving beats income in the same clause", () => {
		expect(tipoOf("Ahorré 100 de la quincena.", 100)).toBe("Ahorro");
	});

	test("an unbacked amount finds its clause by concepto words", () => {
		const [draft] = assemble(
			"Cobré lo del trabajo extra y pagué 20 de taxi.",
			modelText([
				{
					concepto: "Trabajo extra",
					tipo: "Gasto",
					categoria: "Otro",
					monto: 100,
					metodo: null,
				},
			]),
		);
		expect(draft).toEqual(
			movement(
				{
					concepto: "Trabajo extra",
					tipo: "Ingreso",
					categoria: "Ingreso",
					monto: 100,
				},
				["monto"],
			),
		);
	});

	test("the model's tipo stands when its clause has no keyword", () => {
		expect(
			tipoOf("Me llegaron 80 de la venta del carro.", 80, "Venta", "Ingreso"),
		).toBe("Ingreso");
		expect(tipoOf(QUINCENA, 100, "Pago", "Gasto")).toBe("Ahorro");
		expect(tipoOf(LUZ, 45, "Luz", "Gasto")).toBe("Gasto");
	});
});

const mov = (overrides: Partial<Movimiento>): Movimiento => ({
	fecha: TODAY,
	concepto: "Luz",
	tipo: "Gasto",
	categoria: "Servicios",
	monto: 45,
	metodo: null,
	...overrides,
});

const record = (
	id: string,
	extraction: Movimiento[] | null,
	at = NOW.getTime(),
	unverified: string[] = [],
	source = "",
): SourceRecord<Movimiento[]> => ({ id, at, source, extraction, unverified });

const draftOf = (
	extraction: Movimiento[],
	unverified: string[] = [],
): Draft<Movimiento[]> => ({ extraction, unverified });

describe("parse", () => {
	test("round-trips what assemble and the demo produce", () => {
		const drafts = [
			finanzas.assemble(LUZ, probeOut(QWEN, LUZ), NOW),
			finanzas.assemble(MITAD, probeOut(MEDPSY, MITAD), NOW),
			...finanzas.demo.seed(NOW),
		];
		for (const draft of drafts) {
			const stored = JSON.parse(JSON.stringify(draft?.extraction));
			expect(finanzas.parse(stored)).toEqual(draft?.extraction ?? null);
		}
	});

	test("rejects the whole list when any movement is invalid", () => {
		const valid = mov({});
		for (const bad of [
			{ fecha: "2026-02-30" },
			{ fecha: "10/09/2026" },
			{ fecha: null },
			{ concepto: "  " },
			{ concepto: 7 },
			{ tipo: "gasto" },
			{ categoria: "Movilidad" },
			{ monto: 0 },
			{ monto: -45 },
			{ monto: "45" },
			{ monto: Number.POSITIVE_INFINITY },
			{ metodo: "Bitcoin" },
			{ metodo: undefined },
		]) {
			expect(finanzas.parse([valid, { ...valid, ...bad }])).toBeNull();
		}
		expect(finanzas.parse([valid, null])).toBeNull();
		expect(finanzas.parse([])).toBeNull();
		expect(finanzas.parse({ movimientos: [valid] })).toBeNull();
		expect(finanzas.parse(null)).toBeNull();
	});
});

describe("view", () => {
	const records = [
		record(
			"a",
			[
				mov({
					fecha: "2026-09-08",
					concepto: "Quincena",
					tipo: "Ingreso",
					categoria: "Ingreso",
					monto: 850,
				}),
				mov({
					fecha: TODAY,
					concepto: "Taxi",
					categoria: "Transporte",
					monto: 6,
				}),
			],
			1,
			["1.monto", "1.fecha", "0.metodo"],
			"Me cayó la quincena y el taxi fue 6.",
		),
		record(
			"b",
			[
				mov({ concepto: "Luz", monto: 45 }),
				mov({
					concepto: "Ahorro",
					tipo: "Ahorro",
					categoria: "Ahorro",
					monto: 1100,
				}),
			],
			2,
		),
		record("pending", null, 3),
	];

	test("newest fecha first, then newest record, then spoken order", () => {
		const view = finanzas.view(records, NOW);
		if (view.kind !== "table") throw new Error("finanzas is a table");
		expect(view.headers).toEqual({
			date: "Fecha",
			title: "Concepto",
			subtitle: "Categoría",
			amount: "Monto",
		});
		expect(view.lines.map((line) => line.row.key)).toEqual([
			"b/0",
			"b/1",
			"a/1",
			"a/0",
		]);
	});

	test("signs the amount by tipo and carries the row cells", () => {
		const view = finanzas.view(records, NOW);
		if (view.kind !== "table") throw new Error("finanzas is a table");
		expect(
			view.lines.map(({ date, title, subtitle, amount }) => [
				date,
				title,
				subtitle,
				amount,
			]),
		).toEqual([
			["10 sep", "Luz", "Servicios", { label: "−$45.00", tone: "expense" }],
			["10 sep", "Ahorro", "Ahorro", { label: "$1,100.00", tone: "saving" }],
			["10 sep", "Taxi", "Transporte", { label: "−$6.00", tone: "expense" }],
			["8 sep", "Quincena", "Ingreso", { label: "+$850.00", tone: "income" }],
		]);
		expect(view.lines[2].row).toEqual({
			key: "a/1",
			recordId: "a",
			index: 1,
			cells: {
				fecha: TODAY,
				concepto: "Taxi",
				tipo: "Gasto",
				categoria: "Transporte",
				monto: 6,
				metodo: null,
				texto_original: "Me cayó la quincena y el taxi fue 6.",
			},
			unverified: ["monto", "fecha"],
			factors: null,
		});
		expect(view.lines[3].row.unverified).toEqual(["metodo"]);
	});
});

describe("summary", () => {
	test("totals the current month and rounds the savings rate", () => {
		const records = [
			record("1", [
				mov({
					fecha: "2026-09-01",
					tipo: "Ingreso",
					categoria: "Ingreso",
					monto: 850,
				}),
				mov({ fecha: "2026-09-02", monto: 1200 }),
			]),
			record("2", [mov({ fecha: "2026-09-10", monto: 34.5 })]),
			record("3", [
				mov({
					fecha: "2026-09-05",
					tipo: "Ahorro",
					categoria: "Ahorro",
					monto: 100,
				}),
				mov({
					fecha: "2026-08-31",
					tipo: "Ingreso",
					categoria: "Ingreso",
					monto: 5000,
				}),
				mov({
					fecha: "2025-09-05",
					tipo: "Ingreso",
					categoria: "Ingreso",
					monto: 5000,
				}),
			]),
			record("4", null),
		];
		expect(finanzas.summary(records, NOW)).toEqual([
			{ label: "Ingresos", value: "$850.00", tone: "income" },
			{ label: "Gastos", value: "$1,234.50", tone: "expense" },
			{ label: "Ahorro", value: "$100.00", tone: "saving" },
			{ label: "Tasa de ahorro", value: "12 %", tone: "neutral" },
		]);
	});

	test("no income this month shows Sin ingresos", () => {
		expect(finanzas.summary([record("1", [mov({})])], NOW)).toEqual([
			{ label: "Ingresos", value: "$0.00", tone: "income" },
			{ label: "Gastos", value: "$45.00", tone: "expense" },
			{ label: "Ahorro", value: "$0.00", tone: "saving" },
			{ label: "Tasa de ahorro", value: "Sin ingresos", tone: "neutral" },
		]);
	});
});

describe("csv", () => {
	test("BOM, labels, CRLF, oldest first and a quoted source", () => {
		const csv = finanzas.csv(
			[
				record(
					"new",
					[mov({ concepto: "Luz", metodo: "Yappy" })],
					2,
					[],
					"Luz con Yappy",
				),
				record(
					"old",
					[
						mov({
							fecha: "2026-09-01",
							concepto: "Alquiler",
							categoria: "Vivienda",
							monto: 550,
							metodo: "Transferencia",
						}),
					],
					1,
					[],
					ALQUILER,
				),
				record("pending", null, 3, [], "sin extraer"),
			],
			NOW,
		);
		expect(csv.startsWith("\uFEFF")).toBe(true);
		expect(csv.slice(1).split("\r\n")).toEqual([
			"Fecha,Concepto,Tipo,Categoría,Monto,Método,Texto original",
			'2026-09-01,Alquiler,Gasto,Vivienda,550,Transferencia,"Pagué el alquiler, 550, por transferencia."',
			"2026-09-10,Luz,Gasto,Servicios,45,Yappy,Luz con Yappy",
			"",
		]);
	});
});

describe("edit", () => {
	const draft = draftOf(
		[
			mov({
				concepto: "Quincena",
				tipo: "Ingreso",
				categoria: "Ingreso",
				monto: 850,
			}),
			mov({ concepto: "Luz", monto: 45 }),
		],
		["0.monto", "1.monto", "1.concepto"],
	);
	const edited = (index: number, key: string, value: string | number | null) =>
		finanzas.edit(draft, index, key, value);

	test("coerces monto and clears only that path", () => {
		expect(edited(1, "monto", "86,40")).toEqual({
			extraction: [draft.extraction[0], mov({ concepto: "Luz", monto: 86.4 })],
			unverified: ["0.monto", "1.concepto"],
		});
		expect(edited(1, "monto", 12).extraction[1].monto).toBe(12);
		expect(edited(1, "monto", "1,200").extraction[1].monto).toBe(1200);
		expect(edited(1, "monto", 45).unverified).toEqual([
			"0.monto",
			"1.concepto",
		]);
	});

	test("trims concepto and accepts a real date", () => {
		expect(
			edited(1, "concepto", "  Luz de agosto ").extraction[1].concepto,
		).toBe("Luz de agosto");
		expect(edited(1, "concepto", "x").unverified).toEqual([
			"0.monto",
			"1.monto",
		]);
		expect(edited(0, "fecha", "2026-09-01").extraction[0].fecha).toBe(
			"2026-09-01",
		);
	});

	test("an invalid value leaves the draft unchanged", () => {
		for (const [key, value] of [
			["monto", "abc"],
			["monto", "12abc"],
			["monto", 0],
			["monto", -3],
			["monto", null],
			["concepto", "   "],
			["concepto", 5],
			["fecha", "2026-02-30"],
			["fecha", "1/9/2026"],
			["tipo", "gasto"],
			["categoria", "Movilidad"],
			["metodo", "Bitcoin"],
			["texto_original", "otra cosa"],
			["nada", "x"],
		] as const) {
			expect(edited(1, key, value)).toEqual(draft);
		}
		expect(edited(2, "monto", 10)).toEqual(draft);
		expect(edited(-1, "monto", 10)).toEqual(draft);
	});

	test("tipo drags categoria along", () => {
		const luz = (tipo: string) => edited(1, "tipo", tipo).extraction[1];
		expect([luz("Ingreso").tipo, luz("Ingreso").categoria]).toEqual([
			"Ingreso",
			"Ingreso",
		]);
		expect(luz("Ahorro").categoria).toBe("Ahorro");
		expect(luz("Gasto").categoria).toBe("Servicios");
		const quincena = edited(0, "tipo", "Gasto").extraction[0];
		expect([quincena.tipo, quincena.categoria]).toEqual(["Gasto", "Otro"]);
	});

	test("categoria and metodo take listed options, metodo also clears", () => {
		expect(edited(1, "categoria", "Vivienda").extraction[1].categoria).toBe(
			"Vivienda",
		);
		const yappy = finanzas.edit(draft, 1, "metodo", "Yappy");
		expect(yappy.extraction[1].metodo).toBe("Yappy");
		expect(
			finanzas.edit(yappy, 1, "metodo", "").extraction[1].metodo,
		).toBeNull();
		expect(
			finanzas.edit(yappy, 1, "metodo", null).extraction[1].metodo,
		).toBeNull();
	});
});

describe("remove", () => {
	const draft = draftOf(
		[mov({ concepto: "A" }), mov({ concepto: "B" }), mov({ concepto: "C" })],
		["0.monto", "1.monto", "2.monto", "2.fecha"],
	);

	test("drops the movement and renumbers the paths after it", () => {
		expect(finanzas.remove(draft, 1)).toEqual({
			extraction: [mov({ concepto: "A" }), mov({ concepto: "C" })],
			unverified: ["0.monto", "1.monto", "1.fecha"],
		});
		expect(finanzas.remove(draft, 5)).toEqual(draft);
	});

	test("removing the last movement leaves nothing", () => {
		expect(finanzas.remove(draftOf([mov({})], ["0.monto"]), 0)).toBeNull();
	});
});

describe("spec", () => {
	test("fields and labels", () => {
		expect(
			finanzas.fields.map(({ key, label, input }) => [key, label, input.kind]),
		).toEqual([
			["fecha", "Fecha", "date"],
			["concepto", "Concepto", "text"],
			["tipo", "Tipo", "choice"],
			["categoria", "Categoría", "choice"],
			["monto", "Monto", "number"],
			["metodo", "Método", "choice"],
			["texto_original", "Texto original", "readonly"],
		]);
		expect([
			finanzas.label,
			finanzas.subtitle,
			finanzas.sheetTitle,
			finanzas.placeholder,
			finanzas.csvName,
		]).toEqual([
			"Finanzas",
			"Tus movimientos y tu ahorro",
			"Movimientos",
			"Escribe o dicta un movimiento",
			"finanzas.csv",
		]);
		expect(finanzas.followUp).toBeNull();
	});
});

describe("demo", () => {
	test("seeds a verified month of movements", () => {
		const records = finanzas.demo.seed(NOW);
		expect(records.map((entry) => entry.id)).toEqual(
			Array.from({ length: 8 }, (_, at) => `demo-finanzas-${at + 1}`),
		);
		for (const entry of records) {
			expect(entry.unverified).toEqual([]);
			expect(entry.at).toBeLessThanOrEqual(NOW.getTime());
			expect(entry.extraction).toHaveLength(1);
			expect(String(entry.extraction?.[0].fecha) >= "2026-09-01").toBe(true);
			expect(String(entry.extraction?.[0].fecha) <= TODAY).toBe(true);
		}
		expect(records.map((entry) => entry.extraction?.[0].metodo)).toEqual([
			"Transferencia",
			"Transferencia",
			"Yappy",
			"Tarjeta",
			"Yappy",
			null,
			"Tarjeta",
			"Efectivo",
		]);
		expect(finanzas.summary(records, NOW)).toEqual([
			{ label: "Ingresos", value: "$850.00", tone: "income" },
			{ label: "Gastos", value: "$739.90", tone: "expense" },
			{ label: "Ahorro", value: "$100.00", tone: "saving" },
			{ label: "Tasa de ahorro", value: "12 %", tone: "neutral" },
		]);
	});

	test("early in the month every movement clamps to day 1", () => {
		const now = new Date(2026, 8, 3, 7, 30);
		const records = finanzas.demo.seed(now);
		expect(records).toHaveLength(8);
		for (const entry of records) {
			expect(entry.at).toBeLessThanOrEqual(now.getTime());
			expect(["2026-09-01", "2026-09-02", "2026-09-03"]).toContain(
				String(entry.extraction?.[0].fecha),
			);
		}
	});

	test("the example assembles into the Qwen3 rows", () => {
		expect(finanzas.demo.example).toBe(LUZ);
		expect(finanzas.demo.modelText).toBe(probeOut(QWEN, LUZ));
		expect(
			assemble(finanzas.demo.example, finanzas.demo.modelText),
		).toHaveLength(2);
	});
});
