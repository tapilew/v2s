import { readFileSync } from "node:fs";

const HERE = import.meta.dirname;

const splitSentences = (text) =>
	text
		.replace(/\s+/g, " ")
		.split(/(?<=[.!?])\s+/)
		.map((s) => s.trim())
		.filter((s) => /[\p{L}\p{N}]/u.test(s));

const RULES = [
	["A", /diagn[oó]stic|impresi[oó]n diagn|compatible con/i],
	[
		"P",
		/\b(indico|receto|inicio|iniciamos|solicito|pido|refiero|derivo|acuda|regrese|vuelva|control en|continuar|suspender|aumentar)\b|miligramos|\bmg\b|cada \d+ horas|por v[ií]a|al d[ií]a|reposo|signos de alarma|terapia f[ií]sica/i,
	],
	[
		"O",
		/presi[oó]n|temperatura|saturaci[oó]n|frecuencia (card|resp)|\bpulso\b|\bpeso\b|\btalla\b|\bkilos\b|\bescucho\b|examen f[ií]sico|a la (palpaci|auscult|explorac)|se observa|abdomen|ruidos|crepitant|sibilan|faringe|am[ií]gdala|t[ií]mpano|mucosas|hidratad|resultado|hemoglobina|glucosa en/i,
	],
	[
		"I",
		/\bc[eé]dula\b|\bpaciente [A-ZÁÉÍÓÚ][a-záéíóú]+ [A-ZÁÉÍÓÚ]|\b\d+ años\b|\b(un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|[a-z]+inta y [a-z]+|veinti[a-z]+|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa) años\b/i,
	],
	[
		"S",
		/\b(tengo|tiene|me duele|le duele|refiere|siente|siento|desde hace|desde ayer|al[eé]rgic|alergia|antecedente|toma|tomo|padece|sufre)\b|dolor|fiebre|\btos\b|v[oó]mito|diarrea|ardor|picaz[oó]n|mareo|cansancio|penicilina|sin alergias/i,
	],
];

const test = (letter, sentence) => RULES.find(([l]) => l === letter)[1].test(sentence);
const HISTORY = /\b(toma|tomo|se toma|est[aá] tomando|en tratamiento con|antecedentes?|al[eé]rgic[oa]|alergias?|niveles en casa|viene a control|viene por|consulta por|acude por|control de)\b/i;
const FOLLOW_UP = /\b(cita|pr[oó]xima|regres[ae]r?|vuelva|si empeora|si no (tolera|mejora)|debe)\b/i;
const QUESTION_ABOUT = /\?$/;

const route = (sentences) =>
	sentences.map((sentence, i) => {
		const letters = new Set();
		if (test("I", sentence)) letters.add("I");
		if (test("A", sentence)) letters.add("A");
		else if (/\bal examen\b|examen f[ií]sico|a la (palpaci|auscult|explorac)/i.test(sentence)) letters.add("O");
		else if (HISTORY.test(sentence) || /\b(me ha dado|me duele|tengo|soy|uso|siento)\b/i.test(sentence)) letters.add("S");
		else if (/\b(amerita|no requiere)\b/i.test(sentence)) letters.add("P");
		else if (test("P", sentence) || FOLLOW_UP.test(sentence)) letters.add("P");
		else if (test("O", sentence)) letters.add("O");
		else if (test("S", sentence)) letters.add("S");
		const previous = sentences[i - 1] ?? "";
		if (!letters.size && QUESTION_ABOUT.test(previous) && !QUESTION_ABOUT.test(sentence)) letters.add("S");
		if (QUESTION_ABOUT.test(sentence) && [...letters].every((l) => l === "S")) letters.clear();
		return letters.size ? [...letters].join("+") : "X";
	});

const rows = readFileSync(`${HERE}/asr-results.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const cases = JSON.parse(readFileSync("/home/tapi/repos/orgs/tapilew/v2s/eval/consultations.json", "utf8"));
const INPUTS = [
	["parakeet", rows.find((r) => r.model === "PARAKEET_TDT_0_6B_V3_Q4_0").text],
	[
		"dictado",
		"Paciente Carlos Pérez, cédula 8-765-432, 58 años. Control de hipertensión arterial. Refiere cefalea occipital leve por las mañanas desde hace una semana. Antecedente de diabetes tipo 2 en tratamiento con metformina 850 mg dos veces al día. Presión arterial 150 sobre 95, frecuencia cardíaca 78, peso 86 kilos. Examen físico sin hallazgos relevantes, ruidos cardíacos rítmicos. Diagnóstico hipertensión arterial no controlada. Inicio losartán 50 mg por vía oral una vez al día. Solicito creatinina y perfil lipídico. Control en un mes, reducir la sal y caminar treinta minutos diarios.",
	],
	...cases.slice(1).map((c) => [c.id, c.transcript]),
];

for (const [source, transcript] of INPUTS) {
	const sentences = splitSentences(transcript);
	const labels = route(sentences);
	console.log(`\n== ${source}`);
	sentences.forEach((s, i) => console.log(`${labels[i]} | ${s}`));
}
