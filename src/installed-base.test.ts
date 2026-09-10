/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
	appendAnswer,
	confidence,
	confidenceFactors,
	type ExtractedUnit,
	type Extraction,
	extractionRequest,
	fleetSummary,
	installedBase,
	nextQuestion,
	parseExtraction,
	toCsv,
	type Visit,
} from "./installed-base";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 10, 12);

const unit = (overrides: Partial<ExtractedUnit> = {}): ExtractedUnit => ({
	modalidad: "Resonancia magnética",
	cantidad: 1,
	marca: "Philips",
	modelo: null,
	antiguedad_anios: null,
	estado: "Confirmado",
	...overrides,
});

const extraction = (overrides: Partial<Extraction> = {}): Extraction => ({
	cliente: "Hospital DemoCare Pacific",
	ciudad: null,
	pais: "Panamá",
	equipos: [unit()],
	...overrides,
});

const visit = (
	id: string,
	at: number,
	overrides: Partial<Extraction> = {},
): Visit => ({ id, at, said: id, extraction: extraction(overrides) });

describe("parseExtraction", () => {
	test("reads JSON wrapped in model chatter", () => {
		const response = `Claro, aquí está:\n\`\`\`json\n${JSON.stringify({
			cliente: "  Clínica San Rafael ",
			ciudad: "",
			pais: "Colombia",
			equipos: [
				{
					modalidad: "tomografia",
					cantidad: "2",
					marca: " Siemens",
					modelo: "",
					antiguedad_anios: "11",
					estado: "reportado",
				},
			],
		})}\n\`\`\`\nEspero que sirva.`;
		expect(parseExtraction(response)).toEqual({
			cliente: "Clínica San Rafael",
			ciudad: null,
			pais: "Colombia",
			equipos: [
				{
					modalidad: "Tomografía",
					cantidad: 2,
					marca: "Siemens",
					modelo: null,
					antiguedad_anios: 11,
					estado: "Reportado",
				},
			],
		});
	});

	test("maps an unknown modality to Otro and an unknown estado to Desconocido", () => {
		const parsed = parseExtraction(
			'{"cliente":"Hospital Nacional","equipos":[{"modalidad":"Rayos gamma","cantidad":-1,"estado":"quizás"}, "basura"]}',
		);
		expect(parsed?.equipos).toEqual([
			{
				modalidad: "Otro",
				cantidad: null,
				marca: null,
				modelo: null,
				antiguedad_anios: null,
				estado: "Desconocido",
			},
		]);
	});

	test("returns null when nothing usable came back", () => {
		expect(parseExtraction("")).toBeNull();
		expect(parseExtraction("No entendí la grabación.")).toBeNull();
		expect(parseExtraction('{"cliente": ""')).toBeNull();
		expect(
			parseExtraction('{"cliente":" ","ciudad":null,"pais":null,"equipos":[]}'),
		).toBeNull();
	});
});

describe("extractionRequest", () => {
	test("tells the model the current year and the status vocabulary", () => {
		const request = extractionRequest("Vi un Ingenia", new Date(NOW));
		const system = request.history[0]?.content ?? "";
		expect(system).toContain("2026");
		expect(system).toContain("11 años");
		for (const status of ["Confirmado", "Reportado", "Estimado", "Desconocido"])
			expect(system).toContain(status);
		expect(request.history[1]).toEqual({
			role: "user",
			content: "Vi un Ingenia",
		});
		expect(request.generationParams).toEqual({ temp: 0, predict: 512 });
	});
});

describe("installedBase", () => {
	test("merges the same unit across two visits", () => {
		const [base, ...others] = installedBase(
			[
				visit("second", NOW - 10 * DAY, {
					cliente: "hospital democare pacific.",
					ciudad: "Panamá",
					equipos: [
						unit({ cantidad: 2, modelo: "Ingenia", estado: "Confirmado" }),
						unit({ modalidad: "Tomografía", marca: "Canon" }),
					],
				}),
				visit("first", NOW - 40 * DAY, {
					equipos: [unit({ cantidad: 2, estado: "Estimado" })],
				}),
			],
			NOW,
		);
		expect(others).toEqual([]);
		expect(base?.name).toBe("hospital democare pacific.");
		expect(base?.city).toBe("Panamá");
		expect(base?.country).toBe("Panamá");
		expect(base?.units).toHaveLength(2);
		expect(base?.units[0]).toMatchObject({
			modality: "Resonancia magnética",
			brand: "Philips",
			model: "Ingenia",
			quantity: 2,
			confirmations: 2,
			status: "Confirmado",
			lastSeenAt: NOW - 10 * DAY,
		});
	});

	test("keeps two entries from one visit as separate units", () => {
		const [base] = installedBase(
			[
				visit("only", NOW, {
					equipos: [
						unit({ antiguedad_anios: 8, estado: "Estimado" }),
						unit({ estado: "Confirmado" }),
					],
				}),
			],
			NOW,
		);
		expect(base?.units.map((u) => u.ageYears)).toEqual([8, null]);
	});

	test("does not merge units whose brands differ", () => {
		const [base] = installedBase(
			[
				visit("a", NOW - DAY, { equipos: [unit({ marca: "Siemens" })] }),
				visit("b", NOW, { equipos: [unit({ marca: "GE" })] }),
			],
			NOW,
		);
		expect(base?.units).toHaveLength(2);
	});

	test("ages the most recent reported age by whole years elapsed", () => {
		const [base] = installedBase(
			[
				visit("old", Date.UTC(2020, 0, 15), {
					equipos: [unit({ antiguedad_anios: 3 })],
				}),
				visit("newer", Date.UTC(2023, 5, 1), {
					equipos: [unit({ antiguedad_anios: 5 })],
				}),
				visit("latest", Date.UTC(2026, 0, 1), { equipos: [unit()] }),
			],
			NOW,
		);
		expect(base?.units[0]?.ageYears).toBe(8);
		expect(base?.units[0]?.renewal).toBe(true);
	});

	test("flags renewal at eight years and staleness after 180 days", () => {
		const ageAndStale = (age: number, daysAgo: number) => {
			const [base] = installedBase(
				[
					visit("v", NOW - daysAgo * DAY, {
						equipos: [unit({ antiguedad_anios: age })],
					}),
				],
				NOW,
			);
			return { renewal: base?.units[0]?.renewal, stale: base?.units[0]?.stale };
		};
		expect(ageAndStale(7, 179)).toEqual({ renewal: false, stale: false });
		expect(ageAndStale(8, 181)).toEqual({ renewal: true, stale: true });
	});

	test("skips visits without a client and sorts clients by latest visit", () => {
		const bases = installedBase(
			[
				visit("a", NOW - 5 * DAY, { cliente: "Hospital Santo Tomás" }),
				visit("b", NOW - DAY, { cliente: "Clínica Las Condes" }),
				visit("c", NOW, { cliente: null }),
				{ id: "d", at: NOW, said: "sin extraer", extraction: null },
			],
			NOW,
		);
		expect(bases.map((base) => base.name)).toEqual([
			"Clínica Las Condes",
			"Hospital Santo Tomás",
		]);
	});
});

describe("confidence", () => {
	test("adds the documented points for one worked case", () => {
		const [base] = installedBase(
			[
				visit("v", NOW, {
					equipos: [unit({ antiguedad_anios: 8, estado: "Estimado" })],
				}),
			],
			NOW,
		);
		expect(base?.units[0]?.confidence).toBe(53);
		expect(
			confidenceFactors({
				brand: "Philips",
				model: null,
				ageYears: 8,
				located: true,
				status: "Estimado",
				confirmations: 1,
				stale: false,
			}),
		).toEqual([
			{ label: "Marca", points: 15 },
			{ label: "Antigüedad", points: 15 },
			{ label: "Ubicación", points: 15 },
			{ label: "Estimado", points: 8 },
		]);
	});

	test("clamps to 0 and 100", () => {
		expect(
			confidence({
				brand: null,
				model: null,
				ageYears: null,
				located: false,
				status: "Desconocido",
				confirmations: 1,
				stale: true,
			}),
		).toBe(0);
		expect(
			confidence({
				brand: "Philips",
				model: "Ingenia",
				ageYears: 3,
				located: true,
				status: "Confirmado",
				confirmations: 3,
				stale: false,
			}),
		).toBe(100);
	});
});

describe("fleetSummary", () => {
	test("counts null quantity as one and orders modalities by units", () => {
		const summary = fleetSummary(
			installedBase(
				[
					visit("a", NOW, {
						cliente: "Hospital Santo Tomás",
						equipos: [
							unit({ modalidad: "Rayos X", cantidad: 3, marca: null }),
							unit({ cantidad: null, antiguedad_anios: 10 }),
						],
					}),
					visit("b", NOW - 200 * DAY, {
						cliente: "Hospital Nacional",
						equipos: [unit({ modalidad: "Ultrasonido", cantidad: 2 })],
					}),
				],
				NOW,
			),
		);
		expect(summary).toEqual({
			clients: 2,
			units: 6,
			byModality: [
				{ modality: "Rayos X", units: 3 },
				{ modality: "Ultrasonido", units: 2 },
				{ modality: "Resonancia magnética", units: 1 },
			],
			renewals: 1,
			stale: 2,
		});
	});
});

describe("nextQuestion", () => {
	test("asks for the most valuable missing datum first", () => {
		const tomograph = unit({ modalidad: "Tomografía", marca: null });
		expect(
			nextQuestion(extraction({ cliente: null, equipos: [tomograph] })),
		).toBe("¿En qué hospital o clínica estás?");
		expect(nextQuestion(extraction({ pais: null, equipos: [tomograph] }))).toBe(
			"¿De qué marca es el tomógrafo?",
		);
		expect(
			nextQuestion(
				extraction({
					pais: null,
					equipos: [unit({ modalidad: "Medicina nuclear" })],
				}),
			),
		).toBe("¿Qué antigüedad tiene la gammacámara?");
		expect(
			nextQuestion(
				extraction({ pais: null, equipos: [unit({ antiguedad_anios: 4 })] }),
			),
		).toBe("¿En qué ciudad está Hospital DemoCare Pacific?");
		expect(
			nextQuestion(extraction({ equipos: [unit({ antiguedad_anios: 4 })] })),
		).toBeNull();
	});
});

describe("appendAnswer", () => {
	test("appends the question and answer, ignoring a blank answer", () => {
		expect(
			appendAnswer(
				"Vi un tomógrafo. ",
				"¿De qué marca es el tomógrafo?",
				" Siemens ",
			),
		).toBe(
			"Vi un tomógrafo.\nPregunta: ¿De qué marca es el tomógrafo?\nRespuesta: Siemens",
		);
		expect(appendAnswer("Vi un tomógrafo.", "¿Marca?", "  ")).toBe(
			"Vi un tomógrafo.",
		);
	});
});

describe("toCsv", () => {
	test("quotes cells with commas, quotes, or newlines and leaves nulls empty", () => {
		const csv = toCsv(
			installedBase(
				[
					visit("v", NOW, {
						cliente: 'Clínica "La Paz", Sede Norte',
						equipos: [unit({ modelo: "Ingenia\n1.5T" })],
					}),
				],
				NOW,
			),
		);
		expect(csv.charCodeAt(0)).toBe(0xfeff);
		expect(csv.slice(1).split("\r\n")).toEqual([
			"Cliente,Ciudad,País,Modalidad,Cantidad,Marca,Modelo,Antigüedad (años),Estado,Confirmaciones,Confianza,Última visita",
			'"Clínica ""La Paz"", Sede Norte",,Panamá,Resonancia magnética,1,Philips,"Ingenia\n1.5T",,Confirmado,1,70,2026-09-10',
		]);
	});
});
