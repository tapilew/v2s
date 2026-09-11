/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { groundDate, supportedDates, weekdayDate } from "./dates";
import {
	assemble,
	demoListText,
	demoRowsText,
	HARNESS,
	newSheetJob,
	parseList,
	updateSheetJob,
} from "./index";

// Thursday 10 September 2026, mid-day.
const NOW = new Date(2026, 8, 10, 12, 0, 0);

// Raw model output captured by the v3 probe (list step, then rows step) on the phone.
const V3 = {
	finanzasNew: {
		text: "Hoy pagué 45 dólares de luz con Yappy y 12 de almuerzo en efectivo. Me cayó la quincena, 850.",
		list: '{"elementos":["45 dólares de luz","Yappy","12 de almuerzo","efectivo","Me cayó la quincena","850"]}',
		rows: '{"titulo":"Movimientos","columnas":["Fecha","Concepto","Tipo","Categoría","Monto","Método"],"filas":[["2026-09-10","Luz","Gasto","Alimentación","45","Yappy"],["2026-09-10","Almuerzo","Gasto","Alimentación","12","efectivo"],["2026-02-10","Quincena","Ahorro","Ahorro","850","Me cayó la quincena"],["2026-09-10","Cuenta de ahorros","Ahorro","Ahorro","20",""],[ "2026-09-10","Cuenta de ahorros","Ahorro","Ahorro","20",""],[ "2026-09-10","Cuenta de ahorros","Ahorro","Ahorro","20",""]]}',
	},
	finanzasWeek: {
		text: "Esta semana: lunes gasolina 30, martes farmacia 18.50 con tarjeta, jueves recibí 120 por un trabajo extra y ahorré 50.",
		rows: '{"titulo":"Movimientos","columnas":["Fecha","Concepto","Tipo","Categoría","Monto","Método"],"filas":[["2026-09-10","Gasolina","Gasto","Combustible","30",""],["2026-09-10","Farmacia","Gasto","Salud","18.50",""],["2026-09-10","Recibí","Ingreso","Trabajo","120",""],["2026-09-10","Ahorro","Ahorro","Ahorro","50",""]]}',
	},
	finanzasUpdate: {
		text: "Ayer pagué el internet, 35 dólares, y Netflix, 15.99.",
		columns: ["Fecha", "Concepto", "Tipo", "Categoría", "Monto", "Método"],
		rows: '{"filas": [["2026-09-10","Internet","Gasto","Servicios","35","Tarjeta"],["2026-09-10","Netflix","Gasto","Servicios","15.99",""],["2026-09-10","Netflix","Gasto","Servicios","15.99",""],[ "2026-09-10","Netflix","Gasto","Servicios","15.99",""]] }',
	},
	saludNew: {
		text: "Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores Philips y un tomógrafo. Uno de los resonadores parece de unos ocho años.",
		rows: '{"titulo":"Equipos Hospital DemoCare Pacific","columnas":["Hospital","Modalidad","Cantidad","Marca","Antigüedad","Estado"],"filas":[["Hospital DemoCare Pacific","Resonancia Magnética","2","Philips","8-10 años","Estimado"],["Hospital DemoCare Pacific","Tomógrafo","1","","","Confirmado"]]}',
	},
	saludUpdate: {
		text: "En la Clínica San Rafael de Medellín tienen un ecógrafo GE Logiq nuevo y me dijeron que el tomógrafo Siemens es de 2015.",
		columns: [
			"Cliente",
			"Modalidad",
			"Cantidad",
			"Marca",
			"Antigüedad",
			"Estado",
		],
		rows: '{"filas": [["Clínica San Rafael de Medellín","Ultrasonido","1","GE","2023","Nuevo"],\n\n["Clínica San Rafael de Medellín","Tomografía","1","Siemens","8","Usado"],\n\n["Clínica San Rafael de Medellín","Resonancia magnética","1","","","Confirmado"],\n\n["Clínica San Rafael de Medellín","ECG","1","","","Confirmado"]]\n\n}',
	},
	// The rows step ran out of tokens mid-array; the JSON never closes.
	saludTruncated: {
		text: "Paciente María González, 42 años. Fiebre y tos desde hace tres días, alérgica a la penicilina. Temperatura 38,5, saturación 96.",
		rows: '{"titulo":"Historial Clínico","columnas":["Paciente","Edad","Síntomas","Alergias","Temperatura","Saturación"],"filas":[["Paciente María González","42 años","Fiebre y tos desde hace tres días","alérgica a la penicilina","38,5","96"],\n\n    ["Paciente María González","42 años","Fiebre y tos',
	},
};

describe("dates", () => {
	test("names the days the text supports", () => {
		expect(supportedDates("Pagué la luz", NOW).dates).toEqual(["2026-09-10"]);
		expect(supportedDates("Ayer pagué", NOW).dates).toEqual(["2026-09-09"]);
		expect(supportedDates("anteayer", NOW).dates).toEqual(["2026-09-08"]);
		expect(supportedDates("el lunes y el jueves", NOW).dates).toEqual([
			"2026-09-07",
			"2026-09-10",
		]);
		expect(supportedDates("el 3 de septiembre", NOW).dates).toEqual([
			"2026-09-03",
		]);
		expect(supportedDates("el 28/8 pagué", NOW).dates).toEqual(["2026-08-28"]);
		expect(supportedDates("en 2015", NOW).hasYear).toBe(true);
	});

	test("weekdayDate is the most recent such day on or before today", () => {
		expect(weekdayDate(4, NOW).getDate()).toBe(10);
		expect(weekdayDate(5, NOW).getDate()).toBe(4);
	});

	test("groundDate keeps supported dates and otherwise picks the only named day or today", () => {
		expect(groundDate("2026-02-10", supportedDates("quincena", NOW), NOW)).toBe(
			"2026-09-10",
		);
		expect(groundDate("2026-09-10", supportedDates("ayer", NOW), NOW)).toBe(
			"2026-09-09",
		);
		expect(
			groundDate("2026-09-01", supportedDates("lunes y martes", NOW), NOW),
		).toBe("2026-09-10");
		expect(groundDate("2015-01-01", supportedDates("de 2015", NOW), NOW)).toBe(
			"2015-01-01",
		);
	});
});

describe("parseList", () => {
	test("reads the elements and caps them at twelve", () => {
		expect(parseList(V3.finanzasNew.list)).toEqual([
			"45 dólares de luz",
			"Yappy",
			"12 de almuerzo",
			"efectivo",
			"Me cayó la quincena",
			"850",
		]);
		const many = JSON.stringify({
			elementos: Array.from({ length: 15 }, (_, i) => `e${i}`),
		});
		expect(parseList(many)).toHaveLength(12);
		expect(parseList('{"elementos":[]}')).toBeNull();
		expect(parseList("nada")).toBeNull();
	});
});

describe("assemble", () => {
	test("finanzas new: drops padded duplicate rows with no support, fixes the quincena date", () => {
		const result = assemble(V3.finanzasNew.text, V3.finanzasNew.rows, NOW);
		expect(result?.title).toBe("Movimientos");
		expect(result?.rows.map((row) => row.cells[1])).toEqual([
			"Luz",
			"Almuerzo",
			"Quincena",
		]);
		expect(result?.rows.map((row) => row.cells[4])).toEqual([45, 12, 850]);
		expect(result?.rows[2].cells[0]).toBe("2026-09-10");
		expect(result?.rows.every((row) => row.unverified.length === 0)).toBe(true);
	});

	test("finanzas week: every amount grounds and dates stay today when several days are named", () => {
		const result = assemble(V3.finanzasWeek.text, V3.finanzasWeek.rows, NOW);
		expect(result?.rows).toHaveLength(4);
		expect(result?.rows.map((row) => row.cells[4])).toEqual([
			30, 18.5, 120, 50,
		]);
		expect(result?.rows.map((row) => row.cells[0])).toEqual([
			"2026-09-10",
			"2026-09-10",
			"2026-09-10",
			"2026-09-10",
		]);
	});

	test("finanzas update: dedupes Netflix and corrects 'ayer'", () => {
		const { text, columns, rows } = V3.finanzasUpdate;
		const result = assemble(text, rows, NOW, columns);
		expect(result?.title).toBeNull();
		expect(result?.columns).toEqual(columns);
		expect(result?.rows.map((row) => row.cells)).toEqual([
			["2026-09-09", "Internet", "Gasto", "Servicios", 35, "Tarjeta"],
			["2026-09-09", "Netflix", "Gasto", "Servicios", 15.99, null],
		]);
	});

	test("salud new: spoken counts ground, a text age stays text", () => {
		const result = assemble(V3.saludNew.text, V3.saludNew.rows, NOW);
		expect(result?.rows).toHaveLength(2);
		expect(result?.rows[0].cells[2]).toBe(2);
		expect(result?.rows[0].cells[4]).toBe("8-10 años");
		expect(result?.rows[1].cells[2]).toBe(1);
		expect(result?.rows.every((row) => row.unverified.length === 0)).toBe(true);
	});

	test("salud update: drops the invented ECG and resonancia rows, flags invented years", () => {
		const { text, columns, rows } = V3.saludUpdate;
		const result = assemble(text, rows, NOW, columns);
		expect(result?.rows.map((row) => row.cells[1])).toEqual([
			"Ultrasonido",
			"Tomografía",
		]);
		expect(result?.rows.map((row) => row.unverified)).toEqual([[4], [4]]);
	});

	test("a truncated rows answer yields nothing rather than a broken sheet", () => {
		expect(
			assemble(V3.saludTruncated.text, V3.saludTruncated.rows, NOW),
		).toBeNull();
	});

	test("a weekday written as the concept moves to the date column and flags the cell", () => {
		const result = assemble(
			"lunes gasolina 30",
			'{"titulo":"M","columnas":["Fecha","Concepto","Monto"],"filas":[["2026-09-10","Lunes","30"]]}',
			NOW,
		);
		expect(result?.rows[0].cells).toEqual(["2026-09-07", null, 30]);
		expect(result?.rows[0].unverified).toEqual([1]);
	});

	test("when no row has support, the first one stays with its numbers flagged", () => {
		const result = assemble(
			"nada que ver",
			'{"titulo":"T","columnas":["A","B"],"filas":[["Inventado","7"],["Otro","9"]]}',
			NOW,
		);
		expect(result?.rows).toHaveLength(1);
		expect(result?.rows[0].unverified).toEqual([1]);
	});

	test("a folded element can become two rows; padding beyond that is dropped", () => {
		const result = assemble(
			"Vi dos resonadores Philips y un tomógrafo.",
			'{"titulo":"Equipos","columnas":["Modalidad","Cantidad","Marca"],"filas":[["Resonancia magnética","2","Philips"],["Tomografía","1",""],["Tomografía","1",""],["Mamografía","3",""]]}',
			NOW,
		);
		expect(result?.rows.map((row) => row.cells[0])).toEqual([
			"Resonancia magnética",
			"Tomografía",
		]);
	});

	test("tolerates prose around the JSON, pads and truncates rows", () => {
		const result = assemble(
			"gasolina dos veces, aceite",
			'Claro: {"titulo":"T","columnas":["A","B","C"],"filas":[["gasolina"],["aceite","2","3","4"],["","",""]]} listo',
			NOW,
		);
		expect(result?.rows.map((row) => row.cells)).toEqual([
			["gasolina", null, null],
			["aceite", 2, 3],
		]);
		expect(result?.rows[1].unverified).toEqual([2]);
	});

	test("returns null for junk, one column, or no rows", () => {
		expect(assemble("x", "sin json", NOW)).toBeNull();
		expect(
			assemble("x", '{"titulo":"T","columnas":["A"],"filas":[["1"]]}', NOW),
		).toBeNull();
		expect(
			assemble("x", '{"titulo":"T","columnas":["A","B"],"filas":[]}', NOW),
		).toBeNull();
	});
});

describe("requests", () => {
	test("a new-sheet job lists first, then asks for exactly one row per element", () => {
		const job = newSheetJob("finanzas", "Pagué 10", NOW);
		expect(job.columns).toBeNull();
		expect(job.list.history[1].content).toBe('Texto: "Pagué 10"');
		expect(job.list.responseFormat.json_schema.schema).toMatchObject({
			required: ["elementos"],
		});
		const rows = job.rows(["Pagué 10", "otro"]);
		expect(rows.history[0].content).toContain("hoy es 2026-09-10");
		expect(rows.history[0].content).toContain("Ejemplo");
		expect(rows.history[1].content).toBe(
			'Texto: "Pagué 10"\nElementos: ["Pagué 10","otro"]',
		);
		expect(rows.responseFormat.json_schema.schema).toMatchObject({
			properties: { filas: { minItems: 2, maxItems: 5 } },
		});
		expect(rows.generationParams).toEqual({ temp: 0, predict: 500 });
	});

	test("an update job pins the row width to the sheet's columns and shows sample rows", () => {
		const sheet = {
			id: "s",
			name: "M",
			mode: "salud" as const,
			columns: ["Cliente", "Modalidad"],
			rows: [{ id: "r1", cells: ["A", "TAC"], sourceId: "x", unverified: [] }],
			sources: [],
			createdAt: 0,
			updatedAt: 0,
		};
		const job = updateSheetJob("salud", "otra", sheet, NOW);
		expect(job.columns).toEqual(["Cliente", "Modalidad"]);
		const rows = job.rows(["otra"]);
		expect(rows.history[0].content).toContain("Columnas: Cliente | Modalidad");
		expect(rows.history[0].content).toContain('[["A","TAC"]]');
		expect(rows.responseFormat.json_schema.schema).toMatchObject({
			properties: {
				filas: {
					minItems: 1,
					maxItems: 4,
					items: { minItems: 2, maxItems: 2 },
				},
			},
		});
	});

	test("more than twelve elements are capped", () => {
		const job = newSheetJob("finanzas", "x", NOW);
		const rows = job.rows(Array.from({ length: 20 }, (_, i) => `e${i}`));
		expect(rows.responseFormat.json_schema.schema).toMatchObject({
			properties: { filas: { minItems: 12, maxItems: 15 } },
		});
	});
});

describe("demo", () => {
	test("canned list and rows assemble for both modes", () => {
		for (const mode of ["finanzas", "salud"] as const) {
			const { demo } = HARNESS[mode];
			expect(parseList(demoListText(mode, null))).not.toBeNull();
			const made = assemble(demo.sentence, demoRowsText(mode, null), NOW);
			expect(made?.rows.length).toBeGreaterThan(0);
			expect(made?.rows.every((row) => row.unverified.length === 0)).toBe(true);
			const columns = made?.columns ?? [];
			expect(parseList(demoListText(mode, columns))).not.toBeNull();
			const grown = assemble(
				demo.updateSentence,
				demoRowsText(mode, columns),
				NOW,
				columns,
			);
			expect(grown?.rows).toHaveLength(2);
			expect(
				grown?.rows.every((row) => row.cells.length === columns.length),
			).toBe(true);
			expect(grown?.rows.every((row) => row.unverified.length === 0)).toBe(
				true,
			);
		}
	});
});
