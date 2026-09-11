import { appendFileSync, readFileSync } from "node:fs";
import * as sdk from "@qvac/sdk";

const HERE = import.meta.dirname;
const OUT = `${HERE}/note-results.jsonl`;
const log = (row) => {
	appendFileSync(OUT, `${JSON.stringify(row)}\n`);
	console.log(JSON.stringify(row, null, 1));
};

const text = (max) => ({ type: ["string", "null"], maxLength: max });
const num = { type: ["number", "null"] };
const SCHEMA = {
	type: "object",
	properties: {
		paciente: {
			type: "object",
			properties: {
				nombre: text(80),
				cedula: text(20),
				edad: text(20),
				sexo: { type: ["string", "null"], enum: ["Femenino", "Masculino", null] },
			},
			required: ["nombre", "cedula", "edad", "sexo"],
		},
		motivo_consulta: text(200),
		enfermedad_actual: text(500),
		antecedentes: text(300),
		alergias: text(120),
		medicamentos_actuales: text(200),
		signos_vitales: {
			type: "object",
			properties: {
				presion_arterial: text(12),
				frecuencia_cardiaca: num,
				frecuencia_respiratoria: num,
				temperatura: num,
				saturacion_oxigeno: num,
				peso_kg: num,
				talla_cm: num,
			},
			required: [
				"presion_arterial",
				"frecuencia_cardiaca",
				"frecuencia_respiratoria",
				"temperatura",
				"saturacion_oxigeno",
				"peso_kg",
				"talla_cm",
			],
		},
		examen_fisico: text(500),
		resultados: text(300),
		diagnosticos: {
			type: "array",
			maxItems: 6,
			items: {
				type: "object",
				properties: {
					descripcion: { type: "string", maxLength: 120 },
					cie10_sugerido: text(8),
					evidencia: text(160),
				},
				required: ["descripcion", "cie10_sugerido", "evidencia"],
			},
		},
		tratamiento: {
			type: "array",
			maxItems: 6,
			items: {
				type: "object",
				properties: {
					medicamento: { type: "string", maxLength: 80 },
					dosis: text(40),
					via: text(30),
					frecuencia: text(60),
					duracion: text(40),
					evidencia: text(160),
				},
				required: ["medicamento", "dosis", "via", "frecuencia", "duracion", "evidencia"],
			},
		},
		examenes_solicitados: text(200),
		referencia: text(200),
		indicaciones: text(300),
	},
	required: [
		"paciente",
		"motivo_consulta",
		"enfermedad_actual",
		"antecedentes",
		"alergias",
		"medicamentos_actuales",
		"signos_vitales",
		"examen_fisico",
		"resultados",
		"diagnosticos",
		"tratamiento",
		"examenes_solicitados",
		"referencia",
		"indicaciones",
	],
};

const SYSTEM =
	"Documentas consultas médicas. Recibes la transcripción de una consulta o el dictado de un médico. " +
	"Llena la nota solo con lo que se dijo. Usa null cuando algo no se dijo. " +
	"Nunca agregues diagnósticos, medicamentos, dosis ni signos vitales que no estén en la transcripción. " +
	"Escribe los términos completos, sin abreviaturas. " +
	"En evidencia copia las palabras exactas de la transcripción que respaldan el dato. " +
	"cie10_sugerido solo si estás seguro del código; si no, null. Fecha de hoy: 10 de septiembre de 2026.";

const rows = readFileSync(`${HERE}/asr-results.jsonl`, "utf8")
	.trim()
	.split("\n")
	.map((line) => JSON.parse(line));
const INPUTS = [
	["parakeet", rows.find((r) => r.model === "PARAKEET_TDT_0_6B_V3_Q4_0").text],
	["reference", rows.find((r) => r.kind === "reference").text],
];

const t0 = performance.now();
const modelId = await sdk.loadModel({
	modelSrc: sdk.HEALTHCARE_1_7B_MEDICAL_Q4_K_M,
	modelType: "llm",
	modelConfig: { ctx_size: 4096 },
});
log({ kind: "load", model: "HEALTHCARE_1_7B_MEDICAL_Q4_K_M", ms: Math.round(performance.now() - t0) });

for (const [source, transcript] of INPUTS) {
	const start = performance.now();
	const run = sdk.completion({
		modelId,
		history: [
			{ role: "system", content: SYSTEM },
			{ role: "user", content: transcript },
		],
		stream: true,
		generationParams: { temp: 0, predict: 1200 },
		responseFormat: {
			type: "json_schema",
			json_schema: { name: "nota_clinica", schema: SCHEMA },
		},
	});
	for await (const _ of run.events);
	const final = await run.final;
	let note = null;
	try {
		note = JSON.parse(final.contentText);
	} catch {}
	log({
		kind: "note",
		source,
		wallMs: Math.round(performance.now() - start),
		stats: final.stats,
		parsed: note !== null,
		note: note ?? final.contentText,
	});
}

await sdk.unloadModel({ modelId, clearStorage: false });
process.exit(0);
