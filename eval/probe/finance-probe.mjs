import { appendFileSync } from "node:fs";
import * as sdk from "@qvac/sdk";

const HERE = import.meta.dirname;
const OUT = `${HERE}/finance-results.jsonl`;
const log = (row) => {
	appendFileSync(OUT, `${JSON.stringify(row)}\n`);
	console.log(JSON.stringify(row).slice(0, 1500));
};

const CATEGORIES = ["Alimentación", "Transporte", "Vivienda", "Servicios", "Salud", "Educación", "Entretenimiento", "Compras", "Ingreso", "Ahorro", "Otro"];
const METHODS = ["Efectivo", "Tarjeta", "Transferencia", "Yappy", null];
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
					tipo: { type: "string", enum: ["Ingreso", "Gasto", "Ahorro"] },
					categoria: { type: "string", enum: CATEGORIES },
					monto: { type: "number" },
					metodo: { type: ["string", "null"], enum: METHODS },
					fecha: { type: ["string", "null"], maxLength: 20 },
				},
				required: ["concepto", "tipo", "categoria", "monto", "metodo", "fecha"],
			},
		},
	},
	required: ["movimientos"],
};

const EXAMPLE_TEXT = "Compré el súper por 80 dólares con tarjeta y le pasé 20 a mi cuenta de ahorros.";
const EXAMPLE = {
	movimientos: [
		{ concepto: "Supermercado", tipo: "Gasto", categoria: "Alimentación", monto: 80, metodo: "Tarjeta", fecha: null },
		{ concepto: "Depósito a cuenta de ahorros", tipo: "Ahorro", categoria: "Ahorro", monto: 20, metodo: "Transferencia", fecha: null },
	],
};
const SYSTEM =
	"Conviertes lo que alguien dice sobre su dinero en filas de una hoja de cálculo. Cada movimiento es una fila. " +
	"Usa solo los montos que se dijeron; nunca inventes montos. fecha solo si se dijo (hoy, ayer, una fecha), si no null. metodo null si no se dijo. " +
	`Ejemplo.\nTexto: ${EXAMPLE_TEXT}\nFilas: ${JSON.stringify(EXAMPLE)}`;

const INPUTS = [
	"Hoy pagué 45 dólares de luz con Yappy y 12 de almuerzo en efectivo.",
	"Me cayó la quincena, 850 dólares, y pasé 100 a la cuenta de ahorros.",
	"Gasté 60 en gasolina con tarjeta.",
	"Ayer compré útiles escolares por 38.50 y el taxi fue 6.",
	"Recibí 200 de un trabajo extra y ahorré la mitad.",
	"Pagué el alquiler, 550, por transferencia.",
];

for (const name of (process.env.MODELS ?? "HEALTHCARE_1_7B_MEDICAL_Q4_K_M,QWEN3_1_7B_INST_Q4").split(",")) {
	const t0 = performance.now();
	const modelId = await sdk.loadModel({ modelSrc: sdk[name], modelType: "llm", modelConfig: { ctx_size: 2048 } });
	log({ kind: "load", model: name, ms: Math.round(performance.now() - t0) });
	for (const text of INPUTS) {
		const start = performance.now();
		const run = sdk.completion({
			modelId,
			history: [
				{ role: "system", content: SYSTEM },
				{ role: "user", content: `Texto: ${text}` },
			],
			stream: true,
			generationParams: { temp: 0, predict: 300 },
			responseFormat: { type: "json_schema", json_schema: { name: "filas", schema: SCHEMA } },
		});
		for await (const _ of run.events);
		const final = await run.final;
		const s = final.stats ?? {};
		log({
			kind: "rows",
			model: name,
			text,
			ms: Math.round(performance.now() - start),
			ttft: Math.round(s.timeToFirstToken ?? 0),
			tps: Number((s.tokensPerSecond ?? 0).toFixed(1)),
			prompt: s.promptTokens,
			gen: s.generatedTokens,
			out: final.contentText,
		});
	}
	await sdk.unloadModel({ modelId, clearStorage: false });
}
process.exit(0);
