/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import cases from "../../eval/equipos.json";
import {
	appendAnswer,
	assembleEquipos,
	confidence,
	confidenceFactors,
	type ExtractedUnit,
	type Extraction,
	equiposCsv,
	equiposRequest,
	equiposRows,
	fleetSummary,
	installedBase,
	nextQuestion,
	parseExtraction,
	type Visit,
} from "./equipos";
import { salud } from "./salud";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 10, 12);
const TODAY = new Date(NOW);

const BRIEF =
	"Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores Philips y un tomógrafo. Uno de los resonadores parece de unos ocho años.";

const caseText = (id: string) =>
	cases.find((entry) => entry.id === id)?.text ?? "";

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
): Visit => ({
	id,
	at,
	source: id,
	extraction: extraction(overrides),
	unverified: [],
});

const captured = (
	id: string,
	at: number,
	text: string,
	modelText: string,
): Visit => {
	const draft = salud.assemble(text, modelText, new Date(at));
	if (draft === null) throw new Error(`${id} must assemble`);
	return { id, at, source: text, ...draft };
};

const resonance = (visits: readonly Visit[]) =>
	fleetSummary(installedBase(visits, NOW)).byModality.find(
		(entry) => entry.modality === "Resonancia magnética",
	)?.units;

const stringFields = (node: unknown): unknown[] => {
	if (typeof node !== "object" || node === null) return [];
	const type = "type" in node ? node.type : undefined;
	const isString =
		type === "string" || (Array.isArray(type) && type.includes("string"));
	return [
		...(isString ? [node] : []),
		...Object.values(node).flatMap(stringFields),
	];
};

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

describe("equiposRequest", () => {
	test("tells the model the current year and the status vocabulary", () => {
		const request = equiposRequest("Vi un Ingenia", TODAY);
		const system = request.history[0]?.content ?? "";
		expect(system).toContain("2026");
		expect(system).toContain("11 años");
		for (const status of ["Confirmado", "Reportado", "Estimado", "Desconocido"])
			expect(system).toContain(status);
		for (const hint of [
			"Ingenia es resonancia magnética Philips",
			"Aquilion es tomografía Canon",
			"Somatom es tomografía Siemens",
			"Logiq es ultrasonido GE",
			"EPIQ es ultrasonido Philips",
			"Azurion es angiografía Philips",
		])
			expect(system).toContain(hint);
		expect(request.history[1]).toEqual({
			role: "user",
			content: "Texto: Vi un Ingenia",
		});
		expect(request.generationParams).toEqual({ temp: 0, predict: 512 });
	});

	test("caps every string at 60 characters and the unit list at 8", () => {
		const { schema } = equiposRequest("", TODAY).responseFormat.json_schema;
		const fields = stringFields(schema);
		expect(fields).toHaveLength(7);
		for (const field of fields) expect(field).toMatchObject({ maxLength: 60 });
		expect(schema.properties.equipos.maxItems).toBe(8);
	});

	test("carries one worked example that is none of the eval sentences", () => {
		const system = equiposRequest("", TODAY).history[0]?.content ?? "";
		expect(system.match(/Ejemplo\./g)).toHaveLength(1);
		expect(system).toContain("ecógrafo Siemens");
		for (const { text } of cases) expect(system).not.toContain(text);
	});
});

describe("assembleEquipos", () => {
	test("turns the Philips brief into two resonators and one tomograph", () => {
		const modelText = JSON.stringify(
			extraction({
				equipos: [
					unit({ antiguedad_anios: 8, estado: "Estimado" }),
					unit(),
					unit({ modalidad: "Tomografía", marca: null }),
				],
			}),
		);
		const grounded = assembleEquipos(BRIEF, modelText, TODAY);
		expect(grounded.unverified).toEqual([]);
		const brief = { id: "brief", at: NOW, source: BRIEF, ...grounded };
		const bases = installedBase([brief], NOW);
		expect(
			bases[0]?.units.map(({ modality, status, age, renewals }) => ({
				modality,
				status,
				age,
				renewals,
			})),
		).toEqual([
			{
				modality: "Resonancia magnética",
				status: "Estimado",
				age: { years: 8, count: 1 },
				renewals: 1,
			},
			{
				modality: "Resonancia magnética",
				status: "Confirmado",
				age: null,
				renewals: 0,
			},
			{
				modality: "Tomografía",
				status: "Confirmado",
				age: null,
				renewals: 0,
			},
		]);
		expect(nextQuestion(brief, bases)).toBe("¿De qué marca es el tomógrafo?");
	});

	test("drops a model the text never said", () => {
		const modelText = JSON.stringify(
			extraction({ equipos: [unit({ cantidad: 2, modelo: "Achieva" })] }),
		);
		expect(assembleEquipos(BRIEF, modelText, TODAY)).toEqual({
			extraction: extraction({
				equipos: [unit({ cantidad: 2, estado: "Estimado" })],
			}),
			unverified: ["equipos.0.modelo"],
		});
	});

	test("grounds an age in a year said in the text, not the year itself", () => {
		const text = "En la Clínica San Rafael el tomógrafo Siemens es de 2015.";
		const aged = (age: number) =>
			assembleEquipos(
				text,
				JSON.stringify(
					extraction({
						cliente: "Clínica San Rafael",
						pais: null,
						equipos: [
							unit({
								modalidad: "Tomografía",
								marca: "Siemens",
								cantidad: null,
								antiguedad_anios: age,
							}),
						],
					}),
				),
				TODAY,
			);
		expect(aged(11).extraction?.equipos[0]?.antiguedad_anios).toBe(11);
		expect(aged(12).extraction?.equipos[0]?.antiguedad_anios).toBe(11);
		expect(aged(2015).unverified).toEqual(["equipos.0.antiguedad_anios"]);
		expect(aged(13).unverified).toEqual(["equipos.0.antiguedad_anios"]);
	});

	test("grounds a quantity in a Spanish number word", () => {
		const text =
			"Hospital Santo Tomás. Hay tres equipos de rayos X portátiles.";
		const counted = (cantidad: number) =>
			assembleEquipos(
				text,
				JSON.stringify(
					extraction({
						cliente: "Hospital Santo Tomás",
						pais: null,
						equipos: [unit({ modalidad: "Rayos X", marca: null, cantidad })],
					}),
				),
				TODAY,
			);
		expect(counted(3).extraction?.equipos[0]?.cantidad).toBe(3);
		expect(counted(4)).toMatchObject({
			extraction: { equipos: [{ cantidad: null }] },
			unverified: ["equipos.0.cantidad"],
		});
	});

	test("accepts a brand only through a product line of the same modality", () => {
		const text = "Pasé por el Centro Médico Paitilla. Tienen un Aquilion.";
		const branded = (marca: string) =>
			assembleEquipos(
				text,
				JSON.stringify(
					extraction({
						cliente: "Centro Médico Paitilla",
						pais: null,
						equipos: [unit({ modalidad: "Tomografía", marca })],
					}),
				),
				TODAY,
			);
		expect(branded("Canon").unverified).toEqual([]);
		expect(branded("Philips").unverified).toEqual(["equipos.0.marca"]);
	});

	test("drops units without modality evidence and indexes paths by kept units", () => {
		const modelText = JSON.stringify(
			extraction({
				cliente: "Hospital Inventado",
				pais: "Panamá",
				equipos: [
					unit({ modalidad: "Mamografía" }),
					unit({ modalidad: "Tomografía", marca: null, modelo: "Achieva" }),
				],
			}),
		);
		expect(
			assembleEquipos("Vi un tomógrafo en Panamá.", modelText, TODAY),
		).toEqual({
			extraction: {
				cliente: null,
				ciudad: null,
				pais: "Panamá",
				equipos: [unit({ modalidad: "Tomografía", marca: null })],
			},
			unverified: ["cliente", "equipos.0.modelo"],
		});
	});

	test("MedPsy e1: the country filed as the city moves to pais and the aged resonator is Estimado", () => {
		const raw =
			'{"cliente":"Hospital DemoCare Pacific","ciudad":"Panamá","pais":null,"equipos":[{"modalidad":"Resonancia magnética","cantidad":2,"marca":"Philips","modelo":"Aquilion","antiguedad_anios":8,"estado":"Confirmado"},{"modalidad":"Tomografía","cantidad":1,"marca":"Siemens","modelo":"Somatom","antiguedad_anios":null,"estado":"Reportado"}] }';
		expect(assembleEquipos(caseText("e1"), raw, TODAY)).toEqual({
			extraction: extraction({
				ciudad: null,
				pais: "Panamá",
				equipos: [
					unit({ cantidad: 2, antiguedad_anios: 8, estado: "Estimado" }),
					unit({ modalidad: "Tomografía", marca: null, estado: "Reportado" }),
				],
			}),
			unverified: ["equipos.0.modelo", "equipos.1.marca", "equipos.1.modelo"],
		});
	});

	test("MedPsy e2: pais comes from the text, age 10 snaps to 2015's 11 and me dijo reports the tomógrafo", () => {
		const raw =
			'{"cliente":"Clínica San Rafael de Medellín","ciudad":"Medellín","pais":null,"equipos":[{"modalidad":"Ultrasonido","cantidad":1,"marca":"GE","modelo":"Logiq E10","antiguedad_anios":7,"estado":"Confirmado"},{"modalidad":"Tomografía","cantidad":1,"marca":"Siemens","modelo":"Somatom CT 160","antiguedad_anios":10,"estado":"Reportado"}] }';
		const expected = {
			extraction: {
				cliente: "Clínica San Rafael de Medellín",
				ciudad: "Medellín",
				pais: "Colombia",
				equipos: [
					unit({ modalidad: "Ultrasonido", marca: "GE", modelo: "Logiq E10" }),
					unit({
						modalidad: "Tomografía",
						marca: "Siemens",
						antiguedad_anios: 11,
						estado: "Reportado",
					}),
				],
			},
			unverified: ["equipos.0.antiguedad_anios", "equipos.1.modelo"],
		};
		expect(assembleEquipos(caseText("e2"), raw, TODAY)).toEqual(expected);
		expect(
			assembleEquipos(
				caseText("e2"),
				raw.replace('"estado":"Reportado"', '"estado":"Confirmado"'),
				TODAY,
			),
		).toEqual(expected);
	});

	test("ciudad de Panamá keeps Panamá as both city and country", () => {
		const text =
			"Centro Médico Paitilla, ciudad de Panamá. Tienen un resonador Siemens.";
		const modelText = JSON.stringify(
			extraction({
				cliente: "Centro Médico Paitilla",
				ciudad: "Panamá",
				pais: null,
				equipos: [unit({ marca: "Siemens" })],
			}),
		);
		expect(assembleEquipos(text, modelText, TODAY).extraction).toMatchObject({
			ciudad: "Panamá",
			pais: "Panamá",
		});
	});

	test("with two years an age snaps only to the year in its unit's sentence", () => {
		const text =
			"En la Clínica San Rafael el tomógrafo Siemens es de 2015. El ecógrafo GE es de 2020.";
		const modelText = JSON.stringify(
			extraction({
				cliente: "Clínica San Rafael",
				pais: null,
				equipos: [
					unit({
						modalidad: "Tomografía",
						marca: "Siemens",
						antiguedad_anios: 7,
					}),
					unit({ modalidad: "Ultrasonido", marca: "GE", antiguedad_anios: 5 }),
				],
			}),
		);
		expect(
			assembleEquipos(text, modelText, TODAY).extraction?.equipos.map(
				(found) => found.antiguedad_anios,
			),
		).toEqual([null, 6]);
	});

	test("returns no extraction when nothing grounded survives", () => {
		const modelText = JSON.stringify(
			extraction({ pais: null, equipos: [unit()] }),
		);
		expect(assembleEquipos("Hola, ¿me escuchas?", modelText, TODAY)).toEqual({
			extraction: null,
			unverified: [],
		});
		expect(assembleEquipos(BRIEF, "no sé", TODAY)).toEqual({
			extraction: null,
			unverified: [],
		});
	});

	test("keeps every gold answer except the age of a unit said to be nuevo", () => {
		const gaps: Record<string, string[]> = {
			e2: ["equipos.0.antiguedad_anios"],
		};
		for (const { id, text, gold } of cases) {
			const { extraction: kept, unverified } = assembleEquipos(
				text,
				JSON.stringify(gold),
				TODAY,
			);
			expect({ id, unverified }).toEqual({ id, unverified: gaps[id] ?? [] });
			expect(kept?.equipos).toHaveLength(gold.equipos.length);
			if (unverified.length === 0) expect<unknown>(kept).toEqual(gold);
		}
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
			sources: ["first", "second"],
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
		expect(base?.units.map((u) => u.age)).toEqual([
			{ years: 8, count: 1 },
			null,
		]);
	});

	test("the demo capture merges into the seeded DemoCare units without growing the fleet", () => {
		const seed = salud.demo.seed(TODAY);
		const capture = captured(
			"capture",
			NOW,
			salud.demo.example,
			salud.demo.modelText,
		);
		const before = fleetSummary(installedBase(seed, NOW));
		const bases = installedBase([...seed, capture], NOW);
		const after = fleetSummary(bases);
		expect(after.units).toBe(before.units);
		expect(resonance([...seed, capture])).toBe(resonance(seed));
		expect(after.renewals - before.renewals).toBeLessThanOrEqual(1);
		const democare = bases.find(
			(base) => base.name === "Hospital DemoCare Pacific",
		);
		const resonators = democare?.units.filter(
			(found) => found.modality === "Resonancia magnética",
		);
		expect(resonators).toHaveLength(1);
		expect(resonators?.[0]).toMatchObject({
			brand: "Philips",
			model: "Ingenia",
			quantity: 2,
			confirmations: 2,
			age: { years: 8, count: 1 },
			renewals: 1,
		});
		expect(
			democare?.units.find((found) => found.modality === "Tomografía"),
		).toMatchObject({ brand: "Canon", status: "Confirmado", confirmations: 2 });
		const question = nextQuestion(capture, bases);
		expect(question).not.toBe("¿De qué marca es el tomógrafo?");
		expect(question).toBeNull();
	});

	test("a later visit with tres resonadores grows the count by one", () => {
		const seed = salud.demo.seed(TODAY);
		const capture = captured(
			"capture",
			NOW - 2 * DAY,
			salud.demo.example,
			salud.demo.modelText,
		);
		const text =
			"Volví al Hospital DemoCare Pacific, en Panamá. Ahora tienen tres resonadores Philips.";
		const said = (equipos: ExtractedUnit[]) =>
			captured("later", NOW, text, JSON.stringify(extraction({ equipos })));
		const shapes = [
			said([unit({ cantidad: 3 })]),
			said([
				unit({ cantidad: null }),
				unit({ cantidad: null }),
				unit({ cantidad: null }),
			]),
		];
		for (const later of shapes) {
			const visits = [...seed, capture, later];
			expect(resonance(visits)).toBe((resonance(seed) ?? 0) + 1);
			expect(fleetSummary(installedBase(visits, NOW)).units).toBe(
				fleetSummary(installedBase(seed, NOW)).units + 1,
			);
		}
	});

	test("prefers a distinct compatible unit before stacking on one", () => {
		const [base] = installedBase(
			[
				visit("first", NOW - 30 * DAY, {
					equipos: [
						unit({ cantidad: 2, modelo: "Ingenia" }),
						unit({ modelo: "Achieva" }),
					],
				}),
				visit("second", NOW, { equipos: [unit(), unit()] }),
			],
			NOW,
		);
		expect(
			base?.units.map(({ model, quantity, confirmations }) => ({
				model,
				quantity,
				confirmations,
			})),
		).toEqual([
			{ model: "Ingenia", quantity: 2, confirmations: 2 },
			{ model: "Achieva", quantity: 1, confirmations: 2 },
		]);
	});

	test("stacks same-visit sightings only while the known quantity has room", () => {
		const tomographs = (cantidad: number | null) =>
			installedBase(
				[
					visit("first", NOW - DAY, {
						equipos: [unit({ modalidad: "Tomografía", cantidad })],
					}),
					visit("second", NOW, {
						equipos: [
							unit({ modalidad: "Tomografía", cantidad: null }),
							unit({ modalidad: "Tomografía", cantidad: null }),
						],
					}),
				],
				NOW,
			)[0]?.units.map(({ quantity, confirmations }) => ({
				quantity,
				confirmations,
			}));
		expect(tomographs(2)).toEqual([{ quantity: 2, confirmations: 2 }]);
		expect(tomographs(null)).toEqual([
			{ quantity: null, confirmations: 2 },
			{ quantity: null, confirmations: 1 },
		]);
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
		expect(base?.units[0]?.age).toEqual({ years: 8, count: 1 });
		expect(base?.units[0]?.renewals).toBe(1);
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
			return {
				renewals: base?.units[0]?.renewals,
				stale: base?.units[0]?.stale,
			};
		};
		expect(ageAndStale(7, 179)).toEqual({ renewals: 0, stale: false });
		expect(ageAndStale(8, 181)).toEqual({ renewals: 1, stale: true });
	});

	test("skips visits without a client and sorts clients by latest visit", () => {
		const bases = installedBase(
			[
				visit("a", NOW - 5 * DAY, { cliente: "Hospital Santo Tomás" }),
				visit("b", NOW - DAY, { cliente: "Clínica Las Condes" }),
				visit("c", NOW, { cliente: null }),
				{
					id: "d",
					at: NOW,
					source: "sin extraer",
					extraction: null,
					unverified: [],
				},
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
				age: { years: 8, count: 1 },
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
				age: null,
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
				age: { years: 3, count: 1 },
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
		const ask = (overrides: Partial<Extraction>) => {
			const only = visit("only", NOW, overrides);
			return nextQuestion(only, installedBase([only], NOW));
		};
		const tomograph = unit({ modalidad: "Tomografía", marca: null });
		expect(ask({ cliente: null, equipos: [tomograph] })).toBe(
			"¿En qué hospital o clínica estás?",
		);
		expect(ask({ pais: null, equipos: [tomograph] })).toBe(
			"¿De qué marca es el tomógrafo?",
		);
		expect(
			ask({ pais: null, equipos: [unit({ modalidad: "Medicina nuclear" })] }),
		).toBe("¿Qué antigüedad tiene la gammacámara?");
		expect(ask({ pais: null, equipos: [unit({ antiguedad_anios: 4 })] })).toBe(
			"¿En qué ciudad está Hospital DemoCare Pacific?",
		);
		expect(ask({ equipos: [unit({ antiguedad_anios: 4 })] })).toBeNull();
	});

	test("skips a datum an earlier visit already gave the merged unit", () => {
		const earlier = visit("earlier", NOW - DAY, {
			ciudad: "Panamá",
			equipos: [
				unit({ modalidad: "Tomografía", marca: "Canon", antiguedad_anios: 11 }),
			],
		});
		const now = visit("now", NOW, {
			pais: null,
			equipos: [unit({ modalidad: "Tomografía", marca: null })],
		});
		expect(nextQuestion(now, installedBase([now], NOW))).toBe(
			"¿De qué marca es el tomógrafo?",
		);
		expect(nextQuestion(now, installedBase([earlier, now], NOW))).toBeNull();
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

describe("equiposRows", () => {
	test("flags renewal and stale units and keeps every source text", () => {
		expect(
			equiposRows(
				installedBase(
					[
						visit("Vi un resonador Philips de nueve años.", NOW - 400 * DAY, {
							equipos: [unit({ antiguedad_anios: 9 })],
						}),
						visit("Otra vez el resonador Philips.", NOW - 200 * DAY),
					],
					NOW,
				),
			),
		).toEqual([
			{
				cliente: "Hospital DemoCare Pacific",
				ciudad: null,
				pais: "Panamá",
				modalidad: "Resonancia magnética",
				cantidad: 1,
				marca: "Philips",
				modelo: null,
				antiguedad_anios: 10,
				con_antiguedad: 1,
				estado: "Confirmado",
				confianza: 65,
				confirmaciones: 2,
				ultima_visita: "2026-02-22",
				por_renovar: 1,
				sin_verificar: "Sí",
				texto_original:
					"Vi un resonador Philips de nueve años.\nOtra vez el resonador Philips.",
			},
		]);
	});
});

describe("equiposCsv", () => {
	test("quotes cells with commas, quotes, or newlines and leaves nulls empty", () => {
		const source = appendAnswer(
			"Vi un resonador, Philips.",
			"¿Qué modelo es?",
			"Ingenia",
		);
		const csv = equiposCsv(
			installedBase(
				[
					{
						...visit("v", NOW, {
							cliente: 'Clínica "La Paz", Sede Norte',
							equipos: [unit({ modelo: "Ingenia\n1.5T" })],
						}),
						source,
					},
				],
				NOW,
			),
		);
		expect(csv.charCodeAt(0)).toBe(0xfeff);
		expect(csv.slice(1).split("\r\n")).toEqual([
			"Cliente,Ciudad,País,Modalidad,Cantidad,Marca,Modelo,Antigüedad (años),Con esa antigüedad,Estado,Confianza,Confirmaciones,Última visita,Por renovar,Sin verificar,Texto original",
			'"Clínica ""La Paz"", Sede Norte",,Panamá,Resonancia magnética,1,Philips,"Ingenia\n1.5T",,,Confirmado,70,1,2026-09-10,0,No,"Vi un resonador, Philips.\nPregunta: ¿Qué modelo es?\nRespuesta: Ingenia"',
			"",
		]);
	});
});
