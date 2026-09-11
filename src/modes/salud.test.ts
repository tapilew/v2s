/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { type ClientGroup, sheetRows } from "../sheet";
import { relativeDay, salud } from "./salud";

const NOW = new Date(2026, 8, 10, 14, 5);
const DAY_MS = 86_400_000;

const exampleDraft = () => {
	const draft = salud.assemble(salud.demo.example, salud.demo.modelText, NOW);
	if (draft === null) throw new Error("the demo example must assemble");
	return draft;
};

const cardsOf = (view: ReturnType<typeof salud.view>): ClientGroup[] =>
	view.kind === "cards" ? view.clients : [];

describe("demo example", () => {
	test("drops the unsaid model name and asks for the tomógrafo brand", () => {
		const draft = exampleDraft();
		expect(draft.unverified).toEqual(["equipos.0.modelo"]);
		expect(draft.extraction.equipos.map((unit) => unit.modelo)).toEqual([
			null,
			null,
			null,
		]);
		expect(salud.followUp?.ask(draft.extraction)).toBe(
			"¿De qué marca es el tomógrafo?",
		);
	});

	test("the flagged unit carries Revisar and its unverified column", () => {
		const record = {
			id: "r1",
			at: NOW.getTime(),
			source: "x",
			...exampleDraft(),
		};
		const [client] = cardsOf(salud.view([record], NOW));
		expect(client.name).toBe("Hospital DemoCare Pacific");
		expect(client.meta).toBe("Panamá · Última visita hoy");
		const [first] = client.units;
		expect(first.row).toMatchObject({ recordId: "r1", index: 0 });
		expect(first.row.unverified).toEqual(["modelo"]);
		expect(first.tags.map((tag) => tag.label)).toEqual(["Renovar", "Revisar"]);
		expect(first.detail).toBe("Philips · 8 años");
		expect(client.units[2].detail).toBe("Marca sin confirmar");
	});
});

describe("seed", () => {
	test("three clients with a renewal and a stale visit", () => {
		const records = salud.demo.seed(NOW);
		for (const record of records) expect(record.unverified).toEqual([]);
		const clients = cardsOf(salud.view(records, NOW));
		expect(clients.map((client) => client.name)).toEqual([
			"Centro Médico Paitilla",
			"Hospital DemoCare Pacific",
			"Clínica San Rafael",
		]);
		const tags = clients.flatMap((client) =>
			client.units.flatMap((unit) => unit.tags.map((tag) => tag.label)),
		);
		expect(tags).toContain("Renovar");
		expect(tags).toContain("Sin verificar");
		expect(salud.summary(records, NOW)).toEqual([
			{ label: "Clientes", value: "3", tone: "neutral" },
			{ label: "Equipos", value: "11", tone: "neutral" },
			{ label: "Resonancia", value: "3", tone: "neutral" },
			{ label: "Mamografía", value: "3", tone: "neutral" },
			{ label: "Tomografía", value: "2", tone: "neutral" },
			{ label: "Por renovar", value: "2", tone: "renewal" },
		]);
	});

	test("csv lists every unit under the equipos header", () => {
		const records = salud.demo.seed(NOW);
		const csv = salud.csv(records, NOW);
		expect(csv.startsWith("\uFEFFCliente,Ciudad,País,Modalidad")).toBe(true);
		expect(csv.trimEnd().split("\r\n").length).toBeGreaterThan(
			sheetRows(salud.view(records, NOW)).length,
		);
	});
});

describe("records without a client", () => {
	test("stay on the sheet under a placeholder name", () => {
		const draft = exampleDraft();
		const record = {
			id: "r1",
			at: NOW.getTime(),
			source: "x",
			...draft,
			extraction: { ...draft.extraction, cliente: null },
		};
		expect(cardsOf(salud.view([record], NOW))[0].name).toBe(
			"Hospital sin identificar 1",
		);
	});
});

describe("edit and remove", () => {
	test("an edit coerces the value and clears its flag", () => {
		const draft = exampleDraft();
		const named = salud.edit(draft, 0, "modelo", " Ingenia ");
		expect(named.extraction.equipos[0].modelo).toBe("Ingenia");
		expect(named.unverified).toEqual([]);
		expect(
			salud.edit(draft, 2, "cantidad", "3").extraction.equipos[2].cantidad,
		).toBe(3);
		expect(salud.edit(draft, 2, "cantidad", "cero")).toBe(draft);
		expect(salud.edit(draft, 2, "estado", "Roto")).toBe(draft);
		expect(salud.edit(draft, 0, "cliente", "").extraction.cliente).toBeNull();
	});

	test("remove renumbers flags and empties to null", () => {
		const draft = {
			...exampleDraft(),
			unverified: ["equipos.0.modelo", "equipos.2.marca", "pais"],
		};
		expect(salud.remove(draft, 1)?.unverified).toEqual([
			"equipos.0.modelo",
			"equipos.1.marca",
			"pais",
		]);
		const single = {
			extraction: {
				...draft.extraction,
				equipos: [draft.extraction.equipos[0]],
			},
			unverified: [],
		};
		expect(salud.remove(single, 0)).toBeNull();
	});
});

describe("parse", () => {
	test("round-trips an extraction and rejects non-objects", () => {
		const { extraction } = exampleDraft();
		expect(salud.parse(JSON.parse(JSON.stringify(extraction)))).toEqual(
			extraction,
		);
		expect(salud.parse([1, 2])).toBeNull();
		expect(salud.parse("texto")).toBeNull();
	});
});

describe("relativeDay", () => {
	test("reads days, months and years", () => {
		const now = NOW.getTime();
		expect(relativeDay(now, now)).toBe("hoy");
		expect(relativeDay(now - 1.5 * DAY_MS, now)).toBe("ayer");
		expect(relativeDay(now - 214 * DAY_MS, now)).toBe("hace 7 meses");
		expect(relativeDay(now - 400 * DAY_MS, now)).toBe("hace 1 año");
	});
});
