import { normalizeNumbers } from "../grounding";
import {
	type Badge,
	type Cell,
	type ClientGroup,
	type Draft,
	type FieldInput,
	isRecord,
	type ModeSpec,
	type SourceRecord,
	type SummaryItem,
	type Tone,
	type UnitLine,
} from "../sheet";
import {
	appendAnswer,
	assembleEquipos,
	type ClientBase,
	confidenceFactors,
	type EquiposKey,
	type ExtractedUnit,
	type Extraction,
	equiposColumns,
	equiposCsv,
	equiposRequest,
	equiposRows,
	fleetSummary,
	installedBase,
	MODALITIES,
	type Modality,
	nextQuestion,
	parseExtraction,
	STATUSES,
	type Status,
	type Unit,
} from "./equipos";

type Visit = SourceRecord<Extraction>;

const DAY_MS = 86_400_000;

const STATUS_TONE: Record<Status, Tone> = {
	Confirmado: "confirmed",
	Reportado: "reported",
	Estimado: "estimated",
	Desconocido: "unknown",
};

const MODALITY_LABEL: Record<Modality, string> = {
	"Resonancia magnética": "Resonancia",
	Tomografía: "Tomografía",
	Ultrasonido: "Ultrasonido",
	"Rayos X": "Rayos X",
	Mamografía: "Mamografía",
	Angiografía: "Angiografía",
	"Medicina nuclear": "Med. nuclear",
	Otro: "Otros",
};

const TEXT: FieldInput = { kind: "text" };
const NUMBER: FieldInput = { kind: "number" };
const READONLY: FieldInput = { kind: "readonly" };

const INPUTS: Record<EquiposKey, FieldInput> = {
	cliente: TEXT,
	ciudad: TEXT,
	pais: TEXT,
	modalidad: { kind: "choice", options: MODALITIES },
	cantidad: NUMBER,
	marca: TEXT,
	modelo: TEXT,
	antiguedad_anios: NUMBER,
	con_antiguedad: READONLY,
	estado: { kind: "choice", options: STATUSES },
	confianza: READONLY,
	confirmaciones: READONLY,
	ultima_visita: READONLY,
	por_renovar: READONLY,
	sin_verificar: READONLY,
	texto_original: READONLY,
};

const PLACE_KEYS: readonly string[] = ["cliente", "ciudad", "pais"];

const count = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;

export const relativeDay = (at: number, now: number) => {
	const days = Math.floor((now - at) / DAY_MS);
	if (days < 1) return "hoy";
	if (days < 2) return "ayer";
	if (days < 30) return `hace ${days} días`;
	if (days < 365) return `hace ${count(Math.floor(days / 30), "mes", "meses")}`;
	return `hace ${count(Math.floor(days / 365), "año", "años")}`;
};

// installedBase skips a visit without a client; naming it keeps its units on the sheet until someone fills the name in.
const named = (records: readonly Visit[]): Visit[] => {
	let unnamed = 0;
	return [...records]
		.sort((a, b) => a.at - b.at)
		.map((record) => {
			if (record.extraction === null || record.extraction.cliente)
				return record;
			unnamed += 1;
			return {
				...record,
				extraction: {
					...record.extraction,
					cliente: `Hospital sin identificar ${unnamed}`,
				},
			};
		});
};

const basesOf = (records: readonly Visit[], now: Date) =>
	installedBase(named(records), now.getTime());

const unitTitle = (unit: Unit) =>
	unit.quantity !== null && unit.quantity > 1
		? `${unit.modality} ×${unit.quantity}`
		: unit.modality;

const partOf = (unit: Unit, machines: number) =>
	unit.quantity !== null && machines < unit.quantity
		? `${machines} de ${unit.quantity}`
		: null;

const unitDetail = (unit: Unit) => {
	const name =
		unit.brand === null
			? ["Marca sin confirmar", unit.model].filter(Boolean).join(" · ")
			: [unit.brand, unit.model].filter(Boolean).join(" ");
	if (unit.age === null) return name;
	const years =
		unit.age.years < 1
			? "menos de 1 año"
			: count(Math.round(unit.age.years), "año", "años");
	const part = partOf(unit, unit.age.count);
	return `${name} · ${part === null ? years : `${part} con ${years}`}`;
};

const renewalTag = (unit: Unit): Badge[] => {
	if (unit.renewals === 0) return [];
	const part = partOf(unit, unit.renewals);
	return [
		{
			label: part === null ? "Renovar" : `Renovar ${part}`,
			tone: "renewal",
		},
	];
};

// A unit key is "client/visit/index" of the visit that first reported it; edits and deletes go to that visit.
const originOf = (unit: Unit) => {
	const [recordId = "", index = "-1"] = unit.key.split("/").slice(-2);
	return { recordId, index: Number(index) };
};

const flaggedKeys = (record: Visit | undefined, index: number) =>
	(record?.unverified ?? []).flatMap((path) => {
		if (PLACE_KEYS.includes(path)) return [path];
		const match = path.match(/^equipos\.(\d+)\.(.+)$/);
		return match && Number(match[1]) === index ? [match[2]] : [];
	});

const unitLine = (
	base: ClientBase,
	unit: Unit,
	records: ReadonlyMap<string, Visit>,
): UnitLine => {
	const { recordId, index } = originOf(unit);
	const unverified = flaggedKeys(records.get(recordId), index);
	const located = base.city !== null || base.country !== null;
	const tags: Badge[] = [
		...renewalTag(unit),
		...(unit.stale
			? [{ label: "Sin verificar", tone: "unknown" as const }]
			: []),
		...(unverified.length > 0
			? [{ label: "Revisar", tone: "estimated" as const }]
			: []),
	];
	return {
		row: {
			key: unit.key,
			recordId,
			index,
			cells: equiposRows([{ ...base, units: [unit] }])[0],
			unverified,
			factors: confidenceFactors({ ...unit, located })
				.map(
					(factor) =>
						`${factor.label} ${factor.points > 0 ? "+" : ""}${factor.points}`,
				)
				.join(" · "),
		},
		title: unitTitle(unit),
		detail: unitDetail(unit),
		status: { label: unit.status, tone: STATUS_TONE[unit.status] },
		tags,
	};
};

const textValue = (value: Cell) =>
	typeof value === "number"
		? String(value)
		: typeof value === "string"
			? value.trim() || null
			: null;

// undefined marks a value that can't be stored, so the edit is ignored.
const numberValue = (value: Cell, min: number): number | null | undefined => {
	if (value === null || (typeof value === "string" && value.trim() === ""))
		return null;
	const parsed =
		typeof value === "number" ? value : Number(value.replace(",", "."));
	return Number.isFinite(parsed) && parsed >= min ? parsed : undefined;
};

const patchUnit = (
	unit: ExtractedUnit,
	key: string,
	value: Cell,
): ExtractedUnit | null => {
	switch (key) {
		case "modalidad": {
			const modalidad = MODALITIES.find((option) => option === value);
			return modalidad ? { ...unit, modalidad } : null;
		}
		case "estado": {
			const estado = STATUSES.find((option) => option === value);
			return estado ? { ...unit, estado } : null;
		}
		case "marca":
			return { ...unit, marca: textValue(value) };
		case "modelo":
			return { ...unit, modelo: textValue(value) };
		case "cantidad": {
			const cantidad = numberValue(value, 1);
			return cantidad === undefined
				? null
				: {
						...unit,
						cantidad: cantidad === null ? null : Math.round(cantidad),
					};
		}
		case "antiguedad_anios": {
			const antiguedad = numberValue(value, 0);
			return antiguedad === undefined
				? null
				: { ...unit, antiguedad_anios: antiguedad };
		}
		default:
			return null;
	}
};

const edit = (
	draft: Draft<Extraction>,
	index: number,
	key: string,
	value: Cell,
): Draft<Extraction> => {
	const { extraction } = draft;
	const cleared = (path: string) =>
		draft.unverified.filter((flag) => flag !== path);
	if (key === "cliente" || key === "ciudad" || key === "pais")
		return {
			extraction: { ...extraction, [key]: textValue(value) },
			unverified: cleared(key),
		};
	const unit = extraction.equipos[index];
	const patched = unit === undefined ? null : patchUnit(unit, key, value);
	if (patched === null) return draft;
	return {
		extraction: {
			...extraction,
			equipos: extraction.equipos.map((found, at) =>
				at === index ? patched : found,
			),
		},
		unverified: cleared(`equipos.${index}.${key}`),
	};
};

const remove = (
	draft: Draft<Extraction>,
	index: number,
): Draft<Extraction> | null => {
	const equipos = draft.extraction.equipos.filter((_, at) => at !== index);
	if (equipos.length === 0) return null;
	return {
		extraction: { ...draft.extraction, equipos },
		unverified: draft.unverified.flatMap((path) => {
			const match = path.match(/^equipos\.(\d+)\.(.+)$/);
			if (!match) return [path];
			const at = Number(match[1]);
			if (at === index) return [];
			return [at > index ? `equipos.${at - 1}.${match[2]}` : path];
		}),
	};
};

const assemble = (
	text: string,
	modelText: string,
	now: Date,
): Draft<Extraction> | null => {
	const grounded = assembleEquipos(normalizeNumbers(text), modelText, now);
	return grounded.extraction === null
		? null
		: { extraction: grounded.extraction, unverified: grounded.unverified };
};

const summary = (records: readonly Visit[], now: Date): SummaryItem[] => {
	const fleet = fleetSummary(basesOf(records, now));
	return [
		{ label: "Clientes", value: String(fleet.clients), tone: "neutral" },
		{ label: "Equipos", value: String(fleet.units), tone: "neutral" },
		...fleet.byModality.slice(0, 3).map(
			(entry): SummaryItem => ({
				label: MODALITY_LABEL[entry.modality],
				value: String(entry.units),
				tone: "neutral",
			}),
		),
		{ label: "Por renovar", value: String(fleet.renewals), tone: "renewal" },
	];
};

const DEMO_EXAMPLE =
	"Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores Philips y un tomógrafo. Uno de los resonadores parece de unos ocho años.";

const unitOf = (
	unit: Partial<ExtractedUnit> & Pick<ExtractedUnit, "modalidad">,
): ExtractedUnit => ({
	cantidad: 1,
	marca: null,
	modelo: null,
	antiguedad_anios: null,
	estado: "Confirmado",
	...unit,
});

const DEMO_MODEL_TEXT = JSON.stringify({
	cliente: "Hospital DemoCare Pacific",
	ciudad: null,
	pais: "Panamá",
	equipos: [
		unitOf({
			modalidad: "Resonancia magnética",
			marca: "Philips",
			modelo: "Ingenia",
			antiguedad_anios: 8,
			estado: "Estimado",
		}),
		unitOf({ modalidad: "Resonancia magnética", marca: "Philips" }),
		unitOf({ modalidad: "Tomografía" }),
	],
});

const DEMO_VISITS: ReadonlyArray<{
	daysAgo: number;
	text: string;
	extraction: (year: number) => Extraction;
}> = [
	{
		daysAgo: 214,
		text: "Estoy en la Clínica San Rafael, en Medellín, Colombia. Vi un tomógrafo Siemens Somatom de 2016 y dos ecógrafos GE Logiq.",
		extraction: (year) => ({
			cliente: "Clínica San Rafael",
			ciudad: "Medellín",
			pais: "Colombia",
			equipos: [
				unitOf({
					modalidad: "Tomografía",
					marca: "Siemens",
					modelo: "Somatom",
					antiguedad_anios: year - 2016,
				}),
				unitOf({
					modalidad: "Ultrasonido",
					cantidad: 2,
					marca: "GE",
					modelo: "Logiq",
				}),
			],
		}),
	},
	{
		daysAgo: 12,
		text: "Hospital DemoCare Pacific, en Panamá. Vi dos resonadores Philips Ingenia y un angiógrafo Philips Azurion. Me dijeron que el tomógrafo Canon tiene 11 años.",
		extraction: () => ({
			cliente: "Hospital DemoCare Pacific",
			ciudad: null,
			pais: "Panamá",
			equipos: [
				unitOf({
					modalidad: "Resonancia magnética",
					cantidad: 2,
					marca: "Philips",
					modelo: "Ingenia",
				}),
				unitOf({
					modalidad: "Angiografía",
					marca: "Philips",
					modelo: "Azurion",
				}),
				unitOf({
					modalidad: "Tomografía",
					cantidad: null,
					marca: "Canon",
					antiguedad_anios: 11,
					estado: "Reportado",
				}),
			],
		}),
	},
	{
		daysAgo: 3,
		text: "Centro Médico Paitilla, ciudad de Panamá. Tienen tres mamógrafos, creo que Hologic, y un resonador Siemens de unos seis años.",
		extraction: () => ({
			cliente: "Centro Médico Paitilla",
			ciudad: "Panamá",
			pais: "Panamá",
			equipos: [
				unitOf({
					modalidad: "Mamografía",
					cantidad: 3,
					marca: "Hologic",
					estado: "Estimado",
				}),
				unitOf({
					modalidad: "Resonancia magnética",
					marca: "Siemens",
					antiguedad_anios: 6,
					estado: "Estimado",
				}),
			],
		}),
	},
];

const seed = (now: Date): Visit[] =>
	DEMO_VISITS.flatMap(({ daysAgo, text, extraction }, index) => {
		const at = now.getTime() - daysAgo * DAY_MS;
		const draft = assemble(
			text,
			JSON.stringify(extraction(new Date(at).getFullYear())),
			new Date(at),
		);
		return draft === null
			? []
			: [{ id: `demo-salud-${index + 1}`, at, source: text, ...draft }];
	});

export const salud: ModeSpec<Extraction> = {
	label: "Salud",
	subtitle: "Equipos médicos por cliente",
	sheetTitle: "Equipos por cliente",
	placeholder: "Escribe o dicta lo que viste",
	csvName: "equipos.csv",
	fields: equiposColumns.map((column) => ({
		key: column.key,
		label: column.label,
		input: INPUTS[column.key],
	})),
	request: (text, now) => equiposRequest(normalizeNumbers(text), now),
	assemble,
	parse: (value) =>
		isRecord(value) ? parseExtraction(JSON.stringify(value)) : null,
	view: (records, now) => {
		const byId = new Map(records.map((record) => [record.id, record]));
		const clients: ClientGroup[] = basesOf(records, now).map((base) => ({
			key: base.key,
			name: base.name,
			meta: [
				[base.city, base.country].filter(Boolean).join(", "),
				`Última visita ${relativeDay(base.lastVisitAt, now.getTime())}`,
			]
				.filter(Boolean)
				.join(" · "),
			units: base.units.map((unit) => unitLine(base, unit, byId)),
		}));
		return { kind: "cards", clients };
	},
	summary,
	csv: (records, now) => equiposCsv(basesOf(records, now)),
	edit,
	remove,
	followUp: {
		ask: (record, records, now) => nextQuestion(record, basesOf(records, now)),
		answer: appendAnswer,
	},
	demo: { seed, example: DEMO_EXAMPLE, modelText: DEMO_MODEL_TEXT },
};
