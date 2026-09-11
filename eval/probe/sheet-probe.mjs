import { appendFileSync } from "node:fs";
import * as sdk from "@qvac/sdk";
const HERE = import.meta.dirname;
const OUT = `${HERE}/sheet-results.jsonl`;
const log = (r) => { appendFileSync(OUT, `${JSON.stringify(r)}\n`); console.log(JSON.stringify(r).slice(0, 1200)); };

const text = (max) => ({ type: "string", maxLength: max });
const NEW_SCHEMA = {
	type: "object",
	properties: {
		titulo: text(40),
		columnas: { type: "array", minItems: 2, maxItems: 8, items: text(24) },
		filas: { type: "array", maxItems: 20, items: { type: "array", minItems: 2, maxItems: 8, items: text(60) } },
	},
	required: ["titulo", "columnas", "filas"],
};
const updateSchema = (n) => ({
	type: "object",
	properties: { filas: { type: "array", maxItems: 20, items: { type: "array", minItems: n, maxItems: n, items: text(60) } } },
	required: ["filas"],
});
const COMMON =
	"Conviertes lo que alguien dice en una hoja de cálculo. Una fila por cada cosa o evento mencionado. Usa solo lo que se dijo; deja \"\" cuando un dato no se mencionó; nunca inventes números. " +
	"Fechas como AAAA-MM-DD cuando se nombra un día; hoy es 2026-09-10. Sin abreviaturas. Responde en español.";
const HARNESS = {
	finanzas: {
		model: "QWEN3_1_7B_INST_Q4",
		system: `${COMMON} Es sobre dinero: elige columnas como Fecha, Concepto, Tipo (Ingreso, Gasto o Ahorro), Categoría, Monto, Método. Monto como número sin símbolo.\nEjemplo. Texto: "Compré el súper por 80 con tarjeta y le pasé 20 a mi cuenta de ahorros." Hoja: {"titulo":"Movimientos","columnas":["Fecha","Concepto","Tipo","Categoría","Monto","Método"],"filas":[["2026-09-10","Supermercado","Gasto","Alimentación","80","Tarjeta"],["2026-09-10","Cuenta de ahorros","Ahorro","Ahorro","20",""]]}`,
		texts: [
			"Hoy pagué 45 dólares de luz con Yappy y 12 de almuerzo en efectivo. Me cayó la quincena, 850.",
			"Esta semana: lunes gasolina 30, martes farmacia 18.50 con tarjeta, jueves recibí 120 por un trabajo extra y ahorré 50.",
		],
		update: { columns: ["Fecha", "Concepto", "Tipo", "Categoría", "Monto", "Método"], sample: [["2026-09-10", "Luz", "Gasto", "Servicios", "45", "Yappy"]], text: "Ayer pagué el internet, 35 dólares, y Netflix, 15.99." },
	},
	salud: {
		model: "HEALTHCARE_1_7B_MEDICAL_Q4_K_M",
		system: `${COMMON} Es sobre salud: equipos médicos, consultas, pacientes, medicamentos con dosis, vía y frecuencia, signos vitales. Nunca agregues diagnósticos, dosis ni valores que no se dijeron.\nEjemplo. Texto: "En la Clínica Norte vi un ecógrafo Siemens de unos cinco años." Hoja: {"titulo":"Equipos Clínica Norte","columnas":["Cliente","Modalidad","Cantidad","Marca","Antigüedad","Estado"],"filas":[["Clínica Norte","Ultrasonido","1","Siemens","5","Estimado"]]}`,
		texts: [
			"Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores Philips y un tomógrafo. Uno de los resonadores parece de unos ocho años.",
			"Paciente María González, 42 años. Fiebre y tos desde hace tres días, alérgica a la penicilina. Temperatura 38,5, saturación 96. Indico azitromicina 500 miligramos por vía oral una vez al día por tres días.",
		],
		update: { columns: ["Cliente", "Modalidad", "Cantidad", "Marca", "Antigüedad", "Estado"], sample: [["Hospital DemoCare Pacific", "Resonancia magnética", "2", "Philips", "8", "Estimado"]], text: "En la Clínica San Rafael de Medellín tienen un ecógrafo GE Logiq nuevo y me dijeron que el tomógrafo Siemens es de 2015." },
	},
};
const drain = async (run) => { for await (const _ of run.events); const f = await run.final; return { text: f.contentText, stats: f.stats }; };
const brief = (s) => ({ ttft: Math.round(s?.timeToFirstToken ?? 0), tps: Number((s?.tokensPerSecond ?? 0).toFixed(1)), prompt: s?.promptTokens, gen: s?.generatedTokens });

for (const mode of (process.env.MODES ?? "finanzas,salud").split(",")) {
	const h = HARNESS[mode];
	const t0 = performance.now();
	const modelId = await sdk.loadModel({ modelSrc: sdk[h.model], modelType: "llm", modelConfig: { ctx_size: 2048 } });
	log({ kind: "load", mode, model: h.model, ms: Math.round(performance.now() - t0) });
	for (const text of h.texts) {
		const start = performance.now();
		const r = await drain(sdk.completion({ modelId, history: [{ role: "system", content: h.system }, { role: "user", content: `Texto: "${text}"` }], stream: true, generationParams: { temp: 0, predict: 500 }, responseFormat: { type: "json_schema", json_schema: { name: "hoja", schema: NEW_SCHEMA } } }));
		log({ kind: "new", mode, text, ms: Math.round(performance.now() - start), ...brief(r.stats), out: r.text });
	}
	const u = h.update;
	const start = performance.now();
	const r = await drain(sdk.completion({ modelId, history: [{ role: "system", content: `${h.system}\nAhora agregas filas a una hoja existente. Columnas: ${u.columns.join(" | ")}. Filas de ejemplo ya en la hoja: ${JSON.stringify(u.sample)}. Devuelve solo las filas nuevas, cada una con exactamente ${u.columns.length} celdas en ese orden.` }, { role: "user", content: `Texto: "${u.text}"` }], stream: true, generationParams: { temp: 0, predict: 400 }, responseFormat: { type: "json_schema", json_schema: { name: "filas", schema: updateSchema(u.columns.length) } } }));
	log({ kind: "update", mode, text: u.text, ms: Math.round(performance.now() - start), ...brief(r.stats), out: r.text });
	await sdk.unloadModel({ modelId, clearStorage: false });
}
process.exit(0);
