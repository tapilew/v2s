import { appendFileSync } from "node:fs";
import * as sdk from "@qvac/sdk";

const HERE = import.meta.dirname;
const OUT = `${HERE}/results.jsonl`;
const log = (row) => {
	appendFileSync(OUT, `${JSON.stringify(row)}\n`);
	console.log(JSON.stringify(row));
};

const MODALITIES = [
	"Resonancia magnética",
	"Tomografía",
	"Ultrasonido",
	"Rayos X",
	"Mamografía",
	"Angiografía",
	"Medicina nuclear",
	"Otro",
];
const nullable = (type) => ({ type: [type, "null"] });
const SCHEMA = {
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
					modalidad: { type: "string", enum: MODALITIES },
					cantidad: nullable("integer"),
					marca: nullable("string"),
					modelo: nullable("string"),
					antiguedad_anios: nullable("number"),
					certeza: {
						type: "string",
						enum: ["visto", "reportado", "estimado", "desconocido"],
					},
				},
				required: [
					"modalidad",
					"cantidad",
					"marca",
					"modelo",
					"antiguedad_anios",
					"certeza",
				],
			},
		},
	},
	required: ["cliente", "ciudad", "pais", "equipos"],
};

const SYSTEM =
	"Extraes datos de equipos médicos instalados a partir de lo que dice un colaborador de campo después de visitar un hospital. " +
	"Usa null cuando un dato no se mencione. No inventes marcas, modelos ni años. " +
	'certeza: "visto" si lo vio, "reportado" si alguien se lo dijo, "estimado" si lo aproxima (parece, unos, más o menos), "desconocido" si no se sabe.';

const UTTERANCES = [
	"Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores Philips y un tomógrafo. Uno de los resonadores parece de unos ocho años.",
	"En la Clínica San Rafael de Medellín, Colombia, tienen un ecógrafo GE Logiq E10 nuevo y el jefe de radiología me dijo que el tomógrafo Siemens es de 2015.",
	"Pasé por el Centro Médico Paitilla. Tienen un Aquilion y un Ingenia, los dos se ven viejos.",
	"Hospital Santo Tomás, ciudad de Panamá. Hay tres equipos de rayos X portátiles, no vi la marca.",
];

const time = async (fn) => {
	const t0 = performance.now();
	const value = await fn();
	return { value, ms: Math.round(performance.now() - t0) };
};

const drain = async (run) => {
	let text = "";
	for await (const event of run.events)
		if (event.type === "contentDelta") text += event.text;
	const final = await run.final;
	return { text: final.contentText ?? text, stats: final.stats };
};

const which = process.argv[2] ?? "all";
const TEXT_MODELS = {
	llama1b: { src: sdk.LLAMA_3_2_1B_INST_Q4_0, name: "LLAMA_3_2_1B_INST_Q4_0" },
	medpsy17: {
		src: sdk.HEALTHCARE_1_7B_MEDICAL_Q4_K_M,
		name: "HEALTHCARE_1_7B_MEDICAL_Q4_K_M",
	},
};

const FORMATS = (process.env.FORMATS ?? "schema").split(",");
const PICK = (process.env.UTTS ?? "0,1,2,3").split(",").map(Number);
const SYSTEM_FREE = `${SYSTEM} Responde solo con un objeto JSON con las claves cliente, ciudad, pais y equipos (arreglo de objetos con modalidad, cantidad, marca, modelo, antiguedad_anios, certeza). Año actual: 2026.`;

for (const [key, model] of Object.entries(TEXT_MODELS)) {
	if (which !== "all" && which !== key) continue;
	const load = await time(() =>
		sdk.loadModel({
			modelSrc: model.src,
			modelType: "llm",
			modelConfig: { ctx_size: 2048 },
		}),
	);
	log({ kind: "load", model: model.name, ms: load.ms });
	for (const format of FORMATS)
		for (const said of PICK.map((i) => UTTERANCES[i])) {
			const run = await time(() =>
				drain(
					sdk.completion({
						modelId: load.value,
						history: [
							{
								role: "system",
								content: format === "schema" ? SYSTEM : SYSTEM_FREE,
							},
							{ role: "user", content: said },
						],
						stream: true,
						generationParams: { temp: 0, predict: 400 },
						...(format === "schema" && {
							responseFormat: {
								type: "json_schema",
								json_schema: { name: "observacion", schema: SCHEMA },
							},
						}),
					}),
				),
			);
			log({
				kind: "extract",
				model: model.name,
				format,
				said,
				ms: run.ms,
				stats: run.value.stats,
				out: run.value.text,
			});
		}
	await sdk.unloadModel({ modelId: load.value, clearStorage: false });
}

if (which === "all" || which === "vision") {
	const load = await time(() =>
		sdk.loadModel({
			modelSrc: sdk.VISIONPSY_NANO_460M_MULTIMODAL_Q4_K_M,
			modelType: "llm",
			modelConfig: {
				ctx_size: 2048,
				projectionModelSrc: sdk.MMPROJ_VISIONPSY_NANO_460M_MULTIMODAL_Q8_0,
			},
		}),
	);
	log({
		kind: "load",
		model: "VISIONPSY_NANO_460M_MULTIMODAL_Q4_K_M",
		ms: load.ms,
	});
	for (const plate of ["plate-philips-mr.png", "plate-siemens-ct.png"]) {
		for (const constrained of [false, true]) {
			const run = await time(() =>
				drain(
					sdk.completion({
						modelId: load.value,
						history: [
							{
								role: "user",
								content: constrained
									? "Read this medical equipment nameplate. Return brand, model, modality and manufacture date as JSON."
									: "Read all the text on this medical equipment nameplate.",
								attachments: [{ path: `${HERE}/${plate}` }],
							},
						],
						stream: true,
						generationParams: { temp: 0, predict: 200 },
						...(constrained && {
							responseFormat: {
								type: "json_schema",
								json_schema: {
									name: "placa",
									schema: {
										type: "object",
										properties: {
											marca: nullable("string"),
											modelo: nullable("string"),
											modalidad: nullable("string"),
											fecha_fabricacion: nullable("string"),
										},
										required: [
											"marca",
											"modelo",
											"modalidad",
											"fecha_fabricacion",
										],
									},
								},
							},
						}),
					}),
				),
			);
			log({
				kind: "vision",
				plate,
				constrained,
				ms: run.ms,
				stats: run.value.stats,
				out: run.value.text,
			});
		}
	}
	await sdk.unloadModel({ modelId: load.value, clearStorage: false });
}

process.exit(0);
