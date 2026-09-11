/// <reference types="bun-types" />
import { describe, expect, mock, test } from "bun:test";
import type { Extraction } from "./installed-base";

mock.module("expo-file-system", () => ({ File: class {}, Paths: {} }));

const extraction: Extraction = {
	cliente: "Hospital DemoCare Pacific",
	ciudad: null,
	pais: "Panamá",
	equipos: [
		{
			modalidad: "Tomografía",
			cantidad: 1,
			marca: null,
			modelo: null,
			antiguedad_anios: null,
			estado: "Confirmado",
		},
	],
};

describe("parseVisits", () => {
	test("keeps good visits, keeps words when the extraction is malformed, drops the rest", async () => {
		const { parseVisits } = await import("./store");
		const text = JSON.stringify([
			{ id: "a", at: 1, said: "vi un tomógrafo", extraction },
			{ id: "b", at: 2, said: "pendiente", extraction: null },
			{ id: "c", at: 3, said: "roto", extraction: "no es un objeto" },
			{ id: "d", at: "ayer", said: "fecha mala", extraction: null },
			{ at: 4, said: "sin id", extraction: null },
			null,
			7,
		]);
		expect(parseVisits(text)).toEqual({
			visits: [
				{ id: "a", at: 1, said: "vi un tomógrafo", extraction },
				{ id: "b", at: 2, said: "pendiente", extraction: null },
				{ id: "c", at: 3, said: "roto", extraction: null },
			],
			dropped: 4,
		});
	});

	test("rejects text that is not a list of visits", async () => {
		const { parseVisits } = await import("./store");
		expect(parseVisits("{")).toBeNull();
		expect(parseVisits('{"visits": []}')).toBeNull();
	});
});
