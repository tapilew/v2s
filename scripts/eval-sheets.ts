/// <reference types="bun-types" />

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import type { ModelProgressUpdate } from "@qvac/sdk";
import * as sdk from "@qvac/sdk";
import {
	assembleEquipos,
	type ExtractedUnit,
	type Extraction,
	equiposRequest,
	type Grounded,
} from "../src/modes/equipos";
import {
	type Categoria,
	finanzas,
	type Metodo,
	type Movimiento,
	type Tipo,
} from "../src/modes/finanzas";
import type { Draft } from "../src/sheet";

type Sheet = "equipos" | "finanzas";

const isSheet = (value: string): value is Sheet =>
	value === "equipos" || value === "finanzas";

type CliArgs = { sheet: Sheet; model: string | null; limit: number | null };

const parseArgs = (argv: readonly string[]): CliArgs => {
	let sheet: Sheet | null = null;
	let model: string | null = null;
	let limit: number | null = null;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--sheet") {
			const raw = argv[index + 1];
			if (raw === undefined || !isSheet(raw)) {
				throw new Error(
					`--sheet must be "equipos" or "finanzas", got "${raw ?? ""}"`,
				);
			}
			sheet = raw;
			index += 1;
		} else if (arg === "--model") {
			model = argv[index + 1] ?? null;
			index += 1;
		} else if (arg === "--limit") {
			const raw = argv[index + 1];
			const parsed = raw === undefined ? Number.NaN : Number(raw);
			if (!Number.isInteger(parsed) || parsed <= 0) {
				throw new Error(
					`--limit must be a positive integer, got "${raw ?? ""}"`,
				);
			}
			limit = parsed;
			index += 1;
		}
	}
	if (sheet === null) throw new Error("--sheet <equipos|finanzas> is required");
	return { sheet, model, limit };
};

const levenshtein = (a: string, b: string): number => {
	const table: number[][] = [];
	for (let row = 0; row <= a.length; row += 1) {
		table.push([row]);
	}
	for (let col = 1; col <= b.length; col += 1) {
		table[0].push(col);
	}
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

const formatCount = (value: number): string => String(value);

const normalize = (value: string): string =>
	value
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

const stringsMatch = (
	gold: string,
	predicted: string,
	allowContainment: boolean,
): boolean => {
	const normGold = normalize(gold);
	const normPredicted = normalize(predicted);
	if (normGold === normPredicted) return true;
	return (
		allowContainment &&
		(normGold.includes(normPredicted) || normPredicted.includes(normGold))
	);
};

type FieldScore = { field: string; correct: boolean; goldNull: boolean };

const scoreStringField = (
	field: string,
	gold: string | null,
	predicted: string | null,
	allowContainment: boolean,
): FieldScore =>
	gold === null
		? { field, correct: predicted === null, goldNull: true }
		: {
				field,
				correct:
					predicted !== null && stringsMatch(gold, predicted, allowContainment),
				goldNull: false,
			};

const scoreExactNumberField = (
	field: string,
	gold: number | null,
	predicted: number | null,
): FieldScore =>
	gold === null
		? { field, correct: predicted === null, goldNull: true }
		: {
				field,
				correct: predicted !== null && predicted === gold,
				goldNull: false,
			};

const scoreAgeField = (
	gold: number | null,
	predicted: number | null,
): FieldScore =>
	gold === null
		? { field: "antiguedad_anios", correct: predicted === null, goldNull: true }
		: {
				field: "antiguedad_anios",
				correct: predicted !== null && Math.abs(predicted - gold) <= 1,
				goldNull: false,
			};

const scoreEnumField = <T extends string>(
	field: string,
	gold: T | null,
	predicted: T | null,
): FieldScore =>
	gold === null
		? { field, correct: predicted === null, goldNull: true }
		: { field, correct: predicted === gold, goldNull: false };

const scoreHeaderFields = (
	gold: Extraction,
	predicted: Extraction,
): FieldScore[] => [
	scoreStringField("cliente", gold.cliente, predicted.cliente, true),
	scoreStringField("ciudad", gold.ciudad, predicted.ciudad, false),
	scoreStringField("pais", gold.pais, predicted.pais, false),
];

const scoreUnitFields = (pair: {
	predicted: ExtractedUnit;
	gold: ExtractedUnit;
}): FieldScore[] => [
	scoreExactNumberField(
		"cantidad",
		pair.gold.cantidad,
		pair.predicted.cantidad,
	),
	scoreStringField("marca", pair.gold.marca, pair.predicted.marca, true),
	scoreStringField("modelo", pair.gold.modelo, pair.predicted.modelo, true),
	scoreAgeField(pair.gold.antiguedad_anios, pair.predicted.antiguedad_anios),
	scoreEnumField("estado", pair.gold.estado, pair.predicted.estado),
];

type UnitMatch = { predicted: ExtractedUnit; gold: ExtractedUnit };

type UnitMatchResult = {
	matches: UnitMatch[];
	predictedCount: number;
	goldCount: number;
	invented: number;
};

const brandScore = (
	predicted: ExtractedUnit,
	candidate: ExtractedUnit,
): number =>
	predicted.marca !== null &&
	candidate.marca !== null &&
	normalize(predicted.marca) === normalize(candidate.marca)
		? 1
		: 0;

const matchUnits = (
	predictedUnits: readonly ExtractedUnit[],
	goldUnits: readonly ExtractedUnit[],
): UnitMatchResult => {
	const remaining = [...goldUnits];
	const matches: UnitMatch[] = [];
	for (const predicted of predictedUnits) {
		let best: { gold: ExtractedUnit; score: number } | null = null;
		for (const candidate of remaining) {
			if (candidate.modalidad !== predicted.modalidad) continue;
			const score = brandScore(predicted, candidate);
			if (best === null || score > best.score)
				best = { gold: candidate, score };
		}
		if (best === null) continue;
		matches.push({ predicted, gold: best.gold });
		remaining.splice(remaining.indexOf(best.gold), 1);
	}
	return {
		matches,
		predictedCount: predictedUnits.length,
		goldCount: goldUnits.length,
		invented: predictedUnits.length - matches.length,
	};
};

type CaseScore = {
	headerFields: FieldScore[];
	unitFields: FieldScore[];
	modalityMatches: number;
	predictedUnits: number;
	goldUnits: number;
	invented: number;
	parsed: boolean;
};

const EMPTY_EXTRACTION: Extraction = {
	cliente: null,
	ciudad: null,
	pais: null,
	equipos: [],
};

const scoreCase = (
	gold: Extraction,
	extraction: Extraction | null,
): CaseScore => {
	const predicted = extraction ?? EMPTY_EXTRACTION;
	const unitMatch = matchUnits(predicted.equipos, gold.equipos);
	return {
		headerFields: scoreHeaderFields(gold, predicted),
		unitFields: unitMatch.matches.flatMap(scoreUnitFields),
		modalityMatches: unitMatch.matches.length,
		predictedUnits: unitMatch.predictedCount,
		goldUnits: unitMatch.goldCount,
		invented: unitMatch.invented,
		parsed: extraction !== null,
	};
};

type EquiposCase = { id: string; text: string; gold: Extraction };

type CaseEvent = {
	event: "case";
	id: string;
	prompt: string;
	promptTokens: number | null;
	generatedTokens: number | null;
	ttftMs: number | null;
	tokensPerSecond: number | null;
	backendDevice: string | null;
	wallMs: number;
	raw: string | null;
	assembled: Grounded;
	unverified: string[];
	scores: CaseScore;
	error?: string;
};

const runEquiposCase = async (
	modelId: string,
	testCase: EquiposCase,
	now: Date,
): Promise<CaseEvent> => {
	const start = performance.now();
	try {
		const request = equiposRequest(testCase.text, now);
		const run = sdk.completion({ modelId, stream: true, ...request });
		let accumulated = "";
		for await (const event of run.events) {
			if (event.type === "contentDelta") accumulated += event.text;
		}
		const final = await run.final;
		const raw = final.contentText ?? accumulated;
		const assembled = assembleEquipos(testCase.text, raw, now);
		return {
			event: "case",
			id: testCase.id,
			prompt: testCase.text,
			promptTokens: final.stats?.promptTokens ?? null,
			generatedTokens: final.stats?.generatedTokens ?? null,
			ttftMs: final.stats?.timeToFirstToken ?? null,
			tokensPerSecond: final.stats?.tokensPerSecond ?? null,
			backendDevice: final.stats?.backendDevice ?? null,
			wallMs: performance.now() - start,
			raw,
			assembled,
			unverified: assembled.unverified,
			scores: scoreCase(testCase.gold, assembled.extraction),
		};
	} catch (error) {
		return {
			event: "case",
			id: testCase.id,
			prompt: testCase.text,
			promptTokens: null,
			generatedTokens: null,
			ttftMs: null,
			tokensPerSecond: null,
			backendDevice: null,
			wallMs: performance.now() - start,
			raw: null,
			assembled: { extraction: null, unverified: [] },
			unverified: [],
			scores: scoreCase(testCase.gold, null),
			error: error instanceof Error ? error.message : String(error),
		};
	}
};

type RunEvent = {
	event: "run";
	sheet: Sheet;
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

const FIELD_LABELS: Record<string, string> = {
	cliente: "Cliente",
	ciudad: "Ciudad",
	pais: "País",
	cantidad: "Cantidad",
	marca: "Marca",
	modelo: "Modelo",
	antiguedad_anios: "Antigüedad",
	estado: "Estado",
};

const FIELD_NAMES = Object.keys(FIELD_LABELS);

const fieldAccuracyFor = (
	fields: readonly FieldScore[],
	name: string,
): number | null => {
	const matching = fields.filter((field) => field.field === name);
	return microAverage(
		matching.filter((field) => field.correct).length,
		matching.length,
	);
};

const hallucinationRate = (fields: readonly FieldScore[]): number | null => {
	const goldNullFields = fields.filter((field) => field.goldNull);
	return microAverage(
		goldNullFields.filter((field) => !field.correct).length,
		goldNullFields.length,
	);
};

const buildMarkdown = (run: RunEvent, events: readonly CaseEvent[]): string => {
	const count = events.length;
	const fields = events.flatMap((event) => [
		...event.scores.headerFields,
		...event.scores.unitFields,
	]);

	const parseRate = microAverage(
		events.filter((event) => event.scores.parsed).length,
		count,
	);
	const fieldAccuracy = microAverage(
		fields.filter((field) => field.correct).length,
		fields.length,
	);
	const perFieldRows = FIELD_NAMES.map(
		(name) =>
			`| ${FIELD_LABELS[name]} | ${formatPercent(fieldAccuracyFor(fields, name))} |`,
	).join("\n");

	const modalityMatchesTotal = sum(
		events.map((event) => event.scores.modalityMatches),
	);
	const predictedUnitsTotal = sum(
		events.map((event) => event.scores.predictedUnits),
	);
	const goldUnitsTotal = sum(events.map((event) => event.scores.goldUnits));
	const modalityPrecision = microAverage(
		modalityMatchesTotal,
		predictedUnitsTotal,
	);
	const modalityRecall = microAverage(modalityMatchesTotal, goldUnitsTotal);
	const inventedTotal = sum(events.map((event) => event.scores.invented));

	const unverifiedRate = microAverage(
		events.filter((event) => event.unverified.length > 0).length,
		count,
	);

	const ttftValues = compactNumbers(events.map((event) => event.ttftMs));
	const tokensPerSecondValues = compactNumbers(
		events.map((event) => event.tokensPerSecond),
	);
	const wallMsValues = events.map((event) => event.wallMs);
	const promptTokensTotal = sum(
		compactNumbers(events.map((event) => event.promptTokens)),
	);
	const generatedTokensTotal = sum(
		compactNumbers(events.map((event) => event.generatedTokens)),
	);

	const metricsTable = [
		"| Métrica | Valor |",
		"| --- | --- |",
		`| Tasa de parseo | ${formatPercent(parseRate)} |`,
		`| Precisión de campos (global) | ${formatPercent(fieldAccuracy)} |`,
		perFieldRows,
		`| Tasa de alucinación | ${formatPercent(hallucinationRate(fields))} |`,
		`| Equipos inventados | ${formatCount(inventedTotal)} |`,
		`| Precisión / recall de modalidad | ${formatPercent(modalityPrecision)} / ${formatPercent(modalityRecall)} |`,
		`| Tasa de datos sin verificar | ${formatPercent(unverifiedRate)} |`,
	].join("\n");

	return [
		`# Corrida de evaluación: ${run.sheet}, ${run.model}`,
		"",
		"## Host y carga",
		"",
		`cpu es \`${run.host.cpu}\` con ${run.host.cores} núcleos y ${run.host.totalMemGb} GB de memoria, corriendo ${run.host.platform} ${run.host.release}.`,
		`La carga del modelo tomó ${Math.round(run.loadMs)} ms${run.firstDownload ? ", incluyendo una descarga inicial" : ""}.`,
		`Versión del SDK \`${run.sdkVersion}\`, iniciada en ${run.startedAt}.`,
		"",
		"## Cómo se puntúa",
		"",
		"Cliente, ciudad y país cuentan como correctos cuando el dato esperado es nulo y el modelo tampoco dice nada, o cuando ambos coinciden después de normalizar el texto (sin tildes, en minúsculas, sin puntuación). En cliente también cuenta si el nombre de uno contiene al del otro, porque el modelo a veces agrega o quita palabras como 'Hospital' o 'Clínica'. Cuando el dato esperado es nulo pero el modelo dice algo, ese campo cuenta como alucinación en vez de simple error. Los equipos se emparejan por modalidad (resonador, tomógrafo, ecógrafo, etc.), prefiriendo el candidato cuya marca coincide con la que dijo el modelo; cantidad exige el mismo número, antigüedad acepta un año de diferencia, marca y modelo aceptan coincidencia o contención de texto, y estado exige igualdad exacta. Un equipo predicho que no encuentra pareja en los datos esperados cuenta como 'equipo inventado'; un equipo esperado sin pareja simplemente baja el recall de modalidad. La tasa de datos sin verificar mide en cuántos casos el sistema descartó al menos un dato porque el texto original no lo respaldaba.",
		"",
		"## Métricas",
		"",
		metricsTable,
		"",
		"## Rendimiento",
		"",
		`Tiempo mediano al primer token es ${formatMs(median(ttftValues))}, p90 es ${formatMs(percentile(ttftValues, 90))}.`,
		`Velocidad mediana de generación es ${formatRate(median(tokensPerSecondValues))}.`,
		`Tiempo mediano de pared por caso es ${formatMs(median(wallMsValues))}.`,
		`Tokens de prompt totales: ${promptTokensTotal}. Tokens generados totales: ${generatedTokensTotal}.`,
		"",
	].join("\n");
};

const EQUIPOS_MODEL_CONFIG = { device: "gpu", ctx_size: 2048 };
const EQUIPOS_DEFAULT_MODEL = "HEALTHCARE_1_7B_MEDICAL_Q4_K_M";

type FinanzasGoldRow = {
	concepto: string;
	tipo: Tipo;
	categoria: Categoria;
	monto: number;
	metodo: Metodo | null;
};

type FinanzasCase = {
	id: string;
	text: string;
	gold: FinanzasGoldRow[];
	note?: string;
};

const tokensOfNormalized = (value: string): Set<string> =>
	new Set(
		normalize(value)
			.split(" ")
			.filter((token) => token.length > 0),
	);

const conceptoTokenOverlap = (a: string, b: string): number => {
	const tokensB = tokensOfNormalized(b);
	let overlap = 0;
	for (const token of tokensOfNormalized(a)) {
		if (tokensB.has(token)) overlap += 1;
	}
	return overlap;
};

const CONCEPTO_RECALL_THRESHOLD = 0.5;

const conceptoRecall = (gold: string, predicted: string): number => {
	const goldTokens = tokensOfNormalized(gold);
	if (goldTokens.size === 0) return 0;
	const predictedTokens = tokensOfNormalized(predicted);
	let found = 0;
	for (const token of goldTokens) {
		if (predictedTokens.has(token)) found += 1;
	}
	return found / goldTokens.size;
};

const conceptoIsCorrect = (gold: string, predicted: string): boolean =>
	conceptoRecall(gold, predicted) >= CONCEPTO_RECALL_THRESHOLD;

type FinanzasRowMatch = { predicted: Movimiento; gold: FinanzasGoldRow };

type FinanzasRowMatchResult = {
	matches: FinanzasRowMatch[];
	predictedCount: number;
	goldCount: number;
};

const matchFinanzasRows = (
	predictedRows: readonly Movimiento[],
	goldRows: readonly FinanzasGoldRow[],
): FinanzasRowMatchResult => {
	const remaining = [...goldRows];
	const matches: FinanzasRowMatch[] = [];
	for (const predicted of predictedRows) {
		let best: FinanzasGoldRow | null = null;
		let bestScore = -1;
		for (const candidate of remaining) {
			if (candidate.monto !== predicted.monto) continue;
			const score = conceptoTokenOverlap(
				predicted.concepto,
				candidate.concepto,
			);
			if (best === null || score > bestScore) {
				best = candidate;
				bestScore = score;
			}
		}
		if (best === null) continue;
		matches.push({ predicted, gold: best });
		remaining.splice(remaining.indexOf(best), 1);
	}
	return {
		matches,
		predictedCount: predictedRows.length,
		goldCount: goldRows.length,
	};
};

const scoreFinanzasFields = (pair: FinanzasRowMatch): FieldScore[] => [
	scoreEnumField("tipo", pair.gold.tipo, pair.predicted.tipo),
	scoreEnumField("categoria", pair.gold.categoria, pair.predicted.categoria),
	scoreEnumField("metodo", pair.gold.metodo, pair.predicted.metodo),
];

type FinanzasInventedMetodoStats = { numerator: number; denominator: number };

const inventedMetodoStats = (
	matches: readonly FinanzasRowMatch[],
): FinanzasInventedMetodoStats => {
	const eligible = matches.filter((match) => match.gold.metodo === null);
	return {
		numerator: eligible.filter((match) => match.predicted.metodo !== null)
			.length,
		denominator: eligible.length,
	};
};

type FinanzasCaseScore = {
	fields: FieldScore[];
	matches: number;
	predictedRows: number;
	goldRows: number;
	conceptoCorrectCount: number;
	inventedMetodoNumerator: number;
	inventedMetodoDenominator: number;
	parsed: boolean;
};

const scoreFinanzasCase = (
	gold: readonly FinanzasGoldRow[],
	extraction: readonly Movimiento[] | null,
): FinanzasCaseScore => {
	const predicted = extraction ?? [];
	const rowMatch = matchFinanzasRows(predicted, gold);
	const inventedMetodo = inventedMetodoStats(rowMatch.matches);
	return {
		fields: rowMatch.matches.flatMap(scoreFinanzasFields),
		matches: rowMatch.matches.length,
		predictedRows: rowMatch.predictedCount,
		goldRows: rowMatch.goldCount,
		conceptoCorrectCount: rowMatch.matches.filter((match) =>
			conceptoIsCorrect(match.gold.concepto, match.predicted.concepto),
		).length,
		inventedMetodoNumerator: inventedMetodo.numerator,
		inventedMetodoDenominator: inventedMetodo.denominator,
		parsed: extraction !== null,
	};
};

type FinanzasCaseEvent = {
	event: "case";
	id: string;
	prompt: string;
	promptTokens: number | null;
	generatedTokens: number | null;
	ttftMs: number | null;
	tokensPerSecond: number | null;
	backendDevice: string | null;
	wallMs: number;
	raw: string | null;
	assembled: Draft<Movimiento[]> | null;
	unverified: string[];
	scores: FinanzasCaseScore;
	error?: string;
};

const runFinanzasCase = async (
	modelId: string,
	testCase: FinanzasCase,
	now: Date,
): Promise<FinanzasCaseEvent> => {
	const start = performance.now();
	try {
		const request = finanzas.request(testCase.text, now);
		const run = sdk.completion({ modelId, stream: true, ...request });
		let accumulated = "";
		for await (const event of run.events) {
			if (event.type === "contentDelta") accumulated += event.text;
		}
		const final = await run.final;
		const raw = final.contentText ?? accumulated;
		const assembled = finanzas.assemble(testCase.text, raw, now);
		return {
			event: "case",
			id: testCase.id,
			prompt: testCase.text,
			promptTokens: final.stats?.promptTokens ?? null,
			generatedTokens: final.stats?.generatedTokens ?? null,
			ttftMs: final.stats?.timeToFirstToken ?? null,
			tokensPerSecond: final.stats?.tokensPerSecond ?? null,
			backendDevice: final.stats?.backendDevice ?? null,
			wallMs: performance.now() - start,
			raw,
			assembled,
			unverified: assembled?.unverified ?? [],
			scores: scoreFinanzasCase(testCase.gold, assembled?.extraction ?? null),
		};
	} catch (error) {
		return {
			event: "case",
			id: testCase.id,
			prompt: testCase.text,
			promptTokens: null,
			generatedTokens: null,
			ttftMs: null,
			tokensPerSecond: null,
			backendDevice: null,
			wallMs: performance.now() - start,
			raw: null,
			assembled: null,
			unverified: [],
			scores: scoreFinanzasCase(testCase.gold, null),
			error: error instanceof Error ? error.message : String(error),
		};
	}
};

const FINANZAS_FIELD_LABELS: Record<string, string> = {
	tipo: "Tipo",
	categoria: "Categoría",
	metodo: "Método",
};

const FINANZAS_FIELD_NAMES = Object.keys(FINANZAS_FIELD_LABELS);

const buildFinanzasMarkdown = (
	run: RunEvent,
	events: readonly FinanzasCaseEvent[],
): string => {
	const count = events.length;
	const fields = events.flatMap((event) => event.scores.fields);

	const parseRate = microAverage(
		events.filter((event) => event.scores.parsed).length,
		count,
	);
	const perFieldRows = FINANZAS_FIELD_NAMES.map(
		(name) =>
			`| ${FINANZAS_FIELD_LABELS[name]} | ${formatPercent(fieldAccuracyFor(fields, name))} |`,
	).join("\n");

	const matchesTotal = sum(events.map((event) => event.scores.matches));
	const predictedRowsTotal = sum(
		events.map((event) => event.scores.predictedRows),
	);
	const goldRowsTotal = sum(events.map((event) => event.scores.goldRows));
	const rowPrecision = microAverage(matchesTotal, predictedRowsTotal);
	const rowRecall = microAverage(matchesTotal, goldRowsTotal);
	const inventedRowsTotal = predictedRowsTotal - matchesTotal;

	const conceptoCorrectTotal = sum(
		events.map((event) => event.scores.conceptoCorrectCount),
	);
	const conceptoAccuracy = microAverage(conceptoCorrectTotal, matchesTotal);

	const inventedMetodoNumeratorTotal = sum(
		events.map((event) => event.scores.inventedMetodoNumerator),
	);
	const inventedMetodoDenominatorTotal = sum(
		events.map((event) => event.scores.inventedMetodoDenominator),
	);
	const inventedMetodoRate = microAverage(
		inventedMetodoNumeratorTotal,
		inventedMetodoDenominatorTotal,
	);

	const atmCase = events.find((event) => event.id === "f10");
	const atmLine =
		atmCase === undefined
			? null
			: (() => {
					const invented =
						atmCase.scores.predictedRows - atmCase.scores.matches;
					const verdict = invented === 0 ? "pasa" : "falla";
					return `El caso f10 (retiro del cajero) ${verdict}: predijo ${atmCase.scores.predictedRows} fila(s) y generó ${invented} fila(s) inventada(s).`;
				})();

	const ttftValues = compactNumbers(events.map((event) => event.ttftMs));
	const tokensPerSecondValues = compactNumbers(
		events.map((event) => event.tokensPerSecond),
	);
	const wallMsValues = events.map((event) => event.wallMs);
	const promptTokensTotal = sum(
		compactNumbers(events.map((event) => event.promptTokens)),
	);
	const generatedTokensTotal = sum(
		compactNumbers(events.map((event) => event.generatedTokens)),
	);

	const metricsTable = [
		"| Métrica | Valor |",
		"| --- | --- |",
		`| Tasa de parseo | ${formatPercent(parseRate)} |`,
		`| Precisión de filas | ${formatPercent(rowPrecision)} |`,
		`| Recall de filas | ${formatPercent(rowRecall)} |`,
		perFieldRows,
		`| Precisión de concepto | ${formatPercent(conceptoAccuracy)} |`,
		`| Filas inventadas | ${formatCount(inventedRowsTotal)} |`,
		`| Tasa de método inventado | ${formatPercent(inventedMetodoRate)} |`,
	].join("\n");

	return [
		`# Corrida de evaluación: ${run.sheet}, ${run.model}`,
		"",
		"## Host y carga",
		"",
		`cpu es \`${run.host.cpu}\` con ${run.host.cores} núcleos y ${run.host.totalMemGb} GB de memoria, corriendo ${run.host.platform} ${run.host.release}.`,
		`La carga del modelo tomó ${Math.round(run.loadMs)} ms${run.firstDownload ? ", incluyendo una descarga inicial" : ""}.`,
		`Versión del SDK \`${run.sdkVersion}\`, iniciada en ${run.startedAt}.`,
		"",
		"## Cómo se puntúa",
		"",
		"Cada fila predicha se empareja, en el orden en que el modelo la produjo, con la fila esperada que aún no tiene pareja y cuyo monto coincide exactamente; si hay más de una candidata con ese monto, gana la que comparte más palabras de concepto (normalizado sin tildes ni mayúsculas), y en caso de empate gana la que aparece primero en los datos esperados. Una fila predicha sin ninguna candidata de igual monto cuenta como inventada. Tipo, categoría y método cuentan como correctos cuando ambos son nulos o cuando coinciden exactamente. El concepto no exige coincidencia exacta: se considera correcto cuando al menos la mitad de las palabras normalizadas del concepto esperado aparecen en el concepto predicho. La tasa de método inventado mide, solo entre filas ya emparejadas, en cuántas el modelo puso un método de pago que el texto no mencionaba (metodo esperado nulo). El caso f10 verifica que retirar efectivo del cajero no genere ninguna fila.",
		"",
		"## Métricas",
		"",
		metricsTable,
		...(atmLine === null ? [] : ["", atmLine]),
		"",
		"## Rendimiento",
		"",
		`Tiempo mediano al primer token es ${formatMs(median(ttftValues))}, p90 es ${formatMs(percentile(ttftValues, 90))}.`,
		`Velocidad mediana de generación es ${formatRate(median(tokensPerSecondValues))}.`,
		`Tiempo mediano de pared por caso es ${formatMs(median(wallMsValues))}.`,
		`Tokens de prompt totales: ${promptTokensTotal}. Tokens generados totales: ${generatedTokensTotal}.`,
		"",
	].join("\n");
};

const FINANZAS_MODEL_CONFIG = { device: "gpu", ctx_size: 2048 };
const FINANZAS_DEFAULT_MODEL = "QWEN3_1_7B_INST_Q4";

type SheetRunner<TCase, TCaseEvent extends { event: "case" }> = {
	defaultModel: string;
	modelConfig: Record<string, unknown>;
	goldFile: string;
	runCase: (modelId: string, testCase: TCase, now: Date) => Promise<TCaseEvent>;
	buildMarkdown: (run: RunEvent, events: readonly TCaseEvent[]) => string;
};

const runSheet = async <TCase, TCaseEvent extends { event: "case" }>(
	args: CliArgs,
	now: Date,
	runner: SheetRunner<TCase, TCaseEvent>,
): Promise<void> => {
	const model = args.model ?? runner.defaultModel;
	const modelSrc = resolveModel(sdk as Record<string, unknown>, model);

	const goldFile = Bun.file(runner.goldFile);
	const allCases = (await goldFile.json()) as TCase[];
	const cases = args.limit === null ? allCases : allCases.slice(0, args.limit);

	mkdirSync("eval/runs", { recursive: true });

	const sdkPackageFile = Bun.file("node_modules/@qvac/sdk/package.json");
	const sdkPackage = (await sdkPackageFile.json()) as { version: string };

	await waitForNoOtherWorker();

	const { modelId, loadMs, firstDownload } = await loadModelTimed(
		modelSrc,
		runner.modelConfig,
	);

	const cpus = os.cpus();
	const runEvent: RunEvent = {
		event: "run",
		sheet: args.sheet,
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

	const runLogPath = `eval/runs/${args.sheet}-${model}.jsonl`;
	const reportPath = `eval/runs/${args.sheet}-${model}.md`;

	let markdown = "";
	try {
		writeFileSync(runLogPath, `${JSON.stringify(runEvent)}\n`);
		const events: TCaseEvent[] = [];
		for (const testCase of cases) {
			const caseEvent = await runner.runCase(modelId, testCase, now);
			appendFileSync(runLogPath, `${JSON.stringify(caseEvent)}\n`);
			events.push(caseEvent);
		}
		markdown = runner.buildMarkdown(runEvent, events);
		writeFileSync(reportPath, markdown);
	} finally {
		await sdk.unloadModel({ modelId, clearStorage: false });
	}

	console.log(markdown);
};

const main = async (): Promise<void> => {
	const args = parseArgs(process.argv.slice(2));
	const now = new Date("2026-09-10T12:00:00-05:00");

	if (args.sheet === "equipos") {
		await runSheet<EquiposCase, CaseEvent>(args, now, {
			defaultModel: EQUIPOS_DEFAULT_MODEL,
			modelConfig: EQUIPOS_MODEL_CONFIG,
			goldFile: "eval/equipos.json",
			runCase: runEquiposCase,
			buildMarkdown,
		});
		return;
	}

	await runSheet<FinanzasCase, FinanzasCaseEvent>(args, now, {
		defaultModel: FINANZAS_DEFAULT_MODEL,
		modelConfig: FINANZAS_MODEL_CONFIG,
		goldFile: "eval/finanzas.json",
		runCase: runFinanzasCase,
		buildMarkdown: buildFinanzasMarkdown,
	});
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
