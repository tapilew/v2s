/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
	blankNote,
	type ClinicalNote,
	type Consultation,
	editField,
	editsAfterSigning,
	grounded,
	missingForLey68,
	NOTE_SCHEMA,
	noteFrom,
	noteRequest,
	parseNote,
	removeItem,
	sign,
	TRANSCRIPT_LIMIT,
	toFhirBundle,
	toNoteText,
	unverifiedPaths,
} from "./clinical-note";

const LOCAL_AT = new Date(2026, 8, 10, 14, 5).getTime();
const PHYSICIAN = { name: "Ana Castillo", license: "4521" };

const note = (overrides: Partial<ClinicalNote> = {}): ClinicalNote => ({
	...blankNote(),
	...overrides,
});

const consultation = (overrides: Partial<Consultation> = {}): Consultation => ({
	id: "consulta-1",
	at: LOCAL_AT,
	transcript: "",
	note: note(),
	status: { kind: "draft" },
	edits: [],
	unverified: [],
	...overrides,
});

const pneumonia = {
	descripcion: "Neumonía adquirida en la comunidad",
	cie10_sugerido: "J18.9",
	evidencia: "neumonía adquirida en la comunidad",
};

const azithromycin = {
	medicamento: "Azitromicina",
	dosis: "500 miligramos",
	via: "oral",
	frecuencia: "una vez al día",
	duracion: "3 días",
	evidencia: "azitromicina 500 miligramos",
};

const pneumoniaNote = note({
	paciente: {
		nombre: "Carlos Méndez",
		cedula: null,
		edad: "45 años",
		sexo: "Masculino",
	},
	motivo_consulta: "Fiebre y tos",
	alergias: "Penicilina",
	signos_vitales: {
		...blankNote().signos_vitales,
		presion_arterial: "120/80",
		temperatura: 38.5,
	},
	examen_fisico: "Crepitantes en la base derecha",
	diagnosticos: [pneumonia],
	tratamiento: [azithromycin],
	indicaciones: "Signos de alarma",
});

describe("parseNote", () => {
	test("reads JSON wrapped in chatter and repairs what a small model gets wrong", () => {
		const response = `Aquí está la nota:\n\`\`\`json\n${JSON.stringify({
			paciente: {
				nombre: " Carlos Méndez ",
				cedula: "",
				edad: 45,
				sexo: "masculino",
			},
			motivo_consulta: "Fiebre y tos",
			signos_vitales: {
				presion_arterial: "120/80",
				temperatura: "38,5",
				saturacion_oxigeno: "96%",
				frecuencia_cardiaca: 0,
				peso_kg: "no se dijo",
			},
			diagnosticos: [
				{ ...pneumonia, cie10_sugerido: " j18.9 " },
				{ descripcion: "", cie10_sugerido: "J00" },
				{ descripcion: "Deshidratación", cie10_sugerido: "no estoy seguro" },
				"texto suelto",
			],
			tratamiento: [
				{ medicamento: "Azitromicina", dosis: "500 miligramos" },
				{ medicamento: null, dosis: "1 gramo" },
			],
		})}\n\`\`\`\nRevísala.`;
		expect(parseNote(response)).toEqual({
			paciente: {
				nombre: "Carlos Méndez",
				cedula: null,
				edad: "45",
				sexo: "Masculino",
			},
			motivo_consulta: "Fiebre y tos",
			enfermedad_actual: null,
			antecedentes: null,
			alergias: null,
			medicamentos_actuales: null,
			signos_vitales: {
				presion_arterial: "120/80",
				frecuencia_cardiaca: null,
				frecuencia_respiratoria: null,
				temperatura: 38.5,
				saturacion_oxigeno: 96,
				peso_kg: null,
				talla_cm: null,
			},
			examen_fisico: null,
			resultados: null,
			diagnosticos: [
				pneumonia,
				{
					descripcion: "Deshidratación",
					cie10_sugerido: null,
					evidencia: null,
				},
			],
			tratamiento: [
				{
					medicamento: "Azitromicina",
					dosis: "500 miligramos",
					via: null,
					frecuencia: null,
					duracion: null,
					evidencia: null,
				},
			],
			examenes_solicitados: null,
			referencia: null,
			indicaciones: null,
		});
	});

	test("returns null when there is no JSON object", () => {
		expect(parseNote("No pude redactar la nota.")).toBeNull();
		expect(parseNote("{ roto")).toBeNull();
		expect(noteFrom(["no", "es", "objeto"])).toBeNull();
		expect(noteFrom({})?.motivo_consulta).toBeNull();
	});
});

type Schema = {
	type?: string | string[];
	properties?: Record<string, Schema>;
	required?: string[];
	items?: Schema;
	maxLength?: number;
	maxItems?: number;
	enum?: unknown[];
};

const schemaLeaves = (schema: Schema, path = ""): string[] => {
	if (schema.properties)
		return Object.entries(schema.properties).flatMap(([key, child]) =>
			schemaLeaves(child, path ? `${path}.${key}` : key),
		);
	if (schema.items) return schemaLeaves(schema.items, path);
	return [path];
};

const valueLeaves = (value: unknown, path = ""): string[] => {
	if (Array.isArray(value)) return valueLeaves(value[0], path);
	if (typeof value === "object" && value !== null)
		return Object.entries(value).flatMap(([key, child]) =>
			valueLeaves(child, path ? `${path}.${key}` : key),
		);
	return [path];
};

const uncapped = (schema: Schema, path = "root"): string[] => {
	const types = [schema.type].flat();
	const own =
		(types.includes("string") &&
			schema.maxLength === undefined &&
			schema.enum === undefined) ||
		(types.includes("array") && schema.maxItems === undefined)
			? [path]
			: [];
	const unrequired = schema.properties
		? Object.keys(schema.properties)
				.filter((key) => !schema.required?.includes(key))
				.map((key) => `${path}.${key} no es requerido`)
		: [];
	return [
		...own,
		...unrequired,
		...Object.entries(schema.properties ?? {}).flatMap(([key, child]) =>
			uncapped(child, `${path}.${key}`),
		),
		...(schema.items ? uncapped(schema.items, `${path}[]`) : []),
	];
};

describe("NOTE_SCHEMA", () => {
	test("asks for exactly the keys the parser reads", () => {
		const sample = noteFrom({
			diagnosticos: [{ descripcion: "x" }],
			tratamiento: [{ medicamento: "x" }],
		});
		expect(schemaLeaves(NOTE_SCHEMA)).toEqual(valueLeaves(sample));
	});

	test("caps every string and list and requires every key, so the grammar cannot loop", () => {
		expect(uncapped(NOTE_SCHEMA)).toEqual([]);
		expect(
			uncapped({
				type: "object",
				properties: { libre: { type: "string" } },
				required: [],
			}),
		).toEqual(["root.libre no es requerido", "root.libre"]);
	});
});

describe("noteRequest", () => {
	test("dates the prompt in Spanish and cuts long transcripts at the limit", () => {
		const now = new Date(2026, 8, 10, 9);
		const short = noteRequest("Paciente con fiebre.", now);
		expect(short.history[0].content).toContain(
			"Hoy es 10 de septiembre de 2026.",
		);
		expect(short.history[1]).toEqual({
			role: "user",
			content: "Paciente con fiebre.",
		});
		const long = noteRequest("palabra ".repeat(2000), now);
		expect(long.history[1].content.length).toBe(TRANSCRIPT_LIMIT);
	});
});

describe("grounded", () => {
	const transcript =
		"Paciente con TOS seca y fiebre de 38.5 grados.\nImpresión:   neumonía adquirida en la comunidad.";

	test("finds a quote despite case, accents, punctuation and line breaks", () => {
		expect(grounded(transcript, "tos seca")).toBe(true);
		expect(grounded(transcript, "Neumonia adquirida, en la comunidad")).toBe(
			true,
		);
		expect(grounded(transcript, "fiebre de 38,5 grados")).toBe(true);
		expect(grounded(transcript, "grados. Impresión: neumonía")).toBe(true);
	});

	test("rejects paraphrases, invented words, partial words and empty quotes", () => {
		expect(grounded(transcript, "tos productiva")).toBe(false);
		expect(grounded(transcript, "neumonía de la comunidad")).toBe(false);
		expect(grounded(transcript, "fiebre de 39 grados")).toBe(false);
		expect(grounded("tomó una tostada", "tos")).toBe(false);
		expect(grounded(transcript, "neumo")).toBe(false);
		expect(grounded(transcript, " ... ")).toBe(false);
		expect(grounded(transcript, null)).toBe(false);
	});
});

describe("unverifiedPaths", () => {
	test("flags values the transcript never says, and nothing it does say", () => {
		const transcript =
			"Carlos Méndez, 45 años. Presión 120 sobre 80, temperatura 38,5. Neumonía adquirida en la comunidad, azitromicina 500 miligramos al día.";
		const drafted = note({
			paciente: {
				nombre: "Carlos Méndez",
				cedula: "8-888-8888",
				edad: "45 años",
				sexo: "Masculino",
			},
			signos_vitales: {
				...blankNote().signos_vitales,
				presion_arterial: "120/80",
				temperatura: 39,
			},
			diagnosticos: [
				pneumonia,
				{
					descripcion: "Infección por Streptococcus",
					cie10_sugerido: null,
					evidencia: "cultivo positivo",
				},
			],
			tratamiento: [{ ...azithromycin, dosis: "1 gramo" }],
		});
		expect(unverifiedPaths(transcript, drafted)).toEqual([
			"paciente.cedula",
			"signos_vitales.temperatura",
			"diagnosticos.1",
			"tratamiento.0.dosis",
		]);
		expect(
			unverifiedPaths(transcript, {
				...drafted,
				paciente: { ...drafted.paciente, cedula: null },
				signos_vitales: { ...drafted.signos_vitales, temperatura: 38.5 },
				diagnosticos: [pneumonia],
				tratamiento: [azithromycin],
			}),
		).toEqual([]);
	});
});

describe("missingForLey68", () => {
	test("lists every expected item on an empty note", () => {
		expect(missingForLey68(blankNote())).toEqual([
			"Nombre o cédula del paciente",
			"Antecedentes personales y familiares",
			"Examen físico",
			"Tratamiento o plan",
			"Información dada al paciente",
		]);
	});

	test("accepts the cédula alone and a treatment without instructions as a plan", () => {
		expect(
			missingForLey68(
				note({
					paciente: { ...blankNote().paciente, cedula: "8-123-456" },
					antecedentes: "Hipertensión",
					examen_fisico: "Normal",
					tratamiento: [azithromycin],
				}),
			),
		).toEqual(["Información dada al paciente"]);
		expect(
			missingForLey68({
				...pneumoniaNote,
				antecedentes: "Ninguno conocido",
			}),
		).toEqual([]);
	});
});

describe("editField", () => {
	test("logs the change, normalizes the value, and clears the machine's doubt on that field", () => {
		const c = consultation({
			note: pneumoniaNote,
			unverified: ["signos_vitales.temperatura", "diagnosticos.0"],
		});
		const edited = editField(c, "signos_vitales.temperatura", "38,9", 100);
		expect(edited.note?.signos_vitales.temperatura).toBe(38.9);
		expect(edited.edits).toEqual([
			{
				at: 100,
				path: "signos_vitales.temperatura",
				before: "38.5",
				after: "38.9",
				afterSigning: false,
			},
		]);
		expect(edited.unverified).toEqual(["diagnosticos.0"]);
	});

	test("editing one field of a medication clears the doubt on the whole item", () => {
		const c = consultation({
			note: pneumoniaNote,
			unverified: ["tratamiento.0", "tratamiento.0.dosis", "diagnosticos.0"],
		});
		const edited = editField(c, "tratamiento.0.dosis", "250 miligramos", 5);
		expect(edited.note?.tratamiento[0].dosis).toBe("250 miligramos");
		expect(edited.unverified).toEqual(["diagnosticos.0"]);
	});

	test("an emptied field becomes null", () => {
		const edited = editField(
			consultation({ note: pneumoniaNote }),
			"motivo_consulta",
			"   ",
			7,
		);
		expect(edited.note?.motivo_consulta).toBeNull();
		expect(edited.edits[0]).toEqual({
			at: 7,
			path: "motivo_consulta",
			before: "Fiebre y tos",
			after: null,
			afterSigning: false,
		});
	});

	test("marks changes made after signing and keeps the signature", () => {
		const signed = sign(consultation({ note: pneumoniaNote }), PHYSICIAN, 50);
		const edited = editField(signed, "alergias", "Penicilina y sulfas", 60);
		expect(edited.status).toEqual({
			kind: "signed",
			at: 50,
			physician: PHYSICIAN,
		});
		expect(edited.edits[0].afterSigning).toBe(true);
		expect(editsAfterSigning(edited)).toBe(1);
	});

	test("leaves the consultation untouched when nothing real changes", () => {
		const c = consultation({ note: pneumoniaNote });
		expect(editField(c, "alergias", " Penicilina ", 1)).toBe(c);
		expect(editField(c, "paciente.apodo", "Carlitos", 1)).toBe(c);
		expect(editField(c, "paciente", "Carlos", 1)).toBe(c);
		expect(editField(c, "diagnosticos.0.descripcion", "", 1)).toBe(c);
		expect(editField(c, "diagnosticos.4.descripcion", "Gripe", 1)).toBe(c);
		const undrafted = consultation({ note: null });
		expect(editField(undrafted, "alergias", "Ninguna", 1)).toBe(undrafted);
		expect(editField(c, "alergias", "Ninguna", 1)).not.toBe(c);
	});
});

describe("removeItem", () => {
	test("removes the item, logs what it said, and shifts later flags down", () => {
		const dehydration = {
			descripcion: "Deshidratación",
			cie10_sugerido: null,
			evidencia: null,
		};
		const c = consultation({
			note: { ...pneumoniaNote, diagnosticos: [pneumonia, dehydration] },
			unverified: ["diagnosticos.0", "diagnosticos.1", "tratamiento.0"],
		});
		const removed = removeItem(c, "diagnosticos", 0, 9);
		expect(removed.note?.diagnosticos).toEqual([dehydration]);
		expect(removed.edits).toEqual([
			{
				at: 9,
				path: "diagnosticos.0",
				before: "Neumonía adquirida en la comunidad. CIE-10 sugerido: J18.9",
				after: null,
				afterSigning: false,
			},
		]);
		expect(removed.unverified).toEqual(["diagnosticos.0", "tratamiento.0"]);
		expect(removeItem(c, "tratamiento", 3, 9)).toBe(c);
	});

	test("logs a removed medication as its one-line summary", () => {
		const removed = removeItem(
			consultation({ note: pneumoniaNote }),
			"tratamiento",
			0,
			3,
		);
		expect(removed.note?.tratamiento).toEqual([]);
		expect(removed.edits[0].before).toBe(
			"Azitromicina, 500 miligramos, vía oral, una vez al día, 3 días",
		);
	});
});

describe("sign", () => {
	test("signs a draft once and keeps the first signature", () => {
		const signed = sign(consultation(), PHYSICIAN, 10);
		expect(signed.status).toEqual({
			kind: "signed",
			at: 10,
			physician: PHYSICIAN,
		});
		expect(sign(signed, { name: "Otro", license: "1" }, 20)).toBe(signed);
	});
});

describe("toNoteText", () => {
	test("writes a draft as plain SOAP text with every expected label", () => {
		expect(toNoteText(consultation({ note: pneumoniaNote }))).toBe(
			[
				"Nota de consulta",
				"10 de septiembre de 2026, 14:05",
				"",
				"Paciente",
				"Nombre: Carlos Méndez",
				"Cédula: No consignado",
				"Edad: 45 años",
				"Sexo: Masculino",
				"",
				"S. Subjetivo",
				"Motivo de consulta: Fiebre y tos",
				"Enfermedad actual: No consignado",
				"Antecedentes personales y familiares: No consignado",
				"Alergias: Penicilina",
				"Medicamentos actuales: No consignado",
				"",
				"O. Objetivo",
				"Signos vitales:",
				"- Presión arterial: 120/80",
				"- Temperatura: 38,5 grados Celsius",
				"Examen físico: Crepitantes en la base derecha",
				"Resultados de exámenes: No consignado",
				"",
				"A. Evaluación",
				"Diagnósticos:",
				"- Neumonía adquirida en la comunidad. CIE-10 sugerido: J18.9",
				"",
				"P. Plan",
				"Tratamiento:",
				"- Azitromicina, 500 miligramos, vía oral, una vez al día, 3 días",
				"Exámenes solicitados: No consignado",
				"Referencia: No consignado",
				"Indicaciones al paciente: Signos de alarma",
				"",
				"Borrador sin firmar. Generado en el dispositivo; requiere revisión médica.",
			].join("\n"),
		);
	});

	test("ends a signed note with the signature and counts later changes", () => {
		const signedAt = new Date(2026, 8, 10, 15, 30).getTime();
		const signed = sign(
			consultation({ note: pneumoniaNote }),
			PHYSICIAN,
			signedAt,
		);
		expect(toNoteText(signed).split("\n").slice(-2)).toEqual([
			"",
			"Firmado por Ana Castillo, registro 4521, 10 de septiembre de 2026, 15:30",
		]);
		const changed = editField(signed, "referencia", "Neumología", signedAt + 1);
		expect(toNoteText(changed).split("\n").slice(-2)).toEqual([
			"Firmado por Ana Castillo, registro 4521, 10 de septiembre de 2026, 15:30",
			"Modificaciones después de firmar: 1",
		]);
	});
});

const dig = (value: unknown, ...path: Array<string | number>): unknown =>
	path.reduce<unknown>(
		(found, key) =>
			typeof found === "object" && found !== null
				? (found as Record<string | number, unknown>)[key]
				: undefined,
		value,
	);

const references = (value: unknown): string[] => {
	if (Array.isArray(value)) return value.flatMap(references);
	if (typeof value !== "object" || value === null) return [];
	return Object.entries(value).flatMap(([key, child]) =>
		key === "reference" && typeof child === "string"
			? [child]
			: references(child),
	);
};

describe("toFhirBundle", () => {
	const at = Date.UTC(2026, 8, 10, 19, 5);
	const exported = consultation({
		at,
		note: {
			...pneumoniaNote,
			paciente: {
				nombre: "Rosa Villarreal",
				cedula: "8-123-456",
				edad: "62 años",
				sexo: "Femenino",
			},
			signos_vitales: {
				...pneumoniaNote.signos_vitales,
				saturacion_oxigeno: 96,
			},
			diagnosticos: [
				pneumonia,
				{
					descripcion: "Deshidratación",
					cie10_sugerido: null,
					evidencia: null,
				},
			],
		},
	});

	test("builds a preliminary document whose references all resolve", () => {
		const bundle = toFhirBundle(exported);
		expect(bundle.type).toBe("document");
		expect(bundle.entry.map((entry) => entry.resource.resourceType)).toEqual([
			"Composition",
			"Patient",
			"Encounter",
			"Observation",
			"Observation",
			"Observation",
			"Condition",
			"Condition",
			"MedicationRequest",
		]);
		const urls = bundle.entry.map((entry) => entry.fullUrl);
		for (const url of urls)
			expect(url).toMatch(
				/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
			);
		expect(new Set(urls).size).toBe(urls.length);
		const refs = references(bundle);
		expect(refs.length).toBeGreaterThan(10);
		expect(refs.filter((ref) => !urls.includes(ref))).toEqual([]);

		const [composition, patient, encounter, ...rest] = bundle.entry.map(
			(entry) => entry.resource,
		);
		expect(composition.status).toBe("preliminary");
		expect(dig(composition, "type", "coding", 0, "code")).toBe("34108-1");
		expect(dig(composition, "author", 0)).toEqual({
			display: "Borrador generado en el dispositivo",
		});
		const sections = composition.section as Array<Record<string, unknown>>;
		expect(sections.map((section) => section.title)).toEqual([
			"Subjetivo",
			"Objetivo",
			"Evaluación",
			"Plan",
		]);
		expect(dig(sections[2], "entry")).toEqual([
			{ reference: urls[6] },
			{ reference: urls[7] },
		]);
		expect(dig(sections[0], "text", "div")).toContain(
			"<p>Motivo de consulta: Fiebre y tos</p>",
		);

		expect(patient.identifier).toEqual([
			{ type: { text: "Cédula" }, value: "8-123-456" },
		]);
		expect(patient.gender).toBe("female");
		expect(dig(encounter, "class", "code")).toBe("AMB");
		expect(dig(encounter, "period", "start")).toBe("2026-09-10T19:05:00.000Z");

		const observations = rest.filter(
			(resource) => resource.resourceType === "Observation",
		);
		expect(
			observations.map((resource) => [
				dig(resource, "code", "coding", 0, "code"),
				resource.valueString ?? resource.valueQuantity,
			]),
		).toEqual([
			["85354-9", "120/80"],
			[
				"8310-5",
				{
					value: 38.5,
					unit: "Cel",
					system: "http://unitsofmeasure.org",
					code: "Cel",
				},
			],
			[
				"59408-5",
				{
					value: 96,
					unit: "%",
					system: "http://unitsofmeasure.org",
					code: "%",
				},
			],
		]);
		expect(dig(observations[0], "category", 0, "coding", 0, "code")).toBe(
			"vital-signs",
		);

		const conditions = rest.filter(
			(resource) => resource.resourceType === "Condition",
		);
		expect(conditions.map((resource) => resource.code)).toEqual([
			{
				text: "Neumonía adquirida en la comunidad",
				coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code: "J18.9" }],
			},
			{ text: "Deshidratación" },
		]);

		const request = rest[rest.length - 1];
		expect(request.status).toBe("draft");
		expect(request.intent).toBe("order");
		expect(request.medicationCodeableConcept).toEqual({ text: "Azitromicina" });
		expect(request.dosageInstruction).toEqual([
			{ text: "500 miligramos, vía oral, una vez al día, 3 días" },
		]);
	});

	test("a signed note is final, authored by the physician, and exports the same ids every time", () => {
		const signed = sign(exported, PHYSICIAN, at + 60_000);
		const bundle = toFhirBundle(signed);
		const byType = (type: string) =>
			bundle.entry.filter((entry) => entry.resource.resourceType === type);
		const [practitioner] = byType("Practitioner");
		expect(practitioner.resource.identifier).toEqual([
			{ type: { text: "Registro o idoneidad" }, value: "4521" },
		]);
		const composition = bundle.entry[0].resource;
		expect(composition.status).toBe("final");
		expect(composition.author).toEqual([{ reference: practitioner.fullUrl }]);
		expect(dig(composition, "attester", 0, "time")).toBe(
			"2026-09-10T19:06:00.000Z",
		);
		expect(byType("MedicationRequest")[0].resource.status).toBe("active");
		expect(byType("Observation")[0].resource.status).toBe("final");
		expect(toFhirBundle(signed).entry[0].fullUrl).toBe(bundle.entry[0].fullUrl);
		expect(
			toFhirBundle({ ...signed, id: "consulta-2" }).entry[0].fullUrl,
		).not.toBe(bundle.entry[0].fullUrl);
	});
});
