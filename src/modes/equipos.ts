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
	source: string;
	extraction: Extraction | null;
	unverified: string[];
};

export type Grounded = Pick<Visit, "extraction" | "unverified">;

export type UnitAge = { years: number; count: number };

export type Unit = {
	key: string;
	modality: Modality;
	brand: string | null;
	model: string | null;
	quantity: number | null;
	age: UnitAge | null;
	status: Status;
	confirmations: number;
	lastSeenAt: number;
	confidence: number;
	renewals: number;
	stale: boolean;
	sources: string[];
	seen: Array<{ visitId: string; index: number }>;
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
	"brand" | "model" | "age" | "status" | "confirmations" | "stale"
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
const MAX_TEXT = 60;
const TEXT_RECALL = 0.7;

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

// Matched against normalized text, so accents are gone and plurals share the stem.
const MODALITY_WORDS: Record<Modality, RegExp | null> = {
	"Resonancia magnética": /\b(resonador|resonancia)/,
	Tomografía: /\b(tomograf|tac\b)/,
	Ultrasonido: /\b(ecograf|ultrasonido)/,
	"Rayos X": /\brayos x\b/,
	Mamografía: /\bmamograf/,
	Angiografía: /\bangiograf/,
	"Medicina nuclear": /\bgammacamara/,
	Otro: null,
};

const PRODUCT_LINES: ReadonlyArray<{
	line: string;
	brand: string;
	modality: Modality;
}> = [
	{ line: "Ingenia", brand: "Philips", modality: "Resonancia magnética" },
	{ line: "Aquilion", brand: "Canon", modality: "Tomografía" },
	{ line: "Somatom", brand: "Siemens", modality: "Tomografía" },
	{ line: "Logiq", brand: "GE", modality: "Ultrasonido" },
	{ line: "EPIQ", brand: "Philips", modality: "Ultrasonido" },
	{ line: "Azurion", brand: "Philips", modality: "Angiografía" },
];

const NUMBER_WORDS = new Map([
	["un", 1],
	["uno", 1],
	["una", 1],
	["dos", 2],
	["tres", 3],
	["cuatro", 4],
	["cinco", 5],
	["seis", 6],
	["siete", 7],
	["ocho", 8],
	["nueve", 9],
	["diez", 10],
]);

// Without a cap the grammar lets a small model repeat text inside one string until the token limit.
const nullable = (type: "string" | "integer" | "number") =>
	type === "string"
		? { type: [type, "null"], maxLength: MAX_TEXT }
		: { type: [type, "null"] };

export const EXTRACTION_SCHEMA = {
	type: "object",
	properties: {
		cliente: nullable("string"),
		ciudad: nullable("string"),
		pais: nullable("string"),
		equipos: {
			type: "array",
			maxItems: 8,
			items: {
				type: "object",
				properties: {
					modalidad: {
						type: "string",
						enum: [...MODALITIES],
						maxLength: MAX_TEXT,
					},
					cantidad: nullable("integer"),
					marca: nullable("string"),
					modelo: nullable("string"),
					antiguedad_anios: nullable("number"),
					estado: { type: "string", enum: [...STATUSES], maxLength: MAX_TEXT },
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

const EXAMPLE_TEXT =
	"Estoy en la Clínica Los Almendros, en Colón. Vi un ecógrafo Siemens de 2019 y me dijeron que tienen dos mamógrafos, no sé de qué marca.";

const example = (year: number): Extraction => ({
	cliente: "Clínica Los Almendros",
	ciudad: "Colón",
	pais: null,
	equipos: [
		{
			modalidad: "Ultrasonido",
			cantidad: 1,
			marca: "Siemens",
			modelo: null,
			antiguedad_anios: year - 2019,
			estado: "Confirmado",
		},
		{
			modalidad: "Mamografía",
			cantidad: 2,
			marca: null,
			modelo: null,
			antiguedad_anios: null,
			estado: "Reportado",
		},
	],
});

const systemPrompt = (year: number) =>
	"Extraes datos de equipos médicos instalados a partir de lo que dice un colaborador de campo después de visitar un hospital. " +
	`Estamos en ${year}, así que un equipo "de 2015" tiene ${year - 2015} años de antigüedad. ` +
	"Usa null cuando un dato no se mencione. No inventes marcas, modelos ni años. " +
	`Un modelo conocido indica su modalidad y marca. ${PRODUCT_LINES.map((line) => `${line.line} es ${line.modality.toLowerCase()} ${line.brand}`).join(", ")}. ` +
	'estado es "Confirmado" si lo vio directamente, "Reportado" si alguien del hospital se lo dijo, "Estimado" si lo aproxima o duda (parece, unos, creo, más o menos) y "Desconocido" si no hay forma de saberlo. ' +
	`Ejemplo.\nTexto: ${EXAMPLE_TEXT}\nDatos: ${JSON.stringify(example(year))}`;

export const equiposRequest = (text: string, now: Date): ExtractionRequest => ({
	history: [
		{ role: "system", content: systemPrompt(now.getFullYear()) },
		{ role: "user", content: `Texto: ${text}` },
	],
	responseFormat: {
		type: "json_schema",
		json_schema: { name: "equipos", schema: EXTRACTION_SCHEMA },
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

const textOf = (value: unknown): string | null => {
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value !== "string") return null;
	return value.trim() || null;
};

const amount = (value: unknown, min: number): number | null => {
	const raw = textOf(value);
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
		marca: textOf(value.marca),
		modelo: textOf(value.modelo),
		antiguedad_anios: amount(value.antiguedad_anios, 0),
		estado: oneOf(STATUSES, value.estado) ?? "Desconocido",
	};
};

const usable = (extraction: Extraction) =>
	Boolean(
		extraction.cliente ||
			extraction.ciudad ||
			extraction.pais ||
			extraction.equipos.length > 0,
	);

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
	const extraction: Extraction = {
		cliente: textOf(raw.cliente),
		ciudad: textOf(raw.ciudad),
		pais: textOf(raw.pais),
		equipos: Array.isArray(raw.equipos)
			? raw.equipos
					.map(parseUnit)
					.filter((unit): unit is ExtractedUnit => unit !== null)
			: [],
	};
	return usable(extraction) ? extraction : null;
};

type Evidence = {
	text: string;
	words: Set<string>;
	numbers: Set<number>;
	yearsAgo: Set<number>;
};

// Four-digit tokens count as years, never as a quantity or an age, so "de 2015" cannot become 2015 years.
const evidenceOf = (source: string, now: Date): Evidence => {
	const text = normalize(source);
	const words = text.split(" ");
	return {
		text,
		words: new Set(words),
		numbers: new Set(
			words.flatMap((word) => {
				const said =
					NUMBER_WORDS.get(word) ??
					(/^\d{1,3}$/.test(word) ? Number(word) : undefined);
				return said === undefined ? [] : [said];
			}),
		),
		yearsAgo: new Set(
			words
				.filter((word) => /^\d{4}$/.test(word))
				.map((year) => now.getFullYear() - Number(year)),
		),
	};
};

const recalled = (value: string, said: Evidence) => {
	const words = normalize(value).split(" ").filter(Boolean);
	const found = words.filter((word) => said.words.has(word)).length;
	return words.length > 0 && found / words.length >= TEXT_RECALL;
};

const linesSaid = (modality: Modality, said: Evidence) =>
	PRODUCT_LINES.filter(
		(line) =>
			line.modality === modality && said.words.has(normalize(line.line)),
	);

const modalitySaid = (modality: Modality, said: Evidence) =>
	(MODALITY_WORDS[modality]?.test(said.text) ?? false) ||
	linesSaid(modality, said).length > 0;

export const groundExtraction = (
	extraction: Extraction,
	source: string,
	now: Date,
): Grounded => {
	const said = evidenceOf(source, now);
	const unverified: string[] = [];
	const keep = <T>(
		path: string,
		value: T | null,
		grounded: (value: T) => boolean,
	): T | null => {
		if (value === null || grounded(value)) return value;
		unverified.push(path);
		return null;
	};
	const place = (path: "cliente" | "ciudad" | "pais") =>
		keep(path, extraction[path], (value) => recalled(value, said));
	const cliente = place("cliente");
	const ciudad = place("ciudad");
	const pais = place("pais");
	const equipos = extraction.equipos
		.filter((unit) => modalitySaid(unit.modalidad, said))
		.map((unit, index) => {
			const at = `equipos.${index}`;
			const lines = linesSaid(unit.modalidad, said);
			return {
				...unit,
				cantidad: keep(`${at}.cantidad`, unit.cantidad, (count) =>
					said.numbers.has(count),
				),
				marca: keep(
					`${at}.marca`,
					unit.marca,
					(brand) =>
						recalled(brand, said) ||
						lines.some((line) => normalize(line.brand) === normalize(brand)),
				),
				modelo: keep(`${at}.modelo`, unit.modelo, (model) =>
					recalled(model, said),
				),
				antiguedad_anios: keep(
					`${at}.antiguedad_anios`,
					unit.antiguedad_anios,
					(age) => said.numbers.has(age) || said.yearsAgo.has(age),
				),
			};
		});
	const grounded = { cliente, ciudad, pais, equipos };
	return usable(grounded)
		? { extraction: grounded, unverified }
		: { extraction: null, unverified: [] };
};

export const assembleEquipos = (
	text: string,
	modelText: string,
	now: Date,
): Grounded => {
	const parsed = parseExtraction(modelText);
	return parsed === null
		? { extraction: null, unverified: [] }
		: groundExtraction(parsed, text, now);
};

type Sighting = { index: number; unit: ExtractedUnit };
type UnitVisit = {
	visitId: string;
	at: number;
	source: string;
	sightings: Sighting[];
};
type UnitDraft = { key: string; modality: Modality; visits: UnitVisit[] };
type ClientDraft = {
	key: string;
	reports: Array<{ at: number; extraction: Extraction }>;
	units: UnitDraft[];
};
type Placement = { draft: UnitDraft; stacked: boolean; agreement: number };

const latest = <T>(values: readonly (T | null)[]): T | null =>
	values.reduce<T | null>((found, value) => value ?? found, null);

const sum = (values: readonly number[]) =>
	values.reduce((total, value) => total + value, 0);

const compatible = (a: string | null, b: string | null) =>
	a === null || b === null || normalize(a) === normalize(b);

const machines = (unit: ExtractedUnit) => unit.cantidad ?? 1;

const unitsOf = (draft: UnitDraft) =>
	draft.visits.flatMap((visit) => visit.sightings.map((seen) => seen.unit));

const quantityReported = ({ sightings }: UnitVisit) =>
	sightings.length === 1
		? (sightings[0]?.unit.cantidad ?? null)
		: sum(sightings.map((seen) => machines(seen.unit)));

const quantityOf = (visits: readonly UnitVisit[]) => {
	const counts = visits.flatMap((visit) => quantityReported(visit) ?? []);
	return counts.length > 0 ? Math.max(...counts) : null;
};

// One visit can report the same unit several times, but never more machines than the unit is known to have.
const placement = (
	draft: UnitDraft,
	visitId: string,
	unit: ExtractedUnit,
): Placement | null => {
	const units = unitsOf(draft);
	const brand = latest(units.map((seen) => seen.marca));
	const model = latest(units.map((seen) => seen.modelo));
	if (
		draft.modality !== unit.modalidad ||
		!compatible(brand, unit.marca) ||
		!compatible(model, unit.modelo)
	)
		return null;
	const current = draft.visits.find((visit) => visit.visitId === visitId);
	const load = sum(current?.sightings.map((seen) => machines(seen.unit)) ?? []);
	if (current && load + machines(unit) > (quantityOf(draft.visits) ?? 0))
		return null;
	return {
		draft,
		stacked: current !== undefined,
		agreement:
			Number(brand !== null && unit.marca !== null) +
			Number(model !== null && unit.modelo !== null),
	};
};

const preferred = (a: Placement, b: Placement) =>
	Number(a.stacked) - Number(b.stacked) || b.agreement - a.agreement;

const wholeYearsBetween = (from: number, to: number) =>
	Math.max(0, Math.floor((to - from) / YEAR_MS));

// The latest visit that gave any age decides; if it gave several, the oldest wins and covers only the machines said to be that old.
const ageOf = (visits: readonly UnitVisit[], now: number): UnitAge | null => {
	const aged = visits
		.map((visit) => ({
			at: visit.at,
			said: visit.sightings.flatMap(({ unit }) =>
				unit.antiguedad_anios === null
					? []
					: [{ years: unit.antiguedad_anios, count: machines(unit) }],
			),
		}))
		.filter((visit) => visit.said.length > 0)
		.at(-1);
	if (aged === undefined) return null;
	const years = Math.max(...aged.said.map((said) => said.years));
	return {
		years: years + wholeYearsBetween(aged.at, now),
		count: sum(
			aged.said
				.filter((said) => said.years === years)
				.map((said) => said.count),
		),
	};
};

export const confidenceFactors = (unit: ConfidenceInput): ConfidenceFactor[] =>
	[
		{ label: "Marca", points: unit.brand === null ? 0 : 15 },
		{ label: "Modelo", points: unit.model === null ? 0 : 15 },
		{ label: "Antigüedad", points: unit.age === null ? 0 : 15 },
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
	const { visits } = draft;
	const units = unitsOf(draft);
	const lastSeenAt = Math.max(...visits.map((visit) => visit.at));
	const age = ageOf(visits, now);
	const facts = {
		brand: latest(units.map((unit) => unit.marca)),
		model: latest(units.map((unit) => unit.modelo)),
		age,
		status:
			STATUSES.find((status) => units.some((unit) => unit.estado === status)) ??
			"Desconocido",
		confirmations: visits.length,
		stale: now - lastSeenAt > STALE_AFTER_MS,
	};
	return {
		key: draft.key,
		modality: draft.modality,
		quantity: quantityOf(visits),
		lastSeenAt,
		renewals: age !== null && age.years >= RENEWAL_YEARS ? age.count : 0,
		confidence: confidence({ ...facts, located }),
		sources: [...new Set(visits.map((visit) => visit.source))],
		seen: visits.flatMap((visit) =>
			visit.sightings.map((seen) => ({
				visitId: visit.visitId,
				index: seen.index,
			})),
		),
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
			const sighting = { index, unit };
			const [best] = client.units
				.flatMap((draft) => placement(draft, visit.id, unit) ?? [])
				.sort(preferred);
			const current = best?.draft.visits.find(
				(seen) => seen.visitId === visit.id,
			);
			if (current) {
				current.sightings.push(sighting);
				return;
			}
			const report = {
				visitId: visit.id,
				at: visit.at,
				source: visit.source,
				sightings: [sighting],
			};
			if (best) best.draft.visits.push(report);
			else
				client.units.push({
					key: `${key}/${visit.id}/${index}`,
					modality: unit.modalidad,
					visits: [report],
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
		renewals: sum(units.map((unit) => unit.renewals)),
		stale: count(units.filter((unit) => unit.stale)),
	};
};

// Asks about the units this visit merged into, so a datum an earlier visit already gave is not asked again.
export const nextQuestion = (
	visit: Visit,
	bases: readonly ClientBase[],
): string | null => {
	const { extraction } = visit;
	if (extraction === null) return null;
	if (!extraction.cliente) return "¿En qué hospital o clínica estás?";
	const key = normalize(extraction.cliente);
	const base = bases.find((found) => found.key === key);
	const units = extraction.equipos.flatMap(
		(_, index) =>
			base?.units.find((unit) =>
				unit.seen.some(
					(seen) => seen.visitId === visit.id && seen.index === index,
				),
			) ?? [],
	);
	const unbranded = units.find((unit) => unit.brand === null);
	if (unbranded) return `¿De qué marca es ${UNIT_NOUN[unbranded.modality]}?`;
	const undated = units.find((unit) => unit.age === null);
	if (undated) return `¿Qué antigüedad tiene ${UNIT_NOUN[undated.modality]}?`;
	if (!base?.city && !base?.country)
		return `¿En qué ciudad está ${extraction.cliente}?`;
	return null;
};

export const appendAnswer = (
	text: string,
	question: string,
	answer: string,
): string =>
	answer.trim()
		? `${text.trim()}\nPregunta: ${question}\nRespuesta: ${answer.trim()}`
		: text;

export const equiposColumns = [
	{ key: "cliente", label: "Cliente" },
	{ key: "ciudad", label: "Ciudad" },
	{ key: "pais", label: "País" },
	{ key: "modalidad", label: "Modalidad" },
	{ key: "cantidad", label: "Cantidad" },
	{ key: "marca", label: "Marca" },
	{ key: "modelo", label: "Modelo" },
	{ key: "antiguedad_anios", label: "Antigüedad (años)" },
	{ key: "con_antiguedad", label: "Con esa antigüedad" },
	{ key: "estado", label: "Estado" },
	{ key: "confianza", label: "Confianza" },
	{ key: "confirmaciones", label: "Confirmaciones" },
	{ key: "ultima_visita", label: "Última visita" },
	{ key: "por_renovar", label: "Por renovar" },
	{ key: "sin_verificar", label: "Sin verificar" },
	{ key: "texto_original", label: "Texto original" },
] as const;

export type EquiposKey = (typeof equiposColumns)[number]["key"];

export type EquiposRow = Record<EquiposKey, string | number | null>;

const localIsoDate = (at: number) => {
	const date = new Date(at);
	const pad = (part: number) => String(part).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const yesNo = (flag: boolean) => (flag ? "Sí" : "No");

export const equiposRows = (bases: readonly ClientBase[]): EquiposRow[] =>
	bases.flatMap((base) =>
		base.units.map((unit) => ({
			cliente: base.name,
			ciudad: base.city,
			pais: base.country,
			modalidad: unit.modality,
			cantidad: unit.quantity,
			marca: unit.brand,
			modelo: unit.model,
			antiguedad_anios: unit.age?.years ?? null,
			con_antiguedad: unit.age?.count ?? null,
			estado: unit.status,
			confianza: unit.confidence,
			confirmaciones: unit.confirmations,
			ultima_visita: localIsoDate(unit.lastSeenAt),
			por_renovar: unit.renewals,
			sin_verificar: yesNo(unit.stale),
			texto_original: unit.sources.join("\n"),
		})),
	);

const csvCell = (value: string | number | null) => {
	const cell = value === null ? "" : String(value);
	return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
};

// The BOM makes Excel read the file as UTF-8, so "País" and "Antigüedad" survive.
export const equiposCsv = (bases: readonly ClientBase[]): string =>
	`\uFEFF${[
		equiposColumns.map((column) => column.label),
		...equiposRows(bases).map((row) =>
			equiposColumns.map((column) => row[column.key]),
		),
	]
		.map((cells) => cells.map(csvCell).join(","))
		.join("\r\n")}\r\n`;
