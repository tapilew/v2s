import { appendFileSync, readFileSync } from "node:fs";
import * as sdk from "@qvac/sdk";

const HERE = import.meta.dirname;
const OUT = `${HERE}/note3-results.jsonl`;
const log = (row) => {
	appendFileSync(OUT, `${JSON.stringify(row)}\n`);
	console.log(JSON.stringify(row).slice(0, 3000));
};

const splitSentences = (text) =>
	text
		.replace(/\s+/g, " ")
		.split(/(?<=[.!?])\s+/)
		.map((s) => s.trim())
		.filter((s) => /[\p{L}\p{N}]/u.test(s));

const EXAMPLE_SENTENCES = [
	"Buenas tardes.",
	"Paciente Ana Ruiz, de 30 años.",
	"Tiene dolor de oído derecho desde hace dos días.",
	"No tiene alergias.",
	"Temperatura 37,8.",
	"El tímpano derecho está enrojecido.",
	"Diagnóstico otitis media aguda.",
	"Indico amoxicilina 500 mg por vía oral cada 8 horas por 7 días.",
];
const EXAMPLE_LABELS = ["X", "I", "S", "S", "O", "O", "A", "P"];
const EXAMPLE_NOTE = {
	paciente: { nombre: "Ana Ruiz", cedula: null, edad: "30 años", sexo: "Femenino" },
	motivo_consulta: "Dolor de oído derecho",
	enfermedad_actual: "Dolor de oído derecho desde hace dos días",
	antecedentes: null,
	alergias: "No tiene alergias",
	medicamentos_actuales: null,
	signos_vitales: { presion_arterial: null, frecuencia_cardiaca: null, frecuencia_respiratoria: null, temperatura: 37.8, saturacion_oxigeno: null, peso_kg: null, talla_cm: null },
	examen_fisico: "El tímpano derecho está enrojecido",
	resultados: null,
	diagnosticos: [{ descripcion: "Otitis media aguda", cie10_sugerido: "H66.9", evidencia: "Diagnóstico otitis media aguda" }],
	tratamiento: [{ medicamento: "Amoxicilina", dosis: "500 mg", via: "Oral", frecuencia: "Cada 8 horas", duracion: "7 días", evidencia: "Indico amoxicilina 500 mg por vía oral cada 8 horas por 7 días" }],
	examenes_solicitados: null,
	referencia: null,
	indicaciones: null,
};
const numbered = (sentences) => sentences.map((s, i) => `${i + 1}. ${s}`).join("\n");

const SOAP_SYSTEM =
	"Clasificas oraciones de una consulta médica. Para cada oración, en orden, escribe una letra. " +
	"I: identifica al paciente (nombre, edad, cédula). S: lo que cuenta el paciente, síntomas, antecedentes, alergias, medicamentos que ya toma. " +
	"O: signos vitales, examen físico, resultados. A: diagnóstico o impresión diagnóstica. P: tratamiento, exámenes pedidos, referencias, indicaciones al paciente. X: saludos y preguntas sin datos. " +
	`Ejemplo.\n${numbered(EXAMPLE_SENTENCES)}\nRespuesta: ${JSON.stringify({ letras: EXAMPLE_LABELS })}`;
const soapSchema = (count) => ({
	type: "object",
	properties: { letras: { type: "array", minItems: count, maxItems: count, items: { type: "string", enum: ["I", "S", "O", "A", "P", "X"] } } },
	required: ["letras"],
});

const NOTE_KEYS =
	"paciente (nombre, cedula, edad, sexo), motivo_consulta, enfermedad_actual, antecedentes, alergias, medicamentos_actuales, " +
	"signos_vitales (presion_arterial, frecuencia_cardiaca, frecuencia_respiratoria, temperatura, saturacion_oxigeno, peso_kg, talla_cm), " +
	"examen_fisico, resultados, diagnosticos (descripcion, cie10_sugerido, evidencia), tratamiento (medicamento, dosis, via, frecuencia, duracion, evidencia), examenes_solicitados, referencia, indicaciones";
const NOTE_RULES =
	"Documentas consultas médicas. Llena la nota solo con lo que se dijo; usa null cuando algo no se dijo. " +
	"Nunca inventes cédulas, edades, diagnósticos, medicamentos, dosis ni signos vitales. En evidencia copia las palabras exactas de la transcripción.";
const NOTE_EXAMPLE = `Ejemplo.\nTranscripción: ${EXAMPLE_SENTENCES.join(" ")}\nNota: ${JSON.stringify(EXAMPLE_NOTE)}`;

const text = (max) => ({ type: ["string", "null"], maxLength: max });
const num = { type: ["number", "null"] };
const NOTE_SCHEMA = {
	type: "object",
	properties: {
		paciente: { type: "object", properties: { nombre: text(80), cedula: text(20), edad: text(20), sexo: { type: ["string", "null"], enum: ["Femenino", "Masculino", null] } }, required: ["nombre", "cedula", "edad", "sexo"] },
		motivo_consulta: text(200),
		enfermedad_actual: text(400),
		antecedentes: text(300),
		alergias: text(120),
		medicamentos_actuales: text(200),
		signos_vitales: {
			type: "object",
			properties: { presion_arterial: text(12), frecuencia_cardiaca: num, frecuencia_respiratoria: num, temperatura: num, saturacion_oxigeno: num, peso_kg: num, talla_cm: num },
			required: ["presion_arterial", "frecuencia_cardiaca", "frecuencia_respiratoria", "temperatura", "saturacion_oxigeno", "peso_kg", "talla_cm"],
		},
		examen_fisico: text(400),
		resultados: text(300),
		diagnosticos: { type: "array", maxItems: 4, items: { type: "object", properties: { descripcion: { type: "string", maxLength: 100 }, cie10_sugerido: text(7), evidencia: text(160) }, required: ["descripcion", "cie10_sugerido", "evidencia"] } },
		tratamiento: {
			type: "array",
			maxItems: 5,
			items: { type: "object", properties: { medicamento: { type: "string", maxLength: 60 }, dosis: text(30), via: text(20), frecuencia: text(40), duracion: text(30), evidencia: text(160) }, required: ["medicamento", "dosis", "via", "frecuencia", "duracion", "evidencia"] },
		},
		examenes_solicitados: text(200),
		referencia: text(200),
		indicaciones: text(300),
	},
	required: ["paciente", "motivo_consulta", "enfermedad_actual", "antecedentes", "alergias", "medicamentos_actuales", "signos_vitales", "examen_fisico", "resultados", "diagnosticos", "tratamiento", "examenes_solicitados", "referencia", "indicaciones"],
};

const drain = async (run) => {
	for await (const _ of run.events);
	const final = await run.final;
	return { text: final.contentText, stats: final.stats };
};
const brief = (stats) => ({
	ttft: Math.round(stats?.timeToFirstToken ?? 0),
	tps: Number((stats?.tokensPerSecond ?? 0).toFixed(1)),
	prompt: stats?.promptTokens,
	gen: stats?.generatedTokens,
});
const jsonAfterThinking = (raw) => {
	const body = raw.includes("</think>") ? raw.slice(raw.lastIndexOf("</think>") + 8) : raw;
	const start = body.indexOf("{");
	const end = body.lastIndexOf("}");
	try {
		return JSON.parse(body.slice(start, end + 1));
	} catch {
		return null;
	}
};

const rows = readFileSync(`${HERE}/asr-results.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const INPUTS = [
	["parakeet", rows.find((r) => r.model === "PARAKEET_TDT_0_6B_V3_Q4_0").text],
	[
		"dictado",
		"Paciente Carlos Pérez, cédula 8-765-432, 58 años. Control de hipertensión arterial. Refiere cefalea occipital leve por las mañanas desde hace una semana. Antecedente de diabetes tipo 2 en tratamiento con metformina 850 mg dos veces al día. Presión arterial 150 sobre 95, frecuencia cardíaca 78, peso 86 kilos. Examen físico sin hallazgos relevantes, ruidos cardíacos rítmicos. Diagnóstico hipertensión arterial no controlada. Inicio losartán 50 mg por vía oral una vez al día. Solicito creatinina y perfil lipídico. Control en un mes, reducir la sal y caminar treinta minutos diarios.",
	],
];

const which = (process.env.VARIANTS ?? "soap,think,fewshot").split(",");
const modelSrc = sdk[process.env.MODEL ?? "HEALTHCARE_1_7B_MEDICAL_Q4_K_M"];
const t0 = performance.now();
const modelId = await sdk.loadModel({ modelSrc, modelType: "llm", modelConfig: { ctx_size: 4096 } });
log({ kind: "load", model: process.env.MODEL ?? "HEALTHCARE_1_7B_MEDICAL_Q4_K_M", ms: Math.round(performance.now() - t0) });

for (const [source, transcript] of INPUTS) {
	const sentences = splitSentences(transcript);
	if (which.includes("soap")) {
		const start = performance.now();
		const r = await drain(
			sdk.completion({
				modelId,
				history: [
					{ role: "system", content: SOAP_SYSTEM },
					{ role: "user", content: numbered(sentences) },
				],
				stream: true,
				generationParams: { temp: 0, predict: 40 + sentences.length * 6 },
				responseFormat: { type: "json_schema", json_schema: { name: "soap", schema: soapSchema(sentences.length) } },
			}),
		);
		const letters = JSON.parse(r.text).letras;
		log({ variant: "soap", source, ms: Math.round(performance.now() - start), ...brief(r.stats), labeled: sentences.map((s, i) => `${letters[i]} | ${s}`) });
	}
	if (which.includes("think")) {
		const start = performance.now();
		const r = await drain(
			sdk.completion({
				modelId,
				history: [
					{ role: "system", content: `${NOTE_RULES} Responde con un objeto JSON con estas claves: ${NOTE_KEYS}.` },
					{ role: "user", content: transcript },
				],
				stream: true,
				generationParams: { temp: 0.6, top_p: 0.95, seed: 42, predict: 1600, reasoning_budget: 384 },
			}),
		);
		log({ variant: "think", source, ms: Math.round(performance.now() - start), ...brief(r.stats), note: jsonAfterThinking(r.text), rawTail: r.text.slice(-300) });
	}
	if (which.includes("fewshot")) {
		const start = performance.now();
		const r = await drain(
			sdk.completion({
				modelId,
				history: [
					{ role: "system", content: `${NOTE_RULES}\n${NOTE_EXAMPLE}` },
					{ role: "user", content: `Transcripción: ${transcript}` },
				],
				stream: true,
				generationParams: { temp: 0, predict: 900 },
				responseFormat: { type: "json_schema", json_schema: { name: "nota_clinica", schema: NOTE_SCHEMA } },
			}),
		);
		let note = null;
		try {
			note = JSON.parse(r.text);
		} catch {}
		log({ variant: "fewshot", source, ms: Math.round(performance.now() - start), ...brief(r.stats), note: note ?? r.text });
	}
}

await sdk.unloadModel({ modelId, clearStorage: false });
process.exit(0);
