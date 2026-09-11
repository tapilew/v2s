import { appendFileSync, readFileSync } from "node:fs";
import * as sdk from "@qvac/sdk";

const HERE = import.meta.dirname;
const OUT = `${HERE}/note2-results.jsonl`;
const log = (row) => {
	appendFileSync(OUT, `${JSON.stringify(row)}\n`);
	console.log(JSON.stringify(row, null, 1));
};

const FIELDS = [
	"identificacion",
	"motivo_consulta",
	"enfermedad_actual",
	"antecedentes",
	"alergias",
	"medicamentos_actuales",
	"signos_vitales",
	"examen_fisico",
	"resultados",
	"diagnostico",
	"tratamiento",
	"examenes_solicitados",
	"referencia",
	"indicaciones",
	"otro",
];

const splitSentences = (text) =>
	text
		.replace(/\s+/g, " ")
		.split(/(?<=[.!?])\s+/)
		.map((s) => s.trim())
		.filter((s) => /[\p{L}\p{N}]/u.test(s));

const SECTION_SYSTEM =
	"Ordenas una consulta médica en las secciones de una nota clínica. Recibes oraciones numeradas. " +
	"Para cada oración, en el mismo orden, indica una o dos secciones. " +
	"identificacion: nombre, cédula, edad o sexo del paciente. motivo_consulta: por qué consulta. enfermedad_actual: síntomas y su evolución. " +
	"antecedentes: enfermedades previas o familiares. alergias. medicamentos_actuales: lo que ya toma. signos_vitales: presión, pulso, temperatura, saturación, peso. " +
	"examen_fisico: lo que el médico encuentra al examinar. resultados: exámenes ya hechos. diagnostico: impresión diagnóstica. tratamiento: medicamentos indicados. " +
	"examenes_solicitados: estudios que se piden. referencia: envío a otro especialista. indicaciones: instrucciones o advertencias al paciente. otro: saludos o frases sin datos clínicos.";

const sectionSchema = (count) => ({
	type: "object",
	properties: {
		secciones: {
			type: "array",
			minItems: count,
			maxItems: count,
			items: {
				type: "array",
				minItems: 1,
				maxItems: 2,
				items: { type: "string", enum: FIELDS },
			},
		},
	},
	required: ["secciones"],
});

const text = (max) => ({ type: ["string", "null"], maxLength: max });
const num = { type: ["number", "null"] };
const DETAIL_SCHEMA = {
	type: "object",
	properties: {
		paciente: {
			type: "object",
			properties: {
				nombre: text(80),
				cedula: text(20),
				edad_anios: num,
				sexo: { type: ["string", "null"], enum: ["Femenino", "Masculino", null] },
			},
			required: ["nombre", "cedula", "edad_anios", "sexo"],
		},
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
		diagnosticos: {
			type: "array",
			maxItems: 4,
			items: {
				type: "object",
				properties: {
					descripcion: { type: "string", maxLength: 100 },
					cie10_sugerido: text(7),
				},
				required: ["descripcion", "cie10_sugerido"],
			},
		},
		tratamiento: {
			type: "array",
			maxItems: 5,
			items: {
				type: "object",
				properties: {
					medicamento: { type: "string", maxLength: 60 },
					dosis: text(30),
					via: text(20),
					frecuencia: text(40),
					duracion: text(30),
				},
				required: ["medicamento", "dosis", "via", "frecuencia", "duracion"],
			},
		},
	},
	required: ["paciente", "signos_vitales", "diagnosticos", "tratamiento"],
};

const DETAIL_SYSTEM =
	"Extraes datos exactos de oraciones de una consulta médica. Copia solo lo que está escrito. " +
	"Usa null si el dato no aparece. No inventes cédulas, edades, dosis ni valores. " +
	"Números con punto decimal. cie10_sugerido solo si estás seguro, si no null.";

const norm = (s) =>
	String(s)
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
const digits = (s) => String(s).replace(/\D/g, "");
const groundedText = (value, source) => {
	const words = norm(value).split(" ").filter((w) => w.length > 2);
	if (!words.length) return true;
	const hay = ` ${norm(source)} `;
	const hits = words.filter((w) => hay.includes(` ${w} `) || hay.includes(w)).length;
	return hits / words.length >= 0.7;
};
const groundedNumber = (value, source) =>
	digits(value).length > 0 && digits(source.replace(/(\d)[.,](\d)/g, "$1$2")).includes(digits(value));

const time = async (fn) => {
	const t0 = performance.now();
	const value = await fn();
	return { value, ms: Math.round(performance.now() - t0) };
};
const complete = async (modelId, system, user, schema, predict) => {
	const run = sdk.completion({
		modelId,
		history: [
			{ role: "system", content: system },
			{ role: "user", content: user },
		],
		stream: true,
		generationParams: { temp: 0, predict },
		responseFormat: { type: "json_schema", json_schema: { name: "salida", schema } },
	});
	for await (const _ of run.events);
	const final = await run.final;
	return { json: JSON.parse(final.contentText), stats: final.stats };
};

const rows = readFileSync(`${HERE}/asr-results.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const INPUTS = [
	["parakeet", rows.find((r) => r.model === "PARAKEET_TDT_0_6B_V3_Q4_0").text],
	[
		"dictado",
		"Paciente Carlos Pérez, cédula 8-765-432, 58 años. Control de hipertensión arterial. Refiere cefalea occipital leve por las mañanas desde hace una semana. Antecedente de diabetes tipo 2 en tratamiento con metformina 850 mg dos veces al día. Presión arterial 150 sobre 95, frecuencia cardíaca 78, peso 86 kilos. Examen físico sin hallazgos relevantes, ruidos cardíacos rítmicos. Diagnóstico hipertensión arterial no controlada. Inicio losartán 50 mg por vía oral una vez al día. Solicito creatinina y perfil lipídico. Control en un mes, reducir la sal y caminar treinta minutos diarios.",
	],
];

const load = await time(() =>
	sdk.loadModel({ modelSrc: sdk.HEALTHCARE_1_7B_MEDICAL_Q4_K_M, modelType: "llm", modelConfig: { ctx_size: 4096 } }),
);
log({ kind: "load", ms: load.ms });

for (const [source, transcript] of INPUTS) {
	const sentences = splitSentences(transcript);
	const numbered = sentences.map((s, i) => `${i + 1}. ${s}`).join("\n");
	const stage1 = await time(() =>
		complete(load.value, SECTION_SYSTEM, numbered, sectionSchema(sentences.length), 60 + sentences.length * 16),
	);
	const bySection = {};
	sentences.forEach((s, i) => {
		for (const f of stage1.value.json.secciones[i] ?? ["otro"]) (bySection[f] ??= []).push(s);
	});
	const relevant = ["identificacion", "signos_vitales", "diagnostico", "tratamiento", "medicamentos_actuales"]
		.flatMap((f) => bySection[f] ?? [])
		.filter((s, i, all) => all.indexOf(s) === i);
	const stage2 = await time(() =>
		complete(load.value, DETAIL_SYSTEM, relevant.join("\n"), DETAIL_SCHEMA, 400),
	);
	const d = stage2.value.json;
	const src = relevant.join(" ");
	const flags = [];
	const check = (path, value, kind) => {
		if (value === null || value === undefined) return value;
		const ok = kind === "number" ? groundedNumber(value, src) : groundedText(value, src);
		if (!ok) flags.push(`${path}=${JSON.stringify(value)}`);
		return ok ? value : null;
	};
	const details = {
		paciente: {
			nombre: check("paciente.nombre", d.paciente.nombre, "text"),
			cedula: check("paciente.cedula", d.paciente.cedula, "number"),
			edad_anios: check("paciente.edad_anios", d.paciente.edad_anios, "number"),
			sexo: d.paciente.sexo,
		},
		signos_vitales: Object.fromEntries(
			Object.entries(d.signos_vitales).map(([k, v]) => [
				k,
				check(`signos_vitales.${k}`, v, k === "presion_arterial" ? "number" : "number"),
			]),
		),
		diagnosticos: d.diagnosticos.filter((x) => check("diagnostico", x.descripcion, "text") !== null),
		tratamiento: d.tratamiento.map((t) => ({
			medicamento: check("medicamento", t.medicamento, "text"),
			dosis: check("dosis", t.dosis, "number"),
			via: t.via,
			frecuencia: t.frecuencia,
			duracion: t.duracion,
		})),
	};
	log({
		kind: "two-stage",
		source,
		sentences: sentences.length,
		stage1: { ms: stage1.ms, gen: stage1.value.stats?.generatedTokens, ttft: stage1.value.stats?.timeToFirstToken, tps: stage1.value.stats?.tokensPerSecond },
		stage2: { ms: stage2.ms, gen: stage2.value.stats?.generatedTokens, ttft: stage2.value.stats?.timeToFirstToken, tps: stage2.value.stats?.tokensPerSecond },
		sections: Object.fromEntries(Object.entries(bySection).map(([k, v]) => [k, v.join(" ")])),
		details,
		dropped: flags,
	});
}

await sdk.unloadModel({ modelId: load.value, clearStorage: false });
process.exit(0);
