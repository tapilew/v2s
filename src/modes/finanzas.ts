import { foldText, numbersIn, tokensOf } from "../grounding";
import {
	type Cell,
	type Draft,
	type ExtractionRequest,
	type Field,
	isoDate,
	isRecord,
	type ModeSpec,
	parseJsonObject,
	type SourceRecord,
	type SummaryItem,
	shortDate,
	type TableLine,
	type Tone,
	toCsv,
} from "../sheet";

export const TIPOS = ["Ingreso", "Gasto", "Ahorro"] as const;
export type Tipo = (typeof TIPOS)[number];

export const CATEGORIAS = [
	"Alimentación",
	"Transporte",
	"Vivienda",
	"Servicios",
	"Salud",
	"Educación",
	"Entretenimiento",
	"Compras",
	"Ingreso",
	"Ahorro",
	"Otro",
] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export const METODOS = [
	"Efectivo",
	"Tarjeta",
	"Transferencia",
	"Yappy",
] as const;
export type Metodo = (typeof METODOS)[number];

export type Movimiento = {
	fecha: string;
	concepto: string;
	tipo: Tipo;
	categoria: Categoria;
	monto: number;
	metodo: Metodo | null;
};

type Said = Omit<Movimiento, "fecha"> & { fecha: string | null };

const SCHEMA = {
	type: "object",
	properties: {
		movimientos: {
			type: "array",
			maxItems: 6,
			items: {
				type: "object",
				properties: {
					concepto: { type: "string", maxLength: 60 },
					tipo: { type: "string", enum: TIPOS },
					categoria: { type: "string", enum: CATEGORIAS },
					monto: { type: "number" },
					metodo: { type: ["string", "null"], enum: [...METODOS, null] },
					fecha: { type: ["string", "null"], maxLength: 20 },
				},
				required: ["concepto", "tipo", "categoria", "monto", "metodo", "fecha"],
			},
		},
	},
	required: ["movimientos"],
};

const EXAMPLE_TEXT =
	"Compré el súper por 80 dólares con tarjeta y le pasé 20 a mi cuenta de ahorros.";

const EXAMPLE = {
	movimientos: [
		{
			concepto: "Supermercado",
			tipo: "Gasto",
			categoria: "Alimentación",
			monto: 80,
			metodo: "Tarjeta",
			fecha: null,
		},
		{
			concepto: "Depósito a cuenta de ahorros",
			tipo: "Ahorro",
			categoria: "Ahorro",
			monto: 20,
			metodo: "Transferencia",
			fecha: null,
		},
	],
};

const SYSTEM_PROMPT =
	"Conviertes lo que alguien dice sobre su dinero en filas de una hoja de cálculo. Cada movimiento es una fila. " +
	"Usa solo los montos que se dijeron; nunca inventes montos. fecha solo si se dijo (hoy, ayer, una fecha), si no null. metodo null si no se dijo. " +
	"Sacar efectivo del cajero o mover dinero entre tus propias cuentas no es un gasto y no crea ninguna fila, salvo un depósito a la cuenta de ahorros, que es Ahorro. " +
	`Ejemplo.\nTexto: ${EXAMPLE_TEXT}\nFilas: ${JSON.stringify(EXAMPLE)}`;

const request = (text: string): ExtractionRequest => ({
	history: [
		{ role: "system", content: SYSTEM_PROMPT },
		{ role: "user", content: `Texto: ${text}` },
	],
	responseFormat: {
		type: "json_schema",
		json_schema: { name: "filas", schema: SCHEMA },
	},
	generationParams: { temp: 0, predict: 300 },
});

const isOption = <T extends string>(
	options: readonly T[],
	value: unknown,
): value is T => options.some((option) => option === value);

const choiceOf = <T extends string>(
	options: readonly T[],
	value: unknown,
): T | null =>
	typeof value === "string"
		? (options.find((option) => foldText(option) === foldText(value.trim())) ??
			null)
		: null;

const isMonto = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value) && value > 0;

const amountOf = (value: unknown): number | null => {
	const found =
		typeof value === "number"
			? [value]
			: typeof value === "string"
				? numbersIn(value)
				: [];
	return found.length === 1 && Number.isFinite(found[0]) && found[0] !== 0
		? Math.abs(found[0])
		: null;
};

const saidFrom = (modelText: string): Said[] => {
	const parsed = parseJsonObject(modelText);
	const items =
		isRecord(parsed) && Array.isArray(parsed.movimientos)
			? parsed.movimientos
			: [];
	return items.flatMap((item): Said[] => {
		if (!isRecord(item)) return [];
		const monto = amountOf(item.monto);
		const concepto =
			typeof item.concepto === "string" ? item.concepto.trim() : "";
		if (monto === null || concepto === "") return [];
		return [
			{
				concepto,
				monto,
				tipo: choiceOf(TIPOS, item.tipo) ?? "Gasto",
				categoria: choiceOf(CATEGORIAS, item.categoria) ?? "Otro",
				metodo: choiceOf(METODOS, item.metodo),
				fecha: typeof item.fecha === "string" ? item.fecha : null,
			},
		];
	});
};

const isNumberToken = (token: string) => /^\d/.test(token);

// Sentences split before tokenizing so "38.50" survives; " y " splits after, so "treinta y ocho" is already one number.
const clausesOf = (text: string): string[][] =>
	text.split(/;|[.!?](?=\s|$)/).flatMap((sentence) => {
		const clauses: string[][] = [[]];
		for (const token of tokensOf(sentence)) {
			if (token === "y") clauses.push([]);
			else clauses[clauses.length - 1].push(token);
		}
		return clauses.filter((clause) => clause.length > 0);
	});

const hasPhrase = (tokens: readonly string[], phrase: string) => {
	const words = phrase.split(" ");
	return tokens.some((_, at) =>
		words.every((word, offset) => tokens[at + offset] === word),
	);
};

// Ahorro is checked first: "ahorré de la quincena" is a saving, not income.
const TIPO_PHRASES: ReadonlyArray<readonly [Tipo, readonly string[]]> = [
	["Ahorro", ["ahorre", "ahorro", "cuenta de ahorros"]],
	[
		"Ingreso",
		[
			"quincena",
			"sueldo",
			"salario",
			"me pagaron",
			"recibi",
			"me dieron",
			"vendi",
			"cobre",
		],
	],
];

const tipoSaid = (clause: readonly string[]) =>
	TIPO_PHRASES.find(([, phrases]) =>
		phrases.some((phrase) => hasPhrase(clause, phrase)),
	)?.[0] ?? null;

// Only an expense keeps this category: categoriaFor files an Ingreso or Ahorro row under its tipo.
const CATEGORIA_PHRASES: ReadonlyArray<
	readonly [Categoria, readonly string[]]
> = [
	[
		"Alimentación",
		[
			"almuerzo",
			"desayuno",
			"cena",
			"comida",
			"super",
			"supermercado",
			"restaurante",
			"cafe",
			"pizza",
		],
	],
	[
		"Servicios",
		["luz", "agua", "internet", "telefono", "celular", "cable", "gas"],
	],
	[
		"Transporte",
		["taxi", "uber", "gasolina", "bus", "metro", "pasaje", "peaje"],
	],
	["Vivienda", ["alquiler", "renta", "hipoteca"]],
	["Salud", ["farmacia", "medicina", "medicinas", "consulta medica", "medico"]],
	["Educación", ["utiles", "colegio", "matricula", "universidad", "curso"]],
	["Entretenimiento", ["netflix", "spotify", "cine", "concierto"]],
];

const categoriaSaid = (tokens: readonly string[]) =>
	CATEGORIA_PHRASES.find(([, phrases]) =>
		phrases.some((phrase) => hasPhrase(tokens, phrase)),
	)?.[0] ?? null;

const METODO_WORDS = new Map<string, Metodo>([
	["yappy", "Yappy"],
	["efectivo", "Efectivo"],
	["cash", "Efectivo"],
	["tarjeta", "Tarjeta"],
	["credito", "Tarjeta"],
	["debito", "Tarjeta"],
	["transferencia", "Transferencia"],
	["ach", "Transferencia"],
]);

const metodosIn = (tokens: readonly string[]) =>
	tokens.flatMap((token) => METODO_WORDS.get(token) ?? []);

const metodoFor = (
	claimed: Metodo | null,
	clause: readonly string[] | null,
	said: readonly Metodo[],
) => {
	if (claimed === null) return null;
	const near = clause === null ? [] : metodosIn(clause);
	if (near.length > 0) return near.includes(claimed) ? claimed : near[0];
	return said.includes(claimed) ? claimed : null;
};

const categoriaFor = (tipo: Tipo, categoria: Categoria): Categoria =>
	tipo !== "Gasto"
		? tipo
		: categoria === "Ingreso" || categoria === "Ahorro"
			? "Otro"
			: categoria;

const MONTHS = new Map([
	["enero", 1],
	["febrero", 2],
	["marzo", 3],
	["abril", 4],
	["mayo", 5],
	["junio", 6],
	["julio", 7],
	["agosto", 8],
	["septiembre", 9],
	["setiembre", 9],
	["octubre", 10],
	["noviembre", 11],
	["diciembre", 12],
]);

const DAYS_BACK = new Map([
	["hoy", 0],
	["ayer", 1],
	["anteayer", 2],
	["antier", 2],
]);

const calendarDay = (year: number, month: number, day: number) => {
	const date = new Date(year, month - 1, day);
	return date.getMonth() === month - 1 && date.getDate() === day
		? isoDate(date)
		: null;
};

const isIsoDate = (value: unknown): value is string => {
	const match =
		typeof value === "string" ? value.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
	return (
		match !== null &&
		calendarDay(Number(match[1]), Number(match[2]), Number(match[3])) === value
	);
};

const datesIn = (text: string, now: Date): string[] => {
	const year = now.getFullYear();
	const tokens = tokensOf(text);
	const folded = foldText(text);
	return [
		...tokens.map((token) => {
			const back = DAYS_BACK.get(token);
			return back === undefined
				? null
				: isoDate(new Date(year, now.getMonth(), now.getDate() - back));
		}),
		...tokens.map((token, at) => {
			const month = MONTHS.get(tokens[at + 2]);
			return tokens[at + 1] === "de" && month !== undefined
				? calendarDay(year, month, Number(token))
				: null;
		}),
		...[...folded.matchAll(/(?<!\d)(\d{1,2})\/(\d{1,2})(?!\d)/g)].map(
			([, day, month]) => calendarDay(year, Number(month), Number(day)),
		),
		...[...folded.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)].map(
			([, y, month, day]) => calendarDay(Number(y), Number(month), Number(day)),
		),
	].filter((date): date is string => date !== null);
};

const pathOf = (index: number, key: string) => `${index}.${key}`;

const splitPath = (path: string) => {
	const dot = path.indexOf(".");
	return { index: Number(path.slice(0, dot)), key: path.slice(dot + 1) };
};

const assemble = (
	text: string,
	modelText: string,
	now: Date,
): Draft<Movimiento[]> | null => {
	const clauses = clausesOf(text);
	const amounts = clauses.flatMap((tokens, clause) =>
		tokens
			.filter(isNumberToken)
			.map((token) => ({ value: Number(token), clause, claimed: false })),
	);
	const saidMetodos = clauses.flatMap(metodosIn);
	const saidDates = datesIn(text, now);
	const built = saidFrom(modelText).map((said) => {
		const amount = amounts.find(
			(candidate) =>
				!candidate.claimed && Math.abs(candidate.value - said.monto) < 0.005,
		);
		if (amount) amount.claimed = true;
		const words = tokensOf(said.concepto).filter(
			(word) => !isNumberToken(word) && word.length > 2,
		);
		const index =
			amount?.clause ??
			clauses.findIndex((clause) =>
				words.some((word) => clause.includes(word)),
			);
		const clause = index === -1 ? null : clauses[index];
		const tipo = (clause && tipoSaid(clause)) ?? said.tipo;
		const fecha = said.fecha === null ? undefined : datesIn(said.fecha, now)[0];
		const movimiento: Movimiento = {
			fecha:
				fecha !== undefined && saidDates.includes(fecha) ? fecha : isoDate(now),
			concepto: said.concepto,
			tipo,
			categoria: categoriaFor(
				tipo,
				categoriaSaid(tokensOf(said.concepto)) ??
					(clause && categoriaSaid(clause)) ??
					said.categoria,
			),
			monto: said.monto,
			metodo: metodoFor(said.metodo, clause, saidMetodos),
		};
		return { movimiento, backed: amount !== undefined };
	});
	if (built.length === 0) return null;
	return {
		extraction: built.map(({ movimiento }) => movimiento),
		unverified: built.flatMap(({ backed }, at) =>
			backed ? [] : [pathOf(at, "monto")],
		),
	};
};

const parseMovimiento = (value: unknown): Movimiento | null => {
	if (!isRecord(value)) return null;
	const { fecha, concepto, tipo, categoria, monto, metodo } = value;
	return isIsoDate(fecha) &&
		typeof concepto === "string" &&
		concepto.trim() !== "" &&
		isOption(TIPOS, tipo) &&
		isOption(CATEGORIAS, categoria) &&
		isMonto(monto) &&
		(metodo === null || isOption(METODOS, metodo))
		? { fecha, concepto, tipo, categoria, monto, metodo }
		: null;
};

// An empty list is refused like a broken one: a record with no movements has nothing to show or retry from.
const parse = (value: unknown): Movimiento[] | null => {
	if (!Array.isArray(value) || value.length === 0) return null;
	const movimientos = value.map(parseMovimiento);
	return movimientos.every((movimiento) => movimiento !== null)
		? movimientos
		: null;
};

const money = (amount: number) => {
	const [whole, cents] = amount.toFixed(2).split(".");
	return `$${whole.replace(/\B(?=(\d{3})+$)/g, ",")}.${cents}`;
};

const FIGURES: Record<Tipo, { sign: string; tone: Tone }> = {
	Ingreso: { sign: "+", tone: "income" },
	Gasto: { sign: "−", tone: "expense" },
	Ahorro: { sign: "", tone: "saving" },
};

type Entry = {
	record: SourceRecord<Movimiento[]>;
	index: number;
	movimiento: Movimiento;
};

const entriesOf = (records: readonly SourceRecord<Movimiento[]>[]): Entry[] =>
	records.flatMap((record) =>
		(record.extraction ?? []).map((movimiento, index) => ({
			record,
			index,
			movimiento,
		})),
	);

const newestFirst = (a: Entry, b: Entry) =>
	b.movimiento.fecha.localeCompare(a.movimiento.fecha) ||
	b.record.at - a.record.at ||
	a.index - b.index;

const oldestFirst = (a: Entry, b: Entry) =>
	a.movimiento.fecha.localeCompare(b.movimiento.fecha) ||
	a.record.at - b.record.at ||
	a.index - b.index;

const cellsOf = ({ record, movimiento }: Entry) => ({
	...movimiento,
	texto_original: record.source,
});

const lineOf = (entry: Entry): TableLine => {
	const { record, index, movimiento } = entry;
	const { sign, tone } = FIGURES[movimiento.tipo];
	return {
		date: shortDate(movimiento.fecha),
		title: movimiento.concepto,
		subtitle: movimiento.categoria,
		amount: { label: `${sign}${money(movimiento.monto)}`, tone },
		row: {
			key: `${record.id}/${index}`,
			recordId: record.id,
			index,
			cells: cellsOf(entry),
			unverified: record.unverified
				.map(splitPath)
				.filter((path) => path.index === index)
				.map((path) => path.key),
			factors: null,
		},
	};
};

const summary = (
	records: readonly SourceRecord<Movimiento[]>[],
	now: Date,
): SummaryItem[] => {
	const month = isoDate(now).slice(0, 7);
	const totals: Record<Tipo, number> = { Ingreso: 0, Gasto: 0, Ahorro: 0 };
	for (const { movimiento } of entriesOf(records)) {
		if (movimiento.fecha.startsWith(month))
			totals[movimiento.tipo] += movimiento.monto;
	}
	return [
		{ label: "Ingresos", value: money(totals.Ingreso), tone: "income" },
		{ label: "Gastos", value: money(totals.Gasto), tone: "expense" },
		{ label: "Ahorro", value: money(totals.Ahorro), tone: "saving" },
		{
			label: "Tasa de ahorro",
			value:
				totals.Ingreso > 0
					? `${Math.round((totals.Ahorro / totals.Ingreso) * 100)} %`
					: "Sin ingresos",
			tone: "neutral",
		},
	];
};

const FIELDS: readonly Field[] = [
	{ key: "fecha", label: "Fecha", input: { kind: "date" } },
	{ key: "concepto", label: "Concepto", input: { kind: "text" } },
	{ key: "tipo", label: "Tipo", input: { kind: "choice", options: TIPOS } },
	{
		key: "categoria",
		label: "Categoría",
		input: { kind: "choice", options: CATEGORIAS },
	},
	{ key: "monto", label: "Monto", input: { kind: "number" } },
	{
		key: "metodo",
		label: "Método",
		input: { kind: "choice", options: METODOS },
	},
	{
		key: "texto_original",
		label: "Texto original",
		input: { kind: "readonly" },
	},
];

const montoOf = (value: Cell): number | null => {
	const found =
		typeof value === "number"
			? [value]
			: typeof value === "string" && /^\d[\d.,]*$/.test(value.trim())
				? numbersIn(value)
				: [];
	return found.length === 1 && isMonto(found[0]) ? found[0] : null;
};

const EDITS = new Map<
	string,
	(movimiento: Movimiento, value: Cell) => Movimiento | null
>([
	[
		"fecha",
		(movimiento, value) =>
			isIsoDate(value) ? { ...movimiento, fecha: value } : null,
	],
	[
		"concepto",
		(movimiento, value) => {
			const concepto = typeof value === "string" ? value.trim() : "";
			return concepto === "" ? null : { ...movimiento, concepto };
		},
	],
	[
		"tipo",
		(movimiento, value) =>
			isOption(TIPOS, value)
				? {
						...movimiento,
						tipo: value,
						categoria: categoriaFor(value, movimiento.categoria),
					}
				: null,
	],
	[
		"categoria",
		(movimiento, value) =>
			isOption(CATEGORIAS, value) ? { ...movimiento, categoria: value } : null,
	],
	[
		"monto",
		(movimiento, value) => {
			const monto = montoOf(value);
			return monto === null ? null : { ...movimiento, monto };
		},
	],
	[
		"metodo",
		(movimiento, value) =>
			value === null || value === ""
				? { ...movimiento, metodo: null }
				: isOption(METODOS, value)
					? { ...movimiento, metodo: value }
					: null,
	],
]);

const edit = (
	draft: Draft<Movimiento[]>,
	index: number,
	key: string,
	value: Cell,
): Draft<Movimiento[]> => {
	const current = draft.extraction[index];
	const edited = current && EDITS.get(key)?.(current, value);
	if (!edited) return draft;
	const path = pathOf(index, key);
	return {
		extraction: draft.extraction.map((movimiento, at) =>
			at === index ? edited : movimiento,
		),
		unverified: draft.unverified.filter((flagged) => flagged !== path),
	};
};

const remove = (
	draft: Draft<Movimiento[]>,
	index: number,
): Draft<Movimiento[]> | null => {
	if (draft.extraction[index] === undefined) return draft;
	const extraction = draft.extraction.filter((_, at) => at !== index);
	if (extraction.length === 0) return null;
	return {
		extraction,
		unverified: draft.unverified.flatMap((flagged) => {
			const path = splitPath(flagged);
			if (path.index === index) return [];
			return path.index > index
				? [pathOf(path.index - 1, path.key)]
				: [flagged];
		}),
	};
};

const DEMO_EXAMPLE =
	"Hoy pagué 45 dólares de luz con Yappy y 12 de almuerzo en efectivo.";

const DEMO_MODEL_TEXT =
	'{"movimientos":[{"concepto":"Luz","tipo":"Gasto","categoria":"Servicios","monto":45,"metodo":"Yappy","fecha":"hoy"},{"concepto":"Almuerzo","tipo":"Gasto","categoria":"Compras","monto":12,"metodo":"Efectivo","fecha":"hoy"}]}';

const DEMO_MOVEMENTS: ReadonlyArray<{
	daysAgo: number;
	text: string;
	said: Omit<Said, "fecha">;
}> = [
	{
		daysAgo: 9,
		text: "Me cayó la quincena, 850 dólares, por ACH.",
		said: {
			concepto: "Quincena",
			tipo: "Ingreso",
			categoria: "Ingreso",
			monto: 850,
			metodo: "Transferencia",
		},
	},
	{
		daysAgo: 9,
		text: "Pagué el alquiler, 550, por transferencia.",
		said: {
			concepto: "Alquiler",
			tipo: "Gasto",
			categoria: "Vivienda",
			monto: 550,
			metodo: "Transferencia",
		},
	},
	{
		daysAgo: 8,
		text: "Pagué 45 dólares de luz con Yappy.",
		said: {
			concepto: "Luz",
			tipo: "Gasto",
			categoria: "Servicios",
			monto: 45,
			metodo: "Yappy",
		},
	},
	{
		daysAgo: 6,
		text: "Compré el súper por 86,40 con tarjeta.",
		said: {
			concepto: "Supermercado",
			tipo: "Gasto",
			categoria: "Alimentación",
			monto: 86.4,
			metodo: "Tarjeta",
		},
	},
	{
		daysAgo: 5,
		text: "Le mandé 15 por Yappy a Carlos por la pizza.",
		said: {
			concepto: "Pizza con Carlos",
			tipo: "Gasto",
			categoria: "Alimentación",
			monto: 15,
			metodo: "Yappy",
		},
	},
	{
		daysAgo: 4,
		text: "Pasé 100 a la cuenta de ahorros.",
		said: {
			concepto: "Depósito a cuenta de ahorros",
			tipo: "Ahorro",
			categoria: "Ahorro",
			monto: 100,
			metodo: null,
		},
	},
	{
		daysAgo: 2,
		text: "Pagué el internet, 35 dólares, con tarjeta.",
		said: {
			concepto: "Internet",
			tipo: "Gasto",
			categoria: "Servicios",
			monto: 35,
			metodo: "Tarjeta",
		},
	},
	{
		daysAgo: 0,
		text: "Almuerzo de 8.50 en efectivo.",
		said: {
			concepto: "Almuerzo",
			tipo: "Gasto",
			categoria: "Alimentación",
			monto: 8.5,
			metodo: "Efectivo",
		},
	},
];

const seed = (now: Date): SourceRecord<Movimiento[]>[] =>
	DEMO_MOVEMENTS.flatMap(({ daysAgo, text, said }, index) => {
		const at = Math.min(
			now.getTime(),
			new Date(
				now.getFullYear(),
				now.getMonth(),
				Math.max(1, now.getDate() - daysAgo),
				8 + index,
			).getTime(),
		);
		const draft = assemble(
			text,
			JSON.stringify({ movimientos: [{ ...said, fecha: null }] }),
			new Date(at),
		);
		return draft === null
			? []
			: [{ id: `demo-finanzas-${index + 1}`, at, source: text, ...draft }];
	});

export const finanzas: ModeSpec<Movimiento[]> = {
	label: "Finanzas",
	subtitle: "Tus movimientos y tu ahorro",
	sheetTitle: "Movimientos",
	placeholder: "Escribe o dicta un movimiento",
	csvName: "finanzas.csv",
	fields: FIELDS,
	request,
	assemble,
	parse,
	view: (records) => ({
		kind: "table",
		headers: {
			date: "Fecha",
			title: "Concepto",
			subtitle: "Categoría",
			amount: "Monto",
		},
		lines: entriesOf(records).sort(newestFirst).map(lineOf),
	}),
	summary,
	csv: (records) =>
		toCsv(FIELDS, entriesOf(records).sort(oldestFirst).map(cellsOf)),
	edit,
	remove,
	followUp: null,
	demo: { seed, example: DEMO_EXAMPLE, modelText: DEMO_MODEL_TEXT },
};
