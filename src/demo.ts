import {
	blankNote,
	type ClinicalNote,
	type Consultation,
	unverifiedPaths,
} from "./clinical-note";
import type { Engine } from "./engine";

const HOUR_MS = 3_600_000;

export const DEMO_TRANSCRIPT =
	"Paciente Carlos Méndez, de 45 años. Consulta por fiebre y tos con flema desde hace 3 días. Es alérgico a la penicilina. Presión 120 sobre 80, temperatura 38,5, saturación 96. Al examen hay crepitantes en la base derecha. Impresión de neumonía adquirida en la comunidad: inicio azitromicina 500 miligramos por vía oral una vez al día por 3 días, pido radiografía de tórax y le expliqué los signos de alarma para volver de inmediato.";

// antecedentes stays null so the Ley 68 checklist shows, and the second diagnosis quotes words the transcript never says.
const DEMO_NOTE: ClinicalNote = {
	...blankNote(),
	paciente: {
		nombre: "Carlos Méndez",
		cedula: null,
		edad: "45 años",
		sexo: "Masculino",
	},
	motivo_consulta: "Fiebre y tos con flema",
	enfermedad_actual: "Fiebre y tos con flema de 3 días de evolución.",
	alergias: "Penicilina",
	signos_vitales: {
		...blankNote().signos_vitales,
		presion_arterial: "120/80",
		temperatura: 38.5,
		saturacion_oxigeno: 96,
	},
	examen_fisico: "Crepitantes en la base pulmonar derecha.",
	diagnosticos: [
		{
			descripcion: "Neumonía adquirida en la comunidad",
			cie10_sugerido: "J18.9",
			evidencia: "neumonía adquirida en la comunidad",
		},
		{
			descripcion: "Deshidratación leve",
			cie10_sugerido: "E86",
			evidencia: "mucosas secas",
		},
	],
	tratamiento: [
		{
			medicamento: "Azitromicina",
			dosis: "500 miligramos",
			via: "oral",
			frecuencia: "una vez al día",
			duracion: "3 días",
			evidencia:
				"azitromicina 500 miligramos por vía oral una vez al día por 3 días",
		},
	],
	examenes_solicitados: "Radiografía de tórax",
	indicaciones: "Se explicaron los signos de alarma para volver de inmediato.",
};

const wait = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

export const createDemoEngine = (): Engine => ({
	load: async () => {},
	loaded: () => [],
	unload: async () => {},
	async transcribe() {
		await wait(400);
		return DEMO_TRANSCRIPT;
	},
	async draftNote(transcript) {
		await wait(800);
		return {
			note: DEMO_NOTE,
			unverified: unverifiedPaths(transcript, DEMO_NOTE),
		};
	},
});

const LOW_BACK_TRANSCRIPT =
	"José Pinzón, 51 años, cédula 4-712-1180. Dolor lumbar desde hace una semana después de cargar cajas, sin irradiación. Es hipertenso y toma losartán 50 miligramos al día; su padre tiene diabetes. Presión 130 sobre 85, frecuencia cardiaca 76. Dolor a la palpación de músculos paravertebrales lumbares, sin déficit neurológico. Lumbalgia mecánica: ibuprofeno 400 miligramos por vía oral cada 8 horas por 5 días, calor local, y que vuelva si aparece debilidad en las piernas.";

const LOW_BACK_NOTE: ClinicalNote = {
	...blankNote(),
	paciente: {
		nombre: "José Pinzón",
		cedula: "4-712-1180",
		edad: "51 años",
		sexo: "Masculino",
	},
	motivo_consulta: "Dolor lumbar",
	enfermedad_actual:
		"Dolor lumbar de una semana de evolución después de cargar cajas, sin irradiación.",
	antecedentes: "Hipertensión arterial. Padre con diabetes.",
	alergias: "Ninguna conocida",
	medicamentos_actuales: "Losartán 50 miligramos al día",
	signos_vitales: {
		...blankNote().signos_vitales,
		presion_arterial: "130/85",
		frecuencia_cardiaca: 76,
	},
	examen_fisico:
		"Dolor a la palpación de músculos paravertebrales lumbares, sin déficit neurológico.",
	diagnosticos: [
		{
			descripcion: "Lumbalgia mecánica",
			cie10_sugerido: "M54.5",
			evidencia: "lumbalgia mecánica",
		},
	],
	tratamiento: [
		{
			medicamento: "Ibuprofeno",
			dosis: "400 miligramos",
			via: "oral",
			frecuencia: "cada 8 horas",
			duracion: "5 días",
			evidencia:
				"ibuprofeno 400 miligramos por vía oral cada 8 horas por 5 días",
		},
	],
	indicaciones: "Calor local. Volver si aparece debilidad en las piernas.",
};

const DIABETES_TRANSCRIPT =
	"Rosa Villarreal, 62 años, viene a control de diabetes tipo 2. Se siente bien y toma metformina 850 miligramos dos veces al día. Su madre tuvo diabetes y ella es hipertensa. Presión 138 sobre 84, peso 71 kilos. Trae una glucosa en ayunas de 142. Sigue con metformina igual, pido hemoglobina glicosilada y le indiqué caminar 30 minutos al día.";

const DIABETES_NOTE: ClinicalNote = {
	...blankNote(),
	paciente: {
		nombre: "Rosa Villarreal",
		cedula: null,
		edad: "62 años",
		sexo: "Femenino",
	},
	motivo_consulta: "Control de diabetes tipo 2",
	enfermedad_actual: "Se siente bien.",
	antecedentes: "Hipertensión arterial. Madre con diabetes.",
	medicamentos_actuales: "Metformina 850 miligramos dos veces al día",
	signos_vitales: {
		...blankNote().signos_vitales,
		presion_arterial: "138/84",
		peso_kg: 71,
	},
	resultados: "Glucosa en ayunas de 142.",
	diagnosticos: [
		{
			descripcion: "Diabetes mellitus tipo 2",
			cie10_sugerido: "E11.9",
			evidencia: "control de diabetes tipo 2",
		},
	],
	tratamiento: [
		{
			medicamento: "Metformina",
			dosis: "850 miligramos",
			via: null,
			frecuencia: "dos veces al día",
			duracion: null,
			evidencia: "metformina 850 miligramos dos veces al día",
		},
	],
	examenes_solicitados: "Hemoglobina glicosilada",
	indicaciones: "Caminar 30 minutos al día.",
};

export const demoConsultations = (now: number): Consultation[] => {
	const yesterday = now - 24 * HOUR_MS;
	return [
		{
			id: "demo-lumbalgia",
			at: yesterday,
			transcript: LOW_BACK_TRANSCRIPT,
			note: LOW_BACK_NOTE,
			status: {
				kind: "signed",
				at: yesterday + 0.4 * HOUR_MS,
				physician: { name: "Ana Castillo", license: "4521" },
			},
			edits: [
				{
					at: yesterday + 0.3 * HOUR_MS,
					path: "tratamiento.0.frecuencia",
					before: "cada 6 horas",
					after: "cada 8 horas",
					afterSigning: false,
				},
			],
			unverified: [],
		},
		{
			id: "demo-diabetes",
			at: now - 2 * HOUR_MS,
			transcript: DIABETES_TRANSCRIPT,
			note: DIABETES_NOTE,
			status: { kind: "draft" },
			edits: [],
			unverified: unverifiedPaths(DIABETES_TRANSCRIPT, DIABETES_NOTE),
		},
	];
};
