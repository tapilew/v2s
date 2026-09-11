import { appendFileSync } from "node:fs";
import * as sdk from "@qvac/sdk";
const HERE = import.meta.dirname;
const OUT = `${HERE}/sheet-results-v3.jsonl`;
const log = (r) => { appendFileSync(OUT, `${JSON.stringify(r)}\n`); console.log(JSON.stringify(r).slice(0, 1400)); };
const text = (max) => ({ type: "string", maxLength: max });
const LIST_SCHEMA = { type: "object", properties: { elementos: { type: "array", minItems: 1, maxItems: 20, items: text(90) } }, required: ["elementos"] };
const newSchema = (n) => ({ type: "object", properties: { titulo: text(40), columnas: { type: "array", minItems: 2, maxItems: 8, items: text(24) }, filas: { type: "array", minItems: n, maxItems: n, items: { type: "array", minItems: 2, maxItems: 8, items: text(60) } } }, required: ["titulo", "columnas", "filas"] });
const updateSchema = (n, cols) => ({ type: "object", properties: { filas: { type: "array", minItems: n, maxItems: n, items: { type: "array", minItems: cols, maxItems: cols, items: text(60) } } }, required: ["filas"] });
const LIST_SYSTEM = "Lista cada cosa registrable que menciona el texto, una por elemento, copiando las palabras del texto. Separa cada movimiento de dinero, cada equipo, cada medicamento y cada medición. \"dos resonadores y un tomógrafo\" son dos elementos. Un saludo o el nombre del lugar no es un elemento.";
const COMMON = "Conviertes elementos ya listados en filas de una hoja de cálculo: exactamente una fila por elemento, en orden. Usa solo lo que dice el texto; deja \"\" cuando falta un dato; nunca inventes números. Fechas AAAA-MM-DD solo si el texto nombra el día; hoy es 2026-09-10. Sin abreviaturas. Español.";
const H = {
	finanzas: { model: "QWEN3_1_7B_INST_Q4", system: `${COMMON} Es sobre dinero: columnas como Fecha, Concepto, Tipo (Ingreso, Gasto o Ahorro), Categoría, Monto, Método. Concepto en dos o tres palabras (Luz, Almuerzo, Quincena), nunca la frase completa ni el día. Monto como número sin símbolo.\nEjemplo. Texto: "Compré el súper por 80 con tarjeta y le pasé 20 a mi cuenta de ahorros." Elementos: ["Compré el súper por 80 con tarjeta","le pasé 20 a mi cuenta de ahorros"] Hoja: {"titulo":"Movimientos","columnas":["Fecha","Concepto","Tipo","Categoría","Monto","Método"],"filas":[["2026-09-10","Supermercado","Gasto","Alimentación","80","Tarjeta"],["2026-09-10","Cuenta de ahorros","Ahorro","Ahorro","20",""]]}`,
		texts: ["Hoy pagué 45 dólares de luz con Yappy y 12 de almuerzo en efectivo. Me cayó la quincena, 850.", "Esta semana: lunes gasolina 30, martes farmacia 18.50 con tarjeta, jueves recibí 120 por un trabajo extra y ahorré 50."],
		update: { columns: ["Fecha", "Concepto", "Tipo", "Categoría", "Monto", "Método"], sample: [["2026-09-10", "Luz", "Gasto", "Servicios", "45", "Yappy"]], text: "Ayer pagué el internet, 35 dólares, y Netflix, 15.99." } },
	salud: { model: "HEALTHCARE_1_7B_MEDICAL_Q4_K_M", system: `${COMMON} Es sobre salud: equipos médicos, consultas, medicamentos con dosis, vía y frecuencia, signos vitales. Nunca agregues diagnósticos, dosis ni valores que no se dijeron.\nEjemplo. Texto: "En la Clínica Norte vi un ecógrafo Siemens de unos cinco años y un mamógrafo." Elementos: ["un ecógrafo Siemens de unos cinco años","un mamógrafo"] Hoja: {"titulo":"Equipos Clínica Norte","columnas":["Cliente","Modalidad","Cantidad","Marca","Antigüedad","Estado"],"filas":[["Clínica Norte","Ultrasonido","1","Siemens","5","Estimado"],["Clínica Norte","Mamografía","1","","","Confirmado"]]}`,
		texts: ["Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores Philips y un tomógrafo. Uno de los resonadores parece de unos ocho años.", "Paciente María González, 42 años. Fiebre y tos desde hace tres días, alérgica a la penicilina. Temperatura 38,5, saturación 96. Indico azitromicina 500 miligramos por vía oral una vez al día por tres días."],
		update: { columns: ["Cliente", "Modalidad", "Cantidad", "Marca", "Antigüedad", "Estado"], sample: [["Hospital DemoCare Pacific", "Resonancia magnética", "2", "Philips", "8", "Estimado"]], text: "En la Clínica San Rafael de Medellín tienen un ecógrafo GE Logiq nuevo y me dijeron que el tomógrafo Siemens es de 2015." } },
};
const drain = async (run) => { for await (const _ of run.events); const f = await run.final; return { text: f.contentText, stats: f.stats }; };
const brief = (s) => ({ ttft: Math.round(s?.timeToFirstToken ?? 0), tps: Number((s?.tokensPerSecond ?? 0).toFixed(1)), gen: s?.generatedTokens });
const call = (modelId, system, user, schema, predict) => drain(sdk.completion({ modelId, history: [{ role: "system", content: system }, { role: "user", content: user }], stream: true, generationParams: { temp: 0, predict }, responseFormat: { type: "json_schema", json_schema: { name: "x", schema } } }));
for (const mode of Object.keys(H)) {
	const h = H[mode];
	const modelId = await sdk.loadModel({ modelSrc: sdk[h.model], modelType: "llm", modelConfig: { ctx_size: 2048 } });
	const run = async (kind, txt, extra, schemaFor) => {
		const t0 = performance.now();
		const l = await call(modelId, LIST_SYSTEM, `Texto: "${txt}"`, LIST_SCHEMA, 200);
		const items = JSON.parse(l.text).elementos;
		const t1 = performance.now();
		const r = await call(modelId, `${h.system}${extra}`, `Texto: "${txt}"\nElementos: ${JSON.stringify(items)}`, schemaFor(items.length), 500);
		log({ kind, mode, text: txt, listMs: Math.round(t1 - t0), list: brief(l.stats), rowsMs: Math.round(performance.now() - t1), rows: brief(r.stats), items, out: r.text });
	};
	for (const t of h.texts) await run("new", t, "", (n) => newSchema(n));
	const u = h.update;
	await run("update", u.text, `\nAhora agregas filas a una hoja existente. Columnas: ${u.columns.join(" | ")}. Filas ya en la hoja: ${JSON.stringify(u.sample)}. Cada fila nueva con exactamente ${u.columns.length} celdas en ese orden.`, (n) => updateSchema(n, u.columns.length));
	await sdk.unloadModel({ modelId, clearStorage: false });
}
process.exit(0);
