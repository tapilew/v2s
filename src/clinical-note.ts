export type Sexo = "Femenino" | "Masculino";

export type Paciente = {
	nombre: string | null;
	cedula: string | null;
	edad: string | null;
	sexo: Sexo | null;
};

export type SignosVitales = {
	presion_arterial: string | null;
	frecuencia_cardiaca: number | null;
	frecuencia_respiratoria: number | null;
	temperatura: number | null;
	saturacion_oxigeno: number | null;
	peso_kg: number | null;
	talla_cm: number | null;
};

export type Diagnostico = {
	descripcion: string;
	cie10_sugerido: string | null;
	evidencia: string | null;
};

export type Medicamento = {
	medicamento: string;
	dosis: string | null;
	via: string | null;
	frecuencia: string | null;
	duracion: string | null;
	evidencia: string | null;
};

export type ClinicalNote = {
	paciente: Paciente;
	motivo_consulta: string | null;
	enfermedad_actual: string | null;
	antecedentes: string | null;
	alergias: string | null;
	medicamentos_actuales: string | null;
	signos_vitales: SignosVitales;
	examen_fisico: string | null;
	resultados: string | null;
	diagnosticos: Diagnostico[];
	tratamiento: Medicamento[];
	examenes_solicitados: string | null;
	referencia: string | null;
	indicaciones: string | null;
};

export type Physician = { name: string; license: string };

export type NoteStatus =
	| { kind: "draft" }
	| { kind: "signed"; at: number; physician: Physician };

export type NoteEdit = {
	at: number;
	path: string;
	before: string | null;
	after: string | null;
	afterSigning: boolean;
};

export type Consultation = {
	id: string;
	at: number;
	transcript: string;
	note: ClinicalNote | null;
	status: NoteStatus;
	edits: NoteEdit[];
	unverified: string[];
};

export type NoteDraft = { note: ClinicalNote; unverified: string[] };

export type NarrativeKey =
	| "motivo_consulta"
	| "enfermedad_actual"
	| "antecedentes"
	| "alergias"
	| "medicamentos_actuales"
	| "examen_fisico"
	| "resultados"
	| "examenes_solicitados"
	| "referencia"
	| "indicaciones";

export type ItemList = "diagnosticos" | "tratamiento";

export type NoteField =
	| { kind: "text"; key: NarrativeKey; label: string }
	| { kind: "vitals"; label: string }
	| { kind: "diagnoses"; label: string }
	| { kind: "medications"; label: string };

export type Section = {
	letter: "S" | "O" | "A" | "P";
	title: string;
	fields: readonly NoteField[];
};

export type Vital = {
	key: keyof SignosVitales;
	label: string;
	loinc: { code: string; display: string };
	unit: { spoken: string; ucum: string } | null;
};

export type NoteRequest = {
	history: Array<{ role: "system" | "user"; content: string }>;
	responseFormat: {
		type: "json_schema";
		json_schema: { name: string; schema: typeof NOTE_SCHEMA };
	};
	generationParams: { temp: number; predict: number };
};

export type FhirResource = { resourceType: string; [field: string]: unknown };

export type FhirBundle = {
	resourceType: "Bundle";
	type: "document";
	identifier: { system: string; value: string };
	timestamp: string;
	entry: Array<{ fullUrl: string; resource: FhirResource }>;
};

export const TRANSCRIPT_LIMIT = 9000;
export const NOT_RECORDED = "No consignado";

const SHORT = 80;
const QUOTE = 200;
const LONG = 500;
const MAX_ITEMS = 6;

const text = (maxLength: number) => ({ type: ["string", "null"], maxLength });
const quantity = { type: ["number", "null"] };
const object = <T extends Record<string, unknown>>(properties: T) => ({
	type: "object",
	properties,
	required: Object.keys(properties),
});
const list = <T>(items: T) => ({ type: "array", maxItems: MAX_ITEMS, items });

export const NOTE_SCHEMA = object({
	paciente: object({
		nombre: text(SHORT),
		cedula: text(SHORT),
		edad: text(SHORT),
		sexo: { type: ["string", "null"], enum: ["Femenino", "Masculino", null] },
	}),
	motivo_consulta: text(LONG),
	enfermedad_actual: text(LONG),
	antecedentes: text(LONG),
	alergias: text(LONG),
	medicamentos_actuales: text(LONG),
	signos_vitales: object({
		presion_arterial: text(SHORT),
		frecuencia_cardiaca: quantity,
		frecuencia_respiratoria: quantity,
		temperatura: quantity,
		saturacion_oxigeno: quantity,
		peso_kg: quantity,
		talla_cm: quantity,
	}),
	examen_fisico: text(LONG),
	resultados: text(LONG),
	diagnosticos: list(
		object({
			descripcion: { type: "string", maxLength: SHORT },
			cie10_sugerido: text(SHORT),
			evidencia: text(QUOTE),
		}),
	),
	tratamiento: list(
		object({
			medicamento: { type: "string", maxLength: SHORT },
			dosis: text(SHORT),
			via: text(SHORT),
			frecuencia: text(SHORT),
			duracion: text(SHORT),
			evidencia: text(QUOTE),
		}),
	),
	examenes_solicitados: text(LONG),
	referencia: text(LONG),
	indicaciones: text(LONG),
});

export const PATIENT_FIELDS: ReadonlyArray<{
	key: keyof Paciente;
	label: string;
}> = [
	{ key: "nombre", label: "Nombre" },
	{ key: "cedula", label: "Cédula" },
	{ key: "edad", label: "Edad" },
	{ key: "sexo", label: "Sexo" },
];

export const SEXES: readonly Sexo[] = ["Femenino", "Masculino"];

export const VITALS: readonly Vital[] = [
	{
		key: "presion_arterial",
		label: "Presión arterial",
		loinc: {
			code: "85354-9",
			display: "Blood pressure panel with all children optional",
		},
		unit: null,
	},
	{
		key: "frecuencia_cardiaca",
		label: "Frecuencia cardiaca",
		loinc: { code: "8867-4", display: "Heart rate" },
		unit: { spoken: "latidos por minuto", ucum: "/min" },
	},
	{
		key: "frecuencia_respiratoria",
		label: "Frecuencia respiratoria",
		loinc: { code: "9279-1", display: "Respiratory rate" },
		unit: { spoken: "respiraciones por minuto", ucum: "/min" },
	},
	{
		key: "temperatura",
		label: "Temperatura",
		loinc: { code: "8310-5", display: "Body temperature" },
		unit: { spoken: "grados Celsius", ucum: "Cel" },
	},
	{
		key: "saturacion_oxigeno",
		label: "Saturación de oxígeno",
		loinc: {
			code: "59408-5",
			display: "Oxygen saturation in Arterial blood by Pulse oximetry",
		},
		unit: { spoken: "por ciento", ucum: "%" },
	},
	{
		key: "peso_kg",
		label: "Peso",
		loinc: { code: "29463-7", display: "Body weight" },
		unit: { spoken: "kilogramos", ucum: "kg" },
	},
	{
		key: "talla_cm",
		label: "Talla",
		loinc: { code: "8302-2", display: "Body height" },
		unit: { spoken: "centímetros", ucum: "cm" },
	},
];

export const DIAGNOSIS_FIELDS: ReadonlyArray<{
	key: "descripcion" | "cie10_sugerido";
	label: string;
}> = [
	{ key: "descripcion", label: "Diagnóstico" },
	{ key: "cie10_sugerido", label: "CIE-10 sugerido" },
];

export const MEDICATION_FIELDS: ReadonlyArray<{
	key: Exclude<keyof Medicamento, "evidencia">;
	label: string;
}> = [
	{ key: "medicamento", label: "Medicamento" },
	{ key: "dosis", label: "Dosis" },
	{ key: "via", label: "Vía" },
	{ key: "frecuencia", label: "Frecuencia" },
	{ key: "duracion", label: "Duración" },
];

const narrative = (key: NarrativeKey, label: string): NoteField => ({
	kind: "text",
	key,
	label,
});

export const SECTIONS: readonly Section[] = [
	{
		letter: "S",
		title: "Subjetivo",
		fields: [
			narrative("motivo_consulta", "Motivo de consulta"),
			narrative("enfermedad_actual", "Enfermedad actual"),
			narrative("antecedentes", "Antecedentes personales y familiares"),
			narrative("alergias", "Alergias"),
			narrative("medicamentos_actuales", "Medicamentos actuales"),
		],
	},
	{
		letter: "O",
		title: "Objetivo",
		fields: [
			{ kind: "vitals", label: "Signos vitales" },
			narrative("examen_fisico", "Examen físico"),
			narrative("resultados", "Resultados de exámenes"),
		],
	},
	{
		letter: "A",
		title: "Evaluación",
		fields: [{ kind: "diagnoses", label: "Diagnósticos" }],
	},
	{
		letter: "P",
		title: "Plan",
		fields: [
			{ kind: "medications", label: "Tratamiento" },
			narrative("examenes_solicitados", "Exámenes solicitados"),
			narrative("referencia", "Referencia"),
			narrative("indicaciones", "Indicaciones al paciente"),
		],
	},
];

const LEY_68_CHECKS: ReadonlyArray<{
	label: string;
	missing: (note: ClinicalNote) => boolean;
}> = [
	{
		label: "Nombre o cédula del paciente",
		missing: (note) =>
			note.paciente.nombre === null && note.paciente.cedula === null,
	},
	{
		label: "Antecedentes personales y familiares",
		missing: (note) => note.antecedentes === null,
	},
	{ label: "Examen físico", missing: (note) => note.examen_fisico === null },
	{
		label: "Tratamiento o plan",
		missing: (note) =>
			note.tratamiento.length === 0 && note.indicaciones === null,
	},
	{
		label: "Información dada al paciente",
		missing: (note) => note.indicaciones === null,
	},
];

const MONTHS = [
	"enero",
	"febrero",
	"marzo",
	"abril",
	"mayo",
	"junio",
	"julio",
	"agosto",
	"septiembre",
	"octubre",
	"noviembre",
	"diciembre",
];

const pad = (value: number) => String(value).padStart(2, "0");

export const formatDate = (at: number) => {
	const date = new Date(at);
	return `${date.getDate()} de ${MONTHS[date.getMonth()]} de ${date.getFullYear()}`;
};

export const formatTime = (at: number) => {
	const date = new Date(at);
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const formatDateTime = (at: number) =>
	`${formatDate(at)}, ${formatTime(at)}`;

const systemPrompt = (now: Date) =>
	[
		"Documentas consultas médicas.",
		"Recibes la transcripción de una consulta o el dictado de un médico al terminar.",
		"Llena la nota solo con lo que se dijo. Usa null cuando algo no se dijo.",
		"Nunca agregues diagnósticos, medicamentos, dosis ni valores de signos vitales que no estén en la transcripción.",
		"antecedentes son los antecedentes personales y familiares. indicaciones es lo que se le explicó o indicó al paciente.",
		"Escribe los términos completos, sin abreviaturas.",
		"En evidencia copia las palabras exactas de la transcripción que respaldan cada diagnóstico o medicamento.",
		"Llena cie10_sugerido solo si estás seguro del código. Si no, usa null.",
		`Hoy es ${formatDate(now.getTime())}.`,
	].join(" ");

export const noteRequest = (transcript: string, now: Date): NoteRequest => ({
	history: [
		{ role: "system", content: systemPrompt(now) },
		{ role: "user", content: transcript.slice(0, TRANSCRIPT_LIMIT) },
	],
	responseFormat: {
		type: "json_schema",
		json_schema: { name: "nota_clinica", schema: NOTE_SCHEMA },
	},
	generationParams: { temp: 0, predict: 1200 },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const recordOf = (value: unknown): Record<string, unknown> =>
	isRecord(value) ? value : {};

const normalize = (value: string) =>
	value
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

const clean = (value: unknown): string | null => {
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value !== "string") return null;
	return value.trim() || null;
};

const measured = (value: unknown): number | null => {
	if (typeof value === "number")
		return Number.isFinite(value) && value > 0 ? value : null;
	const leading = clean(value)?.match(/^\d+(?:[.,]\d+)?/);
	if (!leading) return null;
	const parsed = Number(leading[0].replace(",", "."));
	return parsed > 0 ? parsed : null;
};

const sexoFrom = (value: unknown): Sexo | null => {
	const wanted = typeof value === "string" ? normalize(value) : "";
	return SEXES.find((sexo) => normalize(sexo) === wanted) ?? null;
};

// A code the model half-remembers is worse than none, so anything not shaped like ICD-10 is dropped.
const cie10From = (value: unknown): string | null => {
	const code = clean(value)?.toUpperCase().replace(/\s+/g, "");
	return code && /^[A-Z]\d[0-9A-Z](\.[0-9A-Z]{1,4})?$/.test(code) ? code : null;
};

const itemsOf = <T>(
	value: unknown,
	item: (raw: Record<string, unknown>) => T | null,
): T[] =>
	Array.isArray(value)
		? value.flatMap((raw) => {
				const parsed = isRecord(raw) ? item(raw) : null;
				return parsed === null ? [] : [parsed];
			})
		: [];

const noteFields = (raw: Record<string, unknown>): ClinicalNote => {
	const paciente = recordOf(raw.paciente);
	const signos = recordOf(raw.signos_vitales);
	return {
		paciente: {
			nombre: clean(paciente.nombre),
			cedula: clean(paciente.cedula),
			edad: clean(paciente.edad),
			sexo: sexoFrom(paciente.sexo),
		},
		motivo_consulta: clean(raw.motivo_consulta),
		enfermedad_actual: clean(raw.enfermedad_actual),
		antecedentes: clean(raw.antecedentes),
		alergias: clean(raw.alergias),
		medicamentos_actuales: clean(raw.medicamentos_actuales),
		signos_vitales: {
			presion_arterial: clean(signos.presion_arterial),
			frecuencia_cardiaca: measured(signos.frecuencia_cardiaca),
			frecuencia_respiratoria: measured(signos.frecuencia_respiratoria),
			temperatura: measured(signos.temperatura),
			saturacion_oxigeno: measured(signos.saturacion_oxigeno),
			peso_kg: measured(signos.peso_kg),
			talla_cm: measured(signos.talla_cm),
		},
		examen_fisico: clean(raw.examen_fisico),
		resultados: clean(raw.resultados),
		diagnosticos: itemsOf(raw.diagnosticos, (item) => {
			const descripcion = clean(item.descripcion);
			return descripcion === null
				? null
				: {
						descripcion,
						cie10_sugerido: cie10From(item.cie10_sugerido),
						evidencia: clean(item.evidencia),
					};
		}),
		tratamiento: itemsOf(raw.tratamiento, (item) => {
			const medicamento = clean(item.medicamento);
			return medicamento === null
				? null
				: {
						medicamento,
						dosis: clean(item.dosis),
						via: clean(item.via),
						frecuencia: clean(item.frecuencia),
						duracion: clean(item.duracion),
						evidencia: clean(item.evidencia),
					};
		}),
		examenes_solicitados: clean(raw.examenes_solicitados),
		referencia: clean(raw.referencia),
		indicaciones: clean(raw.indicaciones),
	};
};

export const noteFrom = (value: unknown): ClinicalNote | null =>
	isRecord(value) ? noteFields(value) : null;

export const blankNote = (): ClinicalNote => noteFields({});

export const parseNote = (response: string): ClinicalNote | null => {
	const start = response.indexOf("{");
	const end = response.lastIndexOf("}");
	if (start === -1 || end < start) return null;
	try {
		return noteFrom(JSON.parse(response.slice(start, end + 1)));
	} catch {
		return null;
	}
};

// Whole words only, so a quoted "tos" is not found inside "tostada".
export const grounded = (transcript: string, evidencia: string | null) => {
	if (evidencia === null) return false;
	const quote = normalize(evidencia);
	return quote !== "" && ` ${normalize(transcript)} `.includes(` ${quote} `);
};

// Looser than grounded: "120/80" is verified by "120 sobre 80" because each word appears on its own.
const mentioned = (transcript: string, value: string | number | null) => {
	if (value === null) return true;
	const said = new Set(normalize(transcript).split(" "));
	const words = normalize(String(value)).split(" ").filter(Boolean);
	return words.length > 0 && words.every((word) => said.has(word));
};

export const unverifiedPaths = (
	transcript: string,
	note: ClinicalNote,
): string[] => [
	...(["nombre", "cedula", "edad"] as const)
		.filter((key) => !mentioned(transcript, note.paciente[key]))
		.map((key) => `paciente.${key}`),
	...VITALS.filter(
		(vital) => !mentioned(transcript, note.signos_vitales[vital.key]),
	).map((vital) => `signos_vitales.${vital.key}`),
	...note.diagnosticos.flatMap((item, index) =>
		grounded(transcript, item.evidencia) ? [] : [`diagnosticos.${index}`],
	),
	...note.tratamiento.flatMap((item, index) => [
		...(grounded(transcript, item.evidencia) ? [] : [`tratamiento.${index}`]),
		...(mentioned(transcript, item.dosis)
			? []
			: [`tratamiento.${index}.dosis`]),
	]),
];

export const isUnverified = (c: Consultation, path: string) =>
	c.unverified.includes(path);

export const missingForLey68 = (note: ClinicalNote): string[] =>
	LEY_68_CHECKS.filter((check) => check.missing(note)).map(
		(check) => check.label,
	);

const decimal = (value: number) => String(value).replace(".", ",");

export const vitalText = (
	signos: SignosVitales,
	vital: Vital,
): string | null => {
	const value = signos[vital.key];
	if (value === null) return null;
	if (typeof value === "string" || vital.unit === null) return String(value);
	return `${decimal(value)} ${vital.unit.spoken}`;
};

export const dosageLine = (item: Medicamento) => {
	const via =
		item.via !== null && !normalize(item.via).startsWith("via")
			? `vía ${item.via}`
			: item.via;
	return [item.dosis, via, item.frecuencia, item.duracion]
		.filter((part) => part !== null)
		.join(", ");
};

export const medicationLine = (item: Medicamento) =>
	[item.medicamento, dosageLine(item)].filter(Boolean).join(", ");

export const diagnosisLine = (item: Diagnostico) =>
	item.cie10_sugerido === null
		? item.descripcion
		: `${item.descripcion}. CIE-10 sugerido: ${item.cie10_sugerido}`;

const child = (value: unknown, key: string): unknown => {
	if (Array.isArray(value)) return value[Number(key)];
	return isRecord(value) ? value[key] : undefined;
};

export const readPath = (note: ClinicalNote, path: string): string | null => {
	const value = path.split(".").reduce<unknown>(child, note);
	if (typeof value === "number") return String(value);
	return typeof value === "string" ? value : null;
};

const logged = (
	c: Consultation,
	note: ClinicalNote,
	edit: Omit<NoteEdit, "afterSigning">,
	unverified: string[],
): Consultation => ({
	...c,
	note,
	edits: [...c.edits, { ...edit, afterSigning: c.status.kind === "signed" }],
	unverified,
});

const isWithin = (flag: string, path: string) =>
	path === flag || path.startsWith(`${flag}.`);

const reindexed = (flags: readonly string[], list: ItemList, index: number) =>
	flags.flatMap((flag) => {
		const [head, position, ...rest] = flag.split(".");
		const at = Number(position);
		if (head !== list || at < index) return [flag];
		if (at === index) return [];
		return [[head, at - 1, ...rest].join(".")];
	});

export const editField = (
	c: Consultation,
	path: string,
	value: string | null,
	now: number,
): Consultation => {
	if (c.note === null) return c;
	const copy: unknown = JSON.parse(JSON.stringify(c.note));
	const keys = path.split(".");
	const leaf = keys.pop() ?? "";
	const parent = keys.reduce(child, copy);
	if (
		!isRecord(parent) ||
		!(leaf in parent) ||
		isRecord(parent[leaf]) ||
		Array.isArray(parent[leaf])
	)
		return c;
	parent[leaf] = value;
	const note = noteFrom(copy);
	// Clearing a diagnosis or medication name would silently drop the item; removeItem logs that instead.
	if (
		note === null ||
		note.diagnosticos.length !== c.note.diagnosticos.length ||
		note.tratamiento.length !== c.note.tratamiento.length
	)
		return c;
	const before = readPath(c.note, path);
	const after = readPath(note, path);
	if (before === after) return c;
	// The physician wrote this value, so the machine's doubt about it no longer applies.
	return logged(
		c,
		note,
		{ at: now, path, before, after },
		c.unverified.filter((flag) => !isWithin(flag, path)),
	);
};

export const removeItem = (
	c: Consultation,
	list: ItemList,
	index: number,
	now: number,
): Consultation => {
	const { note } = c;
	if (note === null || index < 0 || index >= note[list].length) return c;
	const path = `${list}.${index}`;
	const keep = (_: unknown, at: number) => at !== index;
	const unverified = reindexed(c.unverified, list, index);
	return list === "diagnosticos"
		? logged(
				c,
				{ ...note, diagnosticos: note.diagnosticos.filter(keep) },
				{
					at: now,
					path,
					before: diagnosisLine(note.diagnosticos[index]),
					after: null,
				},
				unverified,
			)
		: logged(
				c,
				{ ...note, tratamiento: note.tratamiento.filter(keep) },
				{
					at: now,
					path,
					before: medicationLine(note.tratamiento[index]),
					after: null,
				},
				unverified,
			);
};

export const sign = (
	c: Consultation,
	physician: Physician,
	now: number,
): Consultation =>
	c.status.kind === "signed"
		? c
		: { ...c, status: { kind: "signed", at: now, physician } };

export const editsAfterSigning = (c: Consultation) =>
	c.edits.filter((edit) => edit.afterSigning).length;

const listLines = (label: string, lines: readonly string[]) =>
	lines.length === 0
		? [`${label}: ${NOT_RECORDED}`]
		: [`${label}:`, ...lines.map((line) => `- ${line}`)];

const fieldLines = (field: NoteField, note: ClinicalNote): string[] => {
	switch (field.kind) {
		case "text":
			return [`${field.label}: ${note[field.key] ?? NOT_RECORDED}`];
		case "vitals":
			return listLines(
				field.label,
				VITALS.flatMap((vital) => {
					const value = vitalText(note.signos_vitales, vital);
					return value === null ? [] : [`${vital.label}: ${value}`];
				}),
			);
		case "diagnoses":
			return listLines(field.label, note.diagnosticos.map(diagnosisLine));
		case "medications":
			return listLines(field.label, note.tratamiento.map(medicationLine));
	}
};

const sectionLines = (section: Section, note: ClinicalNote) =>
	section.fields.flatMap((field) => fieldLines(field, note));

export const toNoteText = (c: Consultation): string => {
	const note = c.note ?? blankNote();
	const signature =
		c.status.kind === "draft"
			? [
					"Borrador sin firmar. Generado en el dispositivo; requiere revisión médica.",
				]
			: [
					`Firmado por ${c.status.physician.name}, registro ${c.status.physician.license}, ${formatDateTime(c.status.at)}`,
					...(editsAfterSigning(c) > 0
						? [`Modificaciones después de firmar: ${editsAfterSigning(c)}`]
						: []),
				];
	return [
		"Nota de consulta",
		formatDateTime(c.at),
		"",
		"Paciente",
		...PATIENT_FIELDS.map(
			(field) => `${field.label}: ${note.paciente[field.key] ?? NOT_RECORDED}`,
		),
		...SECTIONS.flatMap((section) => [
			"",
			`${section.letter}. ${section.title}`,
			...sectionLines(section, note),
		]),
		"",
		...signature,
	].join("\n");
};

const fnv1a = (seed: string, basis: number) => {
	let hash = basis;
	for (let at = 0; at < seed.length; at += 1) {
		hash ^= seed.charCodeAt(at);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
};

// Derived from the consultation id, so exporting the same note twice yields the same resource ids.
const uuidFor = (seed: string) => {
	const hex = [0x811c9dc5, 0x2545f491, 0x9e3779b9, 0x85ebca6b]
		.map((basis) => fnv1a(seed, basis))
		.join("");
	return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const escapeXml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");

const narrativeOf = (lines: readonly string[]) => ({
	status: "generated",
	div: `<div xmlns="http://www.w3.org/1999/xhtml">${lines.map((line) => `<p>${escapeXml(line)}</p>`).join("")}</div>`,
});

const GENDER: Record<Sexo, string> = {
	Femenino: "female",
	Masculino: "male",
};

export const toFhirBundle = (c: Consultation): FhirBundle => {
	const note = c.note ?? blankNote();
	const signed = c.status.kind === "signed" ? c.status : null;
	const iso = (at: number) => new Date(at).toISOString();
	const url = (name: string) => uuidFor(`${c.id}/${name}`);
	const patient = { reference: url("patient") };
	const encounter = { reference: url("encounter") };
	const practitioner = { reference: url("practitioner") };
	const updatedAt = Math.max(
		c.at,
		signed?.at ?? c.at,
		...c.edits.map((edit) => edit.at),
	);

	const observations = VITALS.flatMap((vital) => {
		const value = note.signos_vitales[vital.key];
		if (value === null) return [];
		const resource: FhirResource = {
			resourceType: "Observation",
			status: signed ? "final" : "preliminary",
			category: [
				{
					coding: [
						{
							system:
								"http://terminology.hl7.org/CodeSystem/observation-category",
							code: "vital-signs",
							display: "Vital Signs",
						},
					],
				},
			],
			code: {
				coding: [{ system: "http://loinc.org", ...vital.loinc }],
				text: vital.label,
			},
			subject: patient,
			encounter,
			effectiveDateTime: iso(c.at),
			...(typeof value === "string" || vital.unit === null
				? { valueString: String(value) }
				: {
						valueQuantity: {
							value,
							unit: vital.unit.ucum,
							system: "http://unitsofmeasure.org",
							code: vital.unit.ucum,
						},
					}),
		};
		return [{ fullUrl: url(`observation/${vital.key}`), resource }];
	});

	const conditions = note.diagnosticos.map((item, index) => ({
		fullUrl: url(`condition/${index}`),
		resource: {
			resourceType: "Condition",
			code: {
				text: item.descripcion,
				...(item.cie10_sugerido === null
					? {}
					: {
							coding: [
								{
									system: "http://hl7.org/fhir/sid/icd-10",
									code: item.cie10_sugerido,
								},
							],
						}),
			},
			subject: patient,
			encounter,
			recordedDate: iso(c.at),
		},
	}));

	const medications = note.tratamiento.map((item, index) => {
		const dosage = dosageLine(item);
		return {
			fullUrl: url(`medication-request/${index}`),
			resource: {
				resourceType: "MedicationRequest",
				status: signed ? "active" : "draft",
				intent: "order",
				medicationCodeableConcept: { text: item.medicamento },
				subject: patient,
				encounter,
				authoredOn: iso(c.at),
				...(signed ? { requester: practitioner } : {}),
				...(dosage === "" ? {} : { dosageInstruction: [{ text: dosage }] }),
			},
		};
	});

	const entriesFor: Record<
		Section["letter"],
		ReadonlyArray<{ fullUrl: string }>
	> = { S: [], O: observations, A: conditions, P: medications };

	const composition: FhirResource = {
		resourceType: "Composition",
		status: signed ? "final" : "preliminary",
		type: {
			coding: [
				{
					system: "http://loinc.org",
					code: "34108-1",
					display: "Outpatient Note",
				},
			],
			text: "Nota de consulta",
		},
		subject: patient,
		encounter,
		date: iso(updatedAt),
		author: signed
			? [practitioner]
			: [{ display: "Borrador generado en el dispositivo" }],
		title: "Nota de consulta",
		...(signed
			? {
					attester: [
						{ mode: "legal", time: iso(signed.at), party: practitioner },
					],
				}
			: {}),
		section: SECTIONS.map((section) => ({
			title: section.title,
			text: narrativeOf(sectionLines(section, note)),
			...(entriesFor[section.letter].length === 0
				? {}
				: {
						entry: entriesFor[section.letter].map((entry) => ({
							reference: entry.fullUrl,
						})),
					}),
		})),
	};

	const { nombre, cedula, sexo } = note.paciente;
	return {
		resourceType: "Bundle",
		type: "document",
		identifier: { system: "urn:ietf:rfc:3986", value: url("bundle") },
		timestamp: iso(updatedAt),
		entry: [
			{ fullUrl: url("composition"), resource: composition },
			{
				fullUrl: patient.reference,
				resource: {
					resourceType: "Patient",
					...(nombre === null ? {} : { name: [{ text: nombre }] }),
					...(cedula === null
						? {}
						: { identifier: [{ type: { text: "Cédula" }, value: cedula }] }),
					gender: sexo === null ? "unknown" : GENDER[sexo],
				},
			},
			{
				fullUrl: encounter.reference,
				resource: {
					resourceType: "Encounter",
					status: "finished",
					class: {
						system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
						code: "AMB",
						display: "ambulatory",
					},
					subject: patient,
					period: { start: iso(c.at) },
				},
			},
			...(signed
				? [
						{
							fullUrl: practitioner.reference,
							resource: {
								resourceType: "Practitioner",
								name: [{ text: signed.physician.name }],
								identifier: [
									{
										type: { text: "Registro o idoneidad" },
										value: signed.physician.license,
									},
								],
							},
						},
					]
				: []),
			...observations,
			...conditions,
			...medications,
		],
	};
};
