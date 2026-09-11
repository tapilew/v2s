/// <reference types="bun-types" />

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import type { ModelProgressUpdate } from "@qvac/sdk";
import * as sdk from "@qvac/sdk";
import { foldText, numbersIn } from "../src/grounding";
import {
	assemble,
	type CompletionRequest,
	type Generated,
	HARNESS,
	newSheetJob,
	parseJsonObject,
	parseList,
} from "../src/harness";
import {
	type Cell,
	isRecord,
	type ModeId,
	parseCell,
} from "../src/spreadsheet";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

type SetId = "finanzas" | "equipos" | "consultations";

const SET_MODE: Record<SetId, ModeId> = {
	finanzas: "finanzas",
	equipos: "salud",
	consultations: "salud",
};

const isMode = (value: string): value is ModeId =>
	value === "finanzas" || value === "salud";

const isSet = (value: string): value is SetId =>
	value === "finanzas" || value === "equipos" || value === "consultations";

type CliArgs = {
	mode: ModeId;
	set: SetId;
	limit: number | null;
	model: string | null;
};

const parseArgs = (argv: readonly string[]): CliArgs => {
	let mode: ModeId | null = null;
	let set: SetId | null = null;
	let limit: number | null = null;
	let model: string | null = null;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--mode") {
			const raw = argv[index + 1];
			if (raw === undefined || !isMode(raw))
				throw new Error(
					`--mode must be "finanzas" or "salud", got "${raw ?? ""}"`,
				);
			mode = raw;
			index += 1;
		} else if (arg === "--set") {
			const raw = argv[index + 1];
			if (raw === undefined || !isSet(raw))
				throw new Error(
					`--set must be "finanzas", "equipos" or "consultations", got "${raw ?? ""}"`,
				);
			set = raw;
			index += 1;
		} else if (arg === "--limit") {
			const raw = argv[index + 1];
			const parsed = raw === undefined ? Number.NaN : Number(raw);
			if (!Number.isInteger(parsed) || parsed <= 0)
				throw new Error(
					`--limit must be a positive integer, got "${raw ?? ""}"`,
				);
			limit = parsed;
			index += 1;
		} else if (arg === "--model") {
			model = argv[index + 1] ?? null;
			index += 1;
		}
	}
	if (mode === null) throw new Error("--mode <finanzas|salud> is required");
	if (set === null)
		throw new Error("--set <finanzas|equipos|consultations> is required");
	if (SET_MODE[set] !== mode)
		throw new Error(
			`--set ${set} runs under mode ${SET_MODE[set]}, not ${mode}`,
		);
	return { mode, set, limit, model };
};

// ---------------------------------------------------------------------------
// Model resolution, load timing, bare-runtime contention guard
// ---------------------------------------------------------------------------

const levenshtein = (a: string, b: string): number => {
	const table: number[][] = [];
	for (let row = 0; row <= a.length; row += 1) table.push([row]);
	for (let col = 1; col <= b.length; col += 1) table[0].push(col);
	for (let row = 1; row <= a.length; row += 1) {
		for (let col = 1; col <= b.length; col += 1) {
			const cost = a[row - 1] === b[col - 1] ? 0 : 1;
			table[row].push(
				Math.min(
					table[row - 1][col] + 1,
					table[row][col - 1] + 1,
					table[row - 1][col - 1] + cost,
				),
			);
		}
	}
	return table[a.length][b.length];
};

const isRegistryConstantKey = (key: string): boolean =>
	/^[A-Z0-9_]+$/.test(key);

const resolveModel = (
	sdkModule: Record<string, unknown>,
	name: string,
): unknown => {
	if (name in sdkModule) return sdkModule[name];
	const nearest = Object.keys(sdkModule)
		.filter(isRegistryConstantKey)
		.sort((a, b) => levenshtein(name, a) - levenshtein(name, b))
		.slice(0, 5);
	throw new Error(
		`Unknown model "${name}". Nearest registry constants: ${nearest.join(", ")}`,
	);
};

const BARE_RUNTIME_PGREP_PATTERN = "[b]are-runtime";
const BARE_RUNTIME_POLL_MS = 3000;

// pgrep -f "bare-runtime" run from this script would match this process's own argv,
// since the literal string appears in the command line that invoked it. The bracket
// class breaks that literal substring while still matching a real bare-runtime worker
// by regex.
const otherWorkerRunning = (): boolean =>
	spawnSync("pgrep", ["-f", BARE_RUNTIME_PGREP_PATTERN]).status === 0;

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

const waitForNoOtherWorker = async (): Promise<void> => {
	while (otherWorkerRunning()) {
		console.error(
			"another bare-runtime worker is running, waiting for it to exit",
		);
		await sleep(BARE_RUNTIME_POLL_MS);
	}
};

type LoadModelTimedResult = {
	modelId: string;
	loadMs: number;
	firstDownload: boolean;
};

// The registry descriptor comes from `resolveModel`, which resolves it dynamically from
// a CLI string, so it can't be statically typed against `loadModel`'s overloaded
// descriptor/options union; casting from `unknown` here is narrow and always legal.
type ResolvedModelSrc = { src: string };

const loadModelTimed = async (
	modelSrc: unknown,
	modelConfig: Record<string, unknown>,
): Promise<LoadModelTimedResult> => {
	let firstDownload = false;
	const start = performance.now();
	const modelId = await sdk.loadModel({
		modelSrc: modelSrc as ResolvedModelSrc,
		modelType: "llm",
		modelConfig,
		onProgress: (progress: ModelProgressUpdate) => {
			if (progress.percentage < 100) firstDownload = true;
		},
	});
	const loadMs = performance.now() - start;
	return { modelId, loadMs, firstDownload };
};

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

const percentile = (values: readonly number[], p: number): number | null => {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const rank = (p / 100) * (sorted.length - 1);
	const lower = Math.floor(rank);
	const upper = Math.ceil(rank);
	if (lower === upper) return sorted[lower];
	const weight = rank - lower;
	return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
};

const median = (values: readonly number[]): number | null =>
	percentile(values, 50);

const sum = (values: readonly number[]): number =>
	values.reduce((total, value) => total + value, 0);

const compactNumbers = (values: readonly (number | null)[]): number[] =>
	values.filter((value): value is number => value !== null);

const microAverage = (numerator: number, denominator: number): number | null =>
	denominator === 0 ? null : numerator / denominator;

const formatPercent = (ratio: number | null): string =>
	ratio === null ? "n/a" : `${(ratio * 100).toFixed(1)}%`;

const formatMs = (value: number | null): string =>
	value === null ? "n/a" : `${Math.round(value)} ms`;

const formatRate = (value: number | null): string =>
	value === null ? "n/a" : `${value.toFixed(1)} tok/s`;

const formatNum = (value: number | null, digits = 1): string =>
	value === null ? "n/a" : value.toFixed(digits);

// ---------------------------------------------------------------------------
// Gold sets
// ---------------------------------------------------------------------------

type FinanzasGoldRow = {
	concepto: string;
	tipo: string;
	categoria: string;
	monto: number;
	metodo: string | null;
};

type FinanzasCase = { id: string; text: string; gold: FinanzasGoldRow[] };

type EquiposUnit = {
	modalidad: string;
	cantidad: number | null;
	marca: string | null;
	modelo: string | null;
	antiguedad_anios: number | null;
	estado: string | null;
};

type EquiposGold = {
	cliente: string | null;
	ciudad: string | null;
	pais: string | null;
	equipos: EquiposUnit[];
};

type EquiposCase = { id: string; text: string; gold: EquiposGold };

type Tratamiento = {
	medicamento: string;
	dosis: string | null;
	via: string | null;
	frecuencia: string | null;
	duracion: string | null;
};

type ClinicalNote = {
	paciente: {
		nombre: string | null;
		cedula: string | null;
		edad: string | null;
		sexo: string | null;
	};
	signos_vitales: Record<string, string | number | null>;
	diagnosticos: unknown[];
	tratamiento: Tratamiento[];
};

type ConsultationCase = { id: string; transcript: string; gold: ClinicalNote };

// ---------------------------------------------------------------------------
// Gold value extraction: a flat list of {kind, value} the generated sheet
// must reproduce somewhere. Numbers are matched exactly (after the harness's
// own decimal-comma normalization); text is matched by folded containment.
// ---------------------------------------------------------------------------

type GoldValue =
	| { kind: "number"; value: number }
	| { kind: "text"; value: string };

const wordTokens = (text: string): string[] =>
	foldText(text).match(/\p{L}+/gu) ?? [];

const finanzasGoldValues = (gold: readonly FinanzasGoldRow[]): GoldValue[] => {
	const values: GoldValue[] = [];
	for (const row of gold) {
		values.push({ kind: "number", value: row.monto });
		for (const token of wordTokens(row.concepto)) {
			if (token.length >= 4) values.push({ kind: "text", value: token });
		}
	}
	return values;
};

const equiposGoldValues = (gold: EquiposGold): GoldValue[] => {
	const values: GoldValue[] = [];
	for (const unit of gold.equipos) {
		if (unit.marca !== null) values.push({ kind: "text", value: unit.marca });
		if (unit.modelo !== null) values.push({ kind: "text", value: unit.modelo });
		if (unit.cantidad !== null)
			values.push({ kind: "number", value: unit.cantidad });
		if (unit.antiguedad_anios !== null)
			values.push({ kind: "number", value: unit.antiguedad_anios });
	}
	return values;
};

const consultationGoldValues = (gold: ClinicalNote): GoldValue[] => {
	const values: GoldValue[] = [];
	if (gold.paciente.nombre !== null)
		values.push({ kind: "text", value: gold.paciente.nombre });
	for (const raw of Object.values(gold.signos_vitales)) {
		if (raw === null) continue;
		for (const number of numbersIn(String(raw)))
			values.push({ kind: "number", value: number });
	}
	for (const tx of gold.tratamiento) {
		values.push({ kind: "text", value: tx.medicamento });
		if (tx.dosis !== null)
			for (const number of numbersIn(tx.dosis))
				values.push({ kind: "number", value: number });
	}
	return values;
};

const goldRowCount = {
	finanzas: (gold: readonly FinanzasGoldRow[]) => gold.length,
	equipos: (gold: EquiposGold) => gold.equipos.length,
	consultations: (gold: ClinicalNote) => 1 + gold.tratamiento.length,
} as const;

// ---------------------------------------------------------------------------
// Scoring against a generated sheet
// ---------------------------------------------------------------------------

const cellNumbers = (cell: Cell): number[] => {
	if (typeof cell === "number") return [cell];
	if (typeof cell === "string") return numbersIn(cell);
	return [];
};

type CellPool = { numbers: Set<number>; foldedBlob: string };

const poolOf = (generated: Generated | null): CellPool => {
	const numbers = new Set<number>();
	const parts: string[] = [];
	for (const row of generated?.rows ?? []) {
		for (const cell of row.cells) {
			for (const number of cellNumbers(cell)) numbers.add(number);
			if (typeof cell === "string") parts.push(foldText(cell));
		}
	}
	return { numbers, foldedBlob: parts.join(" ␟ ") };
};

const valueFound = (value: GoldValue, pool: CellPool): boolean =>
	value.kind === "number"
		? pool.numbers.has(value.value)
		: pool.foldedBlob.includes(foldText(value.value));

const NUMBER_CONCEPT =
	/monto|cantidad|dosis|temperatura|antiguedad|precio|total/i;

const columnHasNumberConcept = (columns: readonly string[]): boolean =>
	columns.some((column) => NUMBER_CONCEPT.test(foldText(column)));

type CaseScore = {
	goldRows: number;
	generatedRows: number;
	rowRecall: number | null;
	overGeneration: number;
	goldValues: number;
	valuesFound: number;
	columns: number;
	columnSane: boolean;
};

const scoreCase = (
	goldRows: number,
	goldValues: readonly GoldValue[],
	generated: Generated | null,
): CaseScore => {
	const generatedRows = generated?.rows.length ?? 0;
	const pool = poolOf(generated);
	const foundCount = goldValues.filter((value) =>
		valueFound(value, pool),
	).length;
	const columns = generated?.columns.length ?? 0;
	return {
		goldRows,
		generatedRows,
		rowRecall:
			goldRows === 0 ? null : Math.min(generatedRows, goldRows) / goldRows,
		overGeneration: Math.max(0, generatedRows - goldRows),
		goldValues: goldValues.length,
		valuesFound: foundCount,
		columns,
		columnSane:
			goldValues.length === 0
				? true
				: columnHasNumberConcept(generated?.columns ?? []),
	};
};

// Grounding: share of numeric cells whose integer digits appear in the source text.
// "raw" reads straight off the rows-call JSON before assemble's dedupe/support filter;
// "assembled" reads the unverified flags assemble already computed for numeric cells.
type GroundingCount = { grounded: number; total: number };

const saidNumbers = (source: string): Set<number> => {
	const said = new Set(numbersIn(source).map((n) => Math.trunc(Math.abs(n))));
	if (/\b(un|una)\b/iu.test(foldText(source))) said.add(1);
	return said;
};

// A cell counts as "numeric" the same way assemble's own groundRow decides it: parseCell
// on the raw string must yield a number outright, not "some digits appear in this string".
// That keeps a date like "2026-09-10" (a string, hyphens and all) out of the count at both
// stages, so the raw-vs-assembled comparison isolates what assemble actually fixed.
const rawGrounding = (source: string, rowsRaw: string): GroundingCount => {
	const said = saidNumbers(source);
	let grounded = 0;
	let total = 0;
	const parsed = parseJsonObject(rowsRaw);
	const filas =
		isRecord(parsed) && Array.isArray(parsed.filas) ? parsed.filas : [];
	for (const row of filas) {
		if (!Array.isArray(row)) continue;
		for (const cell of row) {
			const value =
				typeof cell === "number"
					? cell
					: typeof cell === "string"
						? parseCell(cell)
						: null;
			if (typeof value !== "number") continue;
			total += 1;
			if (said.has(Math.trunc(Math.abs(value)))) grounded += 1;
		}
	}
	return { grounded, total };
};

const assembledGrounding = (generated: Generated | null): GroundingCount => {
	let grounded = 0;
	let total = 0;
	for (const row of generated?.rows ?? []) {
		row.cells.forEach((cell, index) => {
			if (typeof cell !== "number") return;
			total += 1;
			if (!row.unverified.includes(index)) grounded += 1;
		});
	}
	return { grounded, total };
};

// ---------------------------------------------------------------------------
// Running one case through the real two-call harness
// ---------------------------------------------------------------------------

type CallPerf = {
	promptTokens: number | null;
	generatedTokens: number | null;
	ttftMs: number | null;
	tokensPerSecond: number | null;
	backendDevice: string | null;
	wallMs: number;
};

const runCompletion = async (
	modelId: string,
	request: CompletionRequest,
): Promise<{ text: string; perf: CallPerf }> => {
	const start = performance.now();
	const run = sdk.completion({ modelId, stream: true, ...request });
	for await (const _ of run.events);
	const final = await run.final;
	const { stats } = final;
	return {
		text: final.contentText,
		perf: {
			promptTokens: stats?.promptTokens ?? null,
			generatedTokens: stats?.generatedTokens ?? null,
			ttftMs: stats?.timeToFirstToken ?? null,
			tokensPerSecond: stats?.tokensPerSecond ?? null,
			backendDevice: stats?.backendDevice ?? null,
			wallMs: performance.now() - start,
		},
	};
};

type CaseEvent = {
	event: "case";
	id: string;
	source: string;
	list: { prompt: CompletionRequest; raw: string; perf: CallPerf };
	rows: { prompt: CompletionRequest; raw: string; perf: CallPerf };
	items: string[];
	assembled: Generated | null;
	unverified: number[][];
	scores: CaseScore;
	grounding: { raw: GroundingCount; assembled: GroundingCount };
	wallMs: number;
	error?: string;
};

const runCase = async (
	modelId: string,
	mode: ModeId,
	id: string,
	source: string,
	goldRows: number,
	goldValues: readonly GoldValue[],
	now: Date,
): Promise<CaseEvent> => {
	const start = performance.now();
	try {
		const job = newSheetJob(mode, source, now);
		const list = await runCompletion(modelId, job.list);
		const items = parseList(list.text) ?? [source];
		const rowsRequest = job.rows(items);
		const rows = await runCompletion(modelId, rowsRequest);
		const assembled = assemble(
			source,
			rows.text,
			now,
			job.columns ?? undefined,
		);
		return {
			event: "case",
			id,
			source,
			list: { prompt: job.list, raw: list.text, perf: list.perf },
			rows: { prompt: rowsRequest, raw: rows.text, perf: rows.perf },
			items,
			assembled,
			unverified: (assembled?.rows ?? []).map((row) => row.unverified),
			scores: scoreCase(goldRows, goldValues, assembled),
			grounding: {
				raw: rawGrounding(source, rows.text),
				assembled: assembledGrounding(assembled),
			},
			wallMs: performance.now() - start,
		};
	} catch (error) {
		return {
			event: "case",
			id,
			source,
			list: {
				prompt: newSheetJob(mode, source, now).list,
				raw: "",
				perf: {
					promptTokens: null,
					generatedTokens: null,
					ttftMs: null,
					tokensPerSecond: null,
					backendDevice: null,
					wallMs: 0,
				},
			},
			rows: {
				prompt: newSheetJob(mode, source, now).list,
				raw: "",
				perf: {
					promptTokens: null,
					generatedTokens: null,
					ttftMs: null,
					tokensPerSecond: null,
					backendDevice: null,
					wallMs: 0,
				},
			},
			items: [],
			assembled: null,
			unverified: [],
			scores: scoreCase(goldRows, goldValues, null),
			grounding: {
				raw: { grounded: 0, total: 0 },
				assembled: { grounded: 0, total: 0 },
			},
			wallMs: performance.now() - start,
			error: error instanceof Error ? error.message : String(error),
		};
	}
};

// ---------------------------------------------------------------------------
// Run metadata + markdown report
// ---------------------------------------------------------------------------

type RunEvent = {
	event: "run";
	mode: ModeId;
	set: SetId;
	model: string;
	startedAt: string;
	host: {
		cpu: string;
		cores: number;
		totalMemGb: number;
		platform: string;
		release: string;
	};
	loadMs: number;
	firstDownload: boolean;
	sdkVersion: string;
};

const perfLine = (label: string, values: readonly CallPerf[]): string => {
	const ttft = compactNumbers(values.map((v) => v.ttftMs));
	const tps = compactNumbers(values.map((v) => v.tokensPerSecond));
	const wall = values.map((v) => v.wallMs);
	const promptTotal = sum(compactNumbers(values.map((v) => v.promptTokens)));
	const genTotal = sum(compactNumbers(values.map((v) => v.generatedTokens)));
	return (
		`**${label}.** TTFT mediano ${formatMs(median(ttft))} (p90 ${formatMs(percentile(ttft, 90))}), ` +
		`velocidad mediana ${formatRate(median(tps))}, tiempo de pared mediano ${formatMs(median(wall))} ` +
		`(p90 ${formatMs(percentile(wall, 90))}). Tokens de entrada: ${promptTotal}. Tokens generados: ${genTotal}.`
	);
};

const buildMarkdown = (run: RunEvent, events: readonly CaseEvent[]): string => {
	const count = events.length;
	const scores = events.map((event) => event.scores);

	const rowRecallValues = compactNumbers(
		scores.map((score) => score.rowRecall),
	);
	const overGenTotal = sum(scores.map((score) => score.overGeneration));
	const goldValuesTotal = sum(scores.map((score) => score.goldValues));
	const valuesFoundTotal = sum(scores.map((score) => score.valuesFound));
	const valueRecall = microAverage(valuesFoundTotal, goldValuesTotal);
	const columnsAvg =
		sum(scores.map((score) => score.columns)) / Math.max(1, count);
	const columnSaneRate = microAverage(
		scores.filter((score) => score.columnSane).length,
		count,
	);

	const rawGroundedTotal = sum(
		events.map((event) => event.grounding.raw.grounded),
	);
	const rawTotal = sum(events.map((event) => event.grounding.raw.total));
	const assembledGroundedTotal = sum(
		events.map((event) => event.grounding.assembled.grounded),
	);
	const assembledTotal = sum(
		events.map((event) => event.grounding.assembled.total),
	);

	const wallTotals = events.map((event) => event.wallMs);

	const metricsTable = [
		"| Métrica | Valor |",
		"| --- | --- |",
		`| Filas generadas / esperadas (total) | ${sum(scores.map((s) => s.generatedRows))} / ${sum(scores.map((s) => s.goldRows))} |`,
		`| Recall de filas (mediana) | ${formatPercent(median(rowRecallValues))} |`,
		`| Sobregeneración de filas (total) | ${overGenTotal} |`,
		`| Recall de valores clave | ${formatPercent(valueRecall)} (${valuesFoundTotal}/${goldValuesTotal}) |`,
		`| Fundamentación numérica, salida cruda | ${formatPercent(microAverage(rawGroundedTotal, rawTotal))} |`,
		`| Fundamentación numérica, tras ensamblar | ${formatPercent(microAverage(assembledGroundedTotal, assembledTotal))} |`,
		`| Columnas por hoja (promedio) | ${formatNum(columnsAvg)} |`,
		`| Encabezado con concepto numérico | ${formatPercent(columnSaneRate)} |`,
	].join("\n");

	return [
		`# Corrida de evaluación: ${run.set}, modo ${run.mode}, ${run.model}`,
		"",
		"## Host y carga",
		"",
		`cpu es \`${run.host.cpu}\` con ${run.host.cores} núcleos y ${run.host.totalMemGb} GB de memoria, corriendo ${run.host.platform} ${run.host.release}.`,
		`La carga del modelo tomó ${Math.round(run.loadMs)} ms${run.firstDownload ? ", incluyendo una descarga inicial" : ""}.`,
		`Versión del SDK \`${run.sdkVersion}\`, iniciada en ${run.startedAt}.`,
		"",
		"## Métricas",
		"",
		metricsTable,
		"",
		"## Cómo se puntúa",
		"",
		"**Filas.** Cada caso trae un número de filas esperado: una por movimiento en Finanzas, una por equipo en Equipos, y en Consultas una fila de paciente más una por medicamento indicado. El recall de filas es el mínimo entre las filas generadas y las esperadas, dividido entre las esperadas; un caso que genera de más no sube el recall pero sí cuenta como sobregeneración (filas generadas de más allá de las esperadas), sumada en todos los casos.",
		"",
		"**Recall de valores clave.** La hoja no tiene columnas fijas, así que en vez de comparar campo por campo se busca cada dato esperado en cualquier celda de la hoja generada: en Finanzas, cada monto y cada palabra de cuatro letras o más del concepto; en Equipos, cada marca, modelo, cantidad y antigüedad; en Consultas, el nombre del paciente, cada número de un signo vital, y cada medicamento con el número de su dosis. Los números exigen coincidencia exacta después de normalizar comas decimales; el texto cuenta como encontrado si aparece, sin tildes ni mayúsculas, dentro de alguna celda de texto generada.",
		"",
		"**Fundamentación.** Mide qué proporción de las celdas numéricas tiene sus dígitos presentes en el texto de origen. La tasa 'salida cruda' se calcula sobre la respuesta JSON de la llamada de filas antes de cualquier filtro; la tasa 'tras ensamblar' usa las marcas `unverified` que el propio ensamblado calcula. Ambas deberían acercarse al 100%, porque el ensamblado ya descarta o marca lo que el texto no respalda.",
		"",
		"**Columnas.** Se cuentan las columnas de cada hoja generada y se revisa si al menos un encabezado nombra un concepto que lleva número (monto, cantidad, dosis, temperatura, antigüedad, precio o total) en los casos donde el conjunto esperado sí tiene números; una hoja de Finanzas sin ninguna columna de monto, por ejemplo, reprueba esta métrica aunque sus filas luzcan razonables.",
		"",
		"## Rendimiento",
		"",
		perfLine(
			"Llamada de lista",
			events.map((event) => event.list.perf),
		),
		"",
		perfLine(
			"Llamada de filas",
			events.map((event) => event.rows.perf),
		),
		"",
		`**Total por caso.** Tiempo de pared mediano ${formatMs(median(wallTotals))}, p90 ${formatMs(percentile(wallTotals, 90))}.`,
		"",
	].join("\n");
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const GOLD_FILES: Record<SetId, string> = {
	finanzas: "eval/finanzas.json",
	equipos: "eval/equipos.json",
	consultations: "eval/consultations.json",
};

const main = async (): Promise<void> => {
	const args = parseArgs(process.argv.slice(2));
	const now = new Date("2026-09-10T12:00:00-05:00");

	const defaultModel = HARNESS[args.mode].extractor.sdkConstant;
	const model = args.model ?? defaultModel;
	const modelSrc = resolveModel(
		sdk as unknown as Record<string, unknown>,
		model,
	);
	const modelConfig = HARNESS[args.mode].extractor.modelConfig;

	mkdirSync("eval/runs", { recursive: true });

	const sdkPackage = (await Bun.file(
		"node_modules/@qvac/sdk/package.json",
	).json()) as {
		version: string;
	};

	type Prepared = {
		id: string;
		source: string;
		goldRows: number;
		goldValues: GoldValue[];
	};

	let prepared: Prepared[];
	if (args.set === "finanzas") {
		const all = (await Bun.file(GOLD_FILES.finanzas).json()) as FinanzasCase[];
		prepared = all.map((testCase) => ({
			id: testCase.id,
			source: testCase.text,
			goldRows: goldRowCount.finanzas(testCase.gold),
			goldValues: finanzasGoldValues(testCase.gold),
		}));
	} else if (args.set === "equipos") {
		const all = (await Bun.file(GOLD_FILES.equipos).json()) as EquiposCase[];
		prepared = all.map((testCase) => ({
			id: testCase.id,
			source: testCase.text,
			goldRows: goldRowCount.equipos(testCase.gold),
			goldValues: equiposGoldValues(testCase.gold),
		}));
	} else {
		const all = (await Bun.file(
			GOLD_FILES.consultations,
		).json()) as ConsultationCase[];
		prepared = all.map((testCase) => ({
			id: testCase.id,
			source: testCase.transcript,
			goldRows: goldRowCount.consultations(testCase.gold),
			goldValues: consultationGoldValues(testCase.gold),
		}));
	}
	if (args.limit !== null) prepared = prepared.slice(0, args.limit);

	await waitForNoOtherWorker();

	const { modelId, loadMs, firstDownload } = await loadModelTimed(
		modelSrc,
		modelConfig,
	);

	const cpus = os.cpus();
	const runEvent: RunEvent = {
		event: "run",
		mode: args.mode,
		set: args.set,
		model,
		startedAt: new Date().toISOString(),
		host: {
			cpu: cpus[0]?.model ?? "unknown",
			cores: cpus.length,
			totalMemGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
			platform: os.platform(),
			release: os.release(),
		},
		loadMs,
		firstDownload,
		sdkVersion: sdkPackage.version,
	};

	const runLogPath = `eval/runs/${args.set}-${model}.jsonl`;
	const reportPath = `eval/runs/${args.set}-${model}.md`;

	let markdown = "";
	try {
		writeFileSync(runLogPath, `${JSON.stringify(runEvent)}\n`);
		const events: CaseEvent[] = [];
		for (const testCase of prepared) {
			const caseEvent = await runCase(
				modelId,
				args.mode,
				testCase.id,
				testCase.source,
				testCase.goldRows,
				testCase.goldValues,
				now,
			);
			appendFileSync(runLogPath, `${JSON.stringify(caseEvent)}\n`);
			events.push(caseEvent);
		}
		markdown = buildMarkdown(runEvent, events);
		writeFileSync(reportPath, markdown);
	} finally {
		await sdk.unloadModel({ modelId, clearStorage: false });
	}

	console.log(markdown);
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
