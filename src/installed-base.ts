export const MODALITIES = [
	"Resonancia magnética",
	"Tomografía",
	"Ultrasonido",
	"Rayos X",
	"Mamografía",
	"Angiografía",
	"Medicina nuclear",
	"Otro",
] as const;
export type Modality = (typeof MODALITIES)[number];

export const STATUSES = [
	"Confirmado",
	"Reportado",
	"Estimado",
	"Desconocido",
] as const;
export type Status = (typeof STATUSES)[number];

export type ExtractedUnit = {
	modalidad: Modality;
	cantidad: number | null;
	marca: string | null;
	modelo: string | null;
	antiguedad_anios: number | null;
	estado: Status;
};

export type Extraction = {
	cliente: string | null;
	ciudad: string | null;
	pais: string | null;
	equipos: ExtractedUnit[];
};

export type Visit = {
	id: string;
	at: number;
	said: string;
	extraction: Extraction | null;
};

export type Unit = {
	key: string;
	modality: Modality;
	brand: string | null;
	model: string | null;
	quantity: number | null;
	ageYears: number | null;
	status: Status;
	confirmations: number;
	lastSeenAt: number;
	confidence: number;
	renewal: boolean;
	stale: boolean;
};

export type ClientBase = {
	key: string;
	name: string;
	city: string | null;
	country: string | null;
	lastVisitAt: number;
	units: Unit[];
};

export type FleetSummary = {
	clients: number;
	units: number;
	byModality: Array<{ modality: Modality; units: number }>;
	renewals: number;
	stale: number;
};

export type ConfidenceInput = Pick<
	Unit,
	"brand" | "model" | "ageYears" | "status" | "confirmations" | "stale"
> & { located: boolean };

export type ConfidenceFactor = { label: string; points: number };

export type ExtractionRequest = {
	history: Array<{ role: "system" | "user"; content: string }>;
	responseFormat: {
		type: "json_schema";
		json_schema: { name: string; schema: typeof EXTRACTION_SCHEMA };
	};
	generationParams: { temp: number; predict: number };
};

const DAY_MS = 86_400_000;
const YEAR_MS = 365.25 * DAY_MS;
const STALE_AFTER_MS = 180 * DAY_MS;
const RENEWAL_YEARS = 8;

const STATUS_POINTS: Record<Status, number> = {
	Confirmado: 25,
	Reportado: 15,
	Estimado: 8,
	Desconocido: 0,
};

const UNIT_NOUN: Record<Modality, string> = {
	"Resonancia magnética": "el resonador",
	Tomografía: "el tomógrafo",
	Ultrasonido: "el ecógrafo",
	"Rayos X": "el equipo de rayos X",
	Mamografía: "el mamógrafo",
	Angiografía: "el angiógrafo",
	"Medicina nuclear": "la gammacámara",
	Otro: "el equipo",
};

const CSV_HEADER = [
	"Cliente",
	"Ciudad",
	"País",
	"Modalidad",
	"Cantidad",
	"Marca",
	"Modelo",
	"Antigüedad (años)",
	"Estado",
	"Confirmaciones",
	"Confianza",
	"Última visita",
];

const nullable = (type: "string" | "integer" | "number") => ({
	type: [type, "null"],
});

export const EXTRACTION_SCHEMA = {
	type: "object",
	properties: {
		cliente: nullable("string"),
		ciudad: nullable("string"),
		pais: nullable("string"),
		equipos: {
			type: "array",
			items: {
				type: "object",
				properties: {
					modalidad: { type: "string", enum: [...MODALITIES] },
					cantidad: nullable("integer"),
					marca: nullable("string"),
					modelo: nullable("string"),
					antiguedad_anios: nullable("number"),
					estado: { type: "string", enum: [...STATUSES] },
				},
				required: [
					"modalidad",
					"cantidad",
					"marca",
					"modelo",
					"antiguedad_anios",
					"estado",
				],
			},
		},
	},
	required: ["cliente", "ciudad", "pais", "equipos"],
};

const systemPrompt = (year: number) =>
	"Extraes datos de equipos médicos instalados a partir de lo que dice un colaborador de campo después de visitar un hospital. " +
	`Estamos en ${year}, así que un equipo "de 2015" tiene ${year - 2015} años de antigüedad. ` +
	"Usa null cuando un dato no se mencione. No inventes marcas, modelos ni años. " +
	"Un modelo conocido indica su modalidad y marca. Ingenia es resonancia Philips, Aquilion es tomografía Canon, Somatom es tomografía Siemens, Logiq es ultrasonido GE y EPIQ es ultrasonido Philips. " +
	'estado es "Confirmado" si lo vio directamente, "Reportado" si alguien del hospital se lo dijo, "Estimado" si lo aproxima o duda (parece, unos, creo, más o menos) y "Desconocido" si no hay forma de saberlo.';

export const extractionRequest = (
	said: string,
	now: Date,
): ExtractionRequest => ({
	history: [
		{ role: "system", content: systemPrompt(now.getFullYear()) },
		{ role: "user", content: said },
	],
	responseFormat: {
		type: "json_schema",
		json_schema: { name: "observacion", schema: EXTRACTION_SCHEMA },
	},
	generationParams: { temp: 0, predict: 512 },
});

const normalize = (value: string) =>
	value
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null => {
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value !== "string") return null;
	return value.trim() || null;
};

const amount = (value: unknown, min: number): number | null => {
	const raw = text(value);
	if (raw === null) return null;
	const parsed = Number(raw.replace(",", "."));
	return Number.isFinite(parsed) && parsed >= min ? parsed : null;
};

const oneOf = <T extends string>(options: readonly T[], value: unknown) => {
	const wanted = typeof value === "string" ? normalize(value) : "";
	return options.find((option) => normalize(option) === wanted);
};

const parseUnit = (value: unknown): ExtractedUnit | null => {
	if (!isRecord(value)) return null;
	const cantidad = amount(value.cantidad, 1);
	return {
		modalidad: oneOf(MODALITIES, value.modalidad) ?? "Otro",
		cantidad: cantidad === null ? null : Math.round(cantidad),
		marca: text(value.marca),
		modelo: text(value.modelo),
		antiguedad_anios: amount(value.antiguedad_anios, 0),
		estado: oneOf(STATUSES, value.estado) ?? "Desconocido",
	};
};

export const parseExtraction = (response: string): Extraction | null => {
	const start = response.indexOf("{");
	const end = response.lastIndexOf("}");
	if (start === -1 || end < start) return null;
	let raw: unknown;
	try {
		raw = JSON.parse(response.slice(start, end + 1));
	} catch {
		return null;
	}
	if (!isRecord(raw)) return null;
	const equipos = Array.isArray(raw.equipos)
		? raw.equipos
				.map(parseUnit)
				.filter((unit): unit is ExtractedUnit => unit !== null)
		: [];
	const extraction: Extraction = {
		cliente: text(raw.cliente),
		ciudad: text(raw.ciudad),
		pais: text(raw.pais),
		equipos,
	};
	const usable =
		extraction.cliente ||
		extraction.ciudad ||
		extraction.pais ||
		equipos.length > 0;
	return usable ? extraction : null;
};

type Sighting = { visitId: string; at: number; unit: ExtractedUnit };
type UnitDraft = { key: string; modality: Modality; sightings: Sighting[] };
type ClientDraft = {
	key: string;
	reports: Array<{ at: number; extraction: Extraction }>;
	units: UnitDraft[];
};

const latest = <T>(values: readonly (T | null)[]): T | null =>
	values.reduce<T | null>((found, value) => value ?? found, null);

const compatible = (a: string | null, b: string | null) =>
	a === null || b === null || normalize(a) === normalize(b);

const matchScore = (draft: UnitDraft, sighting: Sighting) => {
	const brand = latest(draft.sightings.map((seen) => seen.unit.marca));
	const model = latest(draft.sightings.map((seen) => seen.unit.modelo));
	const { unit } = sighting;
	// Two entries in the same visit are two different machines, never one seen twice.
	if (
		draft.sightings.some((seen) => seen.visitId === sighting.visitId) ||
		draft.modality !== unit.modalidad ||
		!compatible(brand, unit.marca) ||
		!compatible(model, unit.modelo)
	)
		return -1;
	return (
		Number(brand !== null && unit.marca !== null) +
		Number(model !== null && unit.modelo !== null)
	);
};

const wholeYearsBetween = (from: number, to: number) =>
	Math.max(0, Math.floor((to - from) / YEAR_MS));

export const confidenceFactors = (unit: ConfidenceInput): ConfidenceFactor[] =>
	[
		{ label: "Marca", points: unit.brand === null ? 0 : 15 },
		{ label: "Modelo", points: unit.model === null ? 0 : 15 },
		{ label: "Antigüedad", points: unit.ageYears === null ? 0 : 15 },
		{ label: "Ubicación", points: unit.located ? 15 : 0 },
		{ label: unit.status, points: STATUS_POINTS[unit.status] },
		{ label: "Varias visitas", points: unit.confirmations >= 2 ? 15 : 0 },
		{ label: "Sin visitas recientes", points: unit.stale ? -20 : 0 },
	].filter((factor) => factor.points !== 0);

export const confidence = (unit: ConfidenceInput): number => {
	const total = confidenceFactors(unit).reduce(
		(sum, factor) => sum + factor.points,
		0,
	);
	return Math.min(100, Math.max(0, total));
};

const toUnit = (draft: UnitDraft, located: boolean, now: number): Unit => {
	const { sightings } = draft;
	const units = sightings.map((seen) => seen.unit);
	const aged = sightings.reduce<{ at: number; age: number } | null>(
		(found, seen) =>
			seen.unit.antiguedad_anios === null
				? found
				: { at: seen.at, age: seen.unit.antiguedad_anios },
		null,
	);
	const counts = units.flatMap((unit) =>
		unit.cantidad === null ? [] : [unit.cantidad],
	);
	const lastSeenAt = Math.max(...sightings.map((seen) => seen.at));
	const ageYears =
		aged === null ? null : aged.age + wholeYearsBetween(aged.at, now);
	const facts = {
		brand: latest(units.map((unit) => unit.marca)),
		model: latest(units.map((unit) => unit.modelo)),
		ageYears,
		status:
			STATUSES.find((status) => units.some((unit) => unit.estado === status)) ??
			"Desconocido",
		confirmations: sightings.length,
		stale: now - lastSeenAt > STALE_AFTER_MS,
	};
	return {
		key: draft.key,
		modality: draft.modality,
		quantity: counts.length > 0 ? Math.max(...counts) : null,
		lastSeenAt,
		renewal: ageYears !== null && ageYears >= RENEWAL_YEARS,
		confidence: confidence({ ...facts, located }),
		...facts,
	};
};

const toClientBase = (client: ClientDraft, now: number): ClientBase => {
	const extractions = client.reports.map((report) => report.extraction);
	const city = latest(extractions.map((extraction) => extraction.ciudad));
	const country = latest(extractions.map((extraction) => extraction.pais));
	const located = city !== null || country !== null;
	return {
		key: client.key,
		name: latest(extractions.map((extraction) => extraction.cliente)) ?? "",
		city,
		country,
		lastVisitAt: Math.max(...client.reports.map((report) => report.at)),
		units: client.units.map((draft) => toUnit(draft, located, now)),
	};
};

export const installedBase = (
	visits: readonly Visit[],
	now: number,
): ClientBase[] => {
	const clients = new Map<string, ClientDraft>();
	for (const visit of [...visits].sort((a, b) => a.at - b.at)) {
		const { extraction } = visit;
		const key = extraction?.cliente ? normalize(extraction.cliente) : "";
		if (!extraction || !key) continue;
		const client = clients.get(key) ?? { key, reports: [], units: [] };
		clients.set(key, client);
		client.reports.push({ at: visit.at, extraction });
		extraction.equipos.forEach((unit, index) => {
			const sighting = { visitId: visit.id, at: visit.at, unit };
			const best = client.units.reduce<{
				draft: UnitDraft | null;
				score: number;
			}>(
				(found, draft) => {
					const score = matchScore(draft, sighting);
					return score > found.score ? { draft, score } : found;
				},
				{ draft: null, score: -1 },
			);
			if (best.draft) best.draft.sightings.push(sighting);
			else
				client.units.push({
					key: `${key}/${visit.id}/${index}`,
					modality: unit.modalidad,
					sightings: [sighting],
				});
		});
	}
	return [...clients.values()]
		.map((client) => toClientBase(client, now))
		.sort((a, b) => b.lastVisitAt - a.lastVisitAt);
};

export const fleetSummary = (bases: readonly ClientBase[]): FleetSummary => {
	const units = bases.flatMap((base) => base.units);
	const count = (list: readonly Unit[]) =>
		list.reduce((sum, unit) => sum + (unit.quantity ?? 1), 0);
	return {
		clients: bases.length,
		units: count(units),
		byModality: MODALITIES.map((modality) => ({
			modality,
			units: count(units.filter((unit) => unit.modality === modality)),
		}))
			.filter((entry) => entry.units > 0)
			.sort((a, b) => b.units - a.units),
		renewals: count(units.filter((unit) => unit.renewal)),
		stale: count(units.filter((unit) => unit.stale)),
	};
};

export const nextQuestion = (extraction: Extraction): string | null => {
	if (!extraction.cliente) return "¿En qué hospital o clínica estás?";
	const unbranded = extraction.equipos.find((unit) => unit.marca === null);
	if (unbranded) return `¿De qué marca es ${UNIT_NOUN[unbranded.modalidad]}?`;
	const undated = extraction.equipos.find(
		(unit) => unit.antiguedad_anios === null,
	);
	if (undated) return `¿Qué antigüedad tiene ${UNIT_NOUN[undated.modalidad]}?`;
	if (!extraction.ciudad && !extraction.pais)
		return `¿En qué ciudad está ${extraction.cliente}?`;
	return null;
};

export const appendAnswer = (
	said: string,
	question: string,
	answer: string,
): string =>
	answer.trim()
		? `${said.trim()}\nPregunta: ${question}\nRespuesta: ${answer.trim()}`
		: said;

const csvCell = (value: string | number | null) => {
	const cell = value === null ? "" : String(value);
	return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
};

const localIsoDate = (at: number) => {
	const date = new Date(at);
	const pad = (part: number) => String(part).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// The BOM makes Excel read the file as UTF-8, so "País" and "Antigüedad" survive.
export const toCsv = (bases: readonly ClientBase[]): string =>
	`\uFEFF${[
		CSV_HEADER,
		...bases.flatMap((base) =>
			base.units.map((unit) => [
				base.name,
				base.city,
				base.country,
				unit.modality,
				unit.quantity,
				unit.brand,
				unit.model,
				unit.ageYears,
				unit.status,
				unit.confirmations,
				unit.confidence,
				localIsoDate(unit.lastSeenAt),
			]),
		),
	]
		.map((row) => row.map(csvCell).join(","))
		.join("\r\n")}`;
