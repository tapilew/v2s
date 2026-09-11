import type { Engine } from "./engine";
import type {
	ExtractedUnit,
	Extraction,
	Modality,
	Visit,
} from "./installed-base";

type Capture = { said: string; extraction: Extraction };

type Gap = {
	word: string;
	answer: string;
	fill: (extraction: Extraction) => Extraction;
};

const DAY_MS = 86_400_000;

const unit = (
	modalidad: Modality,
	fields: Partial<ExtractedUnit> = {},
): ExtractedUnit => ({
	modalidad,
	cantidad: 1,
	marca: null,
	modelo: null,
	antiguedad_anios: null,
	estado: "Confirmado",
	...fields,
});

const fillFirst = (
	extraction: Extraction,
	missing: (unit: ExtractedUnit) => boolean,
	fields: Partial<ExtractedUnit>,
): Extraction => {
	const index = extraction.equipos.findIndex(missing);
	if (index < 0) return extraction;
	return {
		...extraction,
		equipos: extraction.equipos.map((found, at) =>
			at === index ? { ...found, ...fields } : found,
		),
	};
};

export const EXAMPLE: Capture = {
	said: "Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores Philips y un tomógrafo. Uno de los resonadores parece de unos ocho años.",
	extraction: {
		cliente: "Hospital DemoCare Pacific",
		ciudad: null,
		pais: "Panamá",
		equipos: [
			unit("Resonancia magnética", {
				marca: "Philips",
				antiguedad_anios: 8,
				estado: "Estimado",
			}),
			unit("Resonancia magnética", { marca: "Philips" }),
			unit("Tomografía"),
		],
	},
};

const CAPTURES: readonly Capture[] = [
	EXAMPLE,
	{
		said: "Acabo de salir de la Clínica Santa Lucía, en David. Me dijeron que tienen un mamógrafo Hologic de 2018.",
		extraction: {
			cliente: "Clínica Santa Lucía",
			ciudad: "David",
			pais: null,
			equipos: [
				unit("Mamografía", {
					marca: "Hologic",
					antiguedad_anios: 8,
					estado: "Reportado",
				}),
			],
		},
	},
	{
		said: "Volví al Hospital Regional del Valle en Cali. El equipo de rayos X es Carestream y tiene unos diez años.",
		extraction: {
			cliente: "Hospital Regional del Valle",
			ciudad: "Cali",
			pais: null,
			equipos: [
				unit("Rayos X", {
					marca: "Carestream",
					antiguedad_anios: 10,
					estado: "Estimado",
				}),
			],
		},
	},
];

// Checked in this order because a city question can name a hospital.
const GAPS: readonly Gap[] = [
	{
		word: "marca",
		answer: "Es Siemens, me lo confirmó el técnico.",
		fill: (extraction) =>
			fillFirst(extraction, (found) => found.marca === null, {
				marca: "Siemens",
			}),
	},
	{
		word: "antigüedad",
		answer: "Tiene unos cinco años.",
		fill: (extraction) =>
			fillFirst(extraction, (found) => found.antiguedad_anios === null, {
				antiguedad_anios: 5,
			}),
	},
	{
		word: "ciudad",
		answer: "En Ciudad de Panamá.",
		fill: (extraction) => ({ ...extraction, ciudad: "Ciudad de Panamá" }),
	},
	{
		word: "hospital",
		answer: "Hospital DemoCare Pacific.",
		fill: (extraction) => ({
			...extraction,
			cliente: "Hospital DemoCare Pacific",
		}),
	},
];

const gapFor = (question: string) =>
	GAPS.find((gap) => question.includes(gap.word));

const demoExtraction = (said: string): Extraction => {
	const [base = "", ...answers] = said.split("\nPregunta: ");
	// Typed text falls back to the example, so the keyboard path also shows a follow-up question.
	const capture = CAPTURES.find((known) => known.said === base) ?? EXAMPLE;
	return answers.reduce((extraction, answer) => {
		const [question = ""] = answer.split("\nRespuesta: ");
		return gapFor(question)?.fill(extraction) ?? extraction;
	}, capture.extraction);
};

const wait = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

export const createDemoEngine = (): Engine => {
	let turn = 0;
	return {
		load: async () => {},
		loaded: () => [],
		unload: async () => {},
		async transcribe(_audioPath, question) {
			await wait(400);
			if (question) return gapFor(question)?.answer ?? "No estoy seguro.";
			const capture = CAPTURES[turn % CAPTURES.length];
			turn += 1;
			return capture.said;
		},
		async extract(said) {
			await wait(600);
			return demoExtraction(said);
		},
	};
};

export const demoVisits = (now: number): Visit[] => [
	{
		id: "demo-santa-lucia",
		at: now - 200 * DAY_MS,
		said: "En la Clínica Santa Lucía de David, Panamá, vi dos ecógrafos GE Logiq. Creo que tienen unos cuatro años.",
		extraction: {
			cliente: "Clínica Santa Lucía",
			ciudad: "David",
			pais: "Panamá",
			equipos: [
				unit("Ultrasonido", {
					cantidad: 2,
					marca: "GE",
					modelo: "Logiq",
					antiguedad_anios: 4,
					estado: "Estimado",
				}),
			],
		},
	},
	{
		id: "demo-valle",
		at: now - 40 * DAY_MS,
		said: "Hospital Regional del Valle, en Cali, Colombia. Vi un mamógrafo Siemens de hace cinco años y un equipo de rayos X, pero no pude ver la marca.",
		extraction: {
			cliente: "Hospital Regional del Valle",
			ciudad: "Cali",
			pais: "Colombia",
			equipos: [
				unit("Mamografía", { marca: "Siemens", antiguedad_anios: 5 }),
				unit("Rayos X"),
			],
		},
	},
	{
		id: "demo-democare",
		at: now - 3 * DAY_MS,
		said: "Visité el Hospital DemoCare Pacific en Ciudad de Panamá. Tienen un resonador Philips Ingenia de 2017 y el jefe de radiología me dijo que su tomógrafo es Siemens.",
		extraction: {
			cliente: "Hospital DemoCare Pacific",
			ciudad: "Ciudad de Panamá",
			pais: "Panamá",
			equipos: [
				unit("Resonancia magnética", {
					marca: "Philips",
					modelo: "Ingenia",
					antiguedad_anios: 9,
				}),
				unit("Tomografía", { marca: "Siemens", estado: "Reportado" }),
			],
		},
	},
];
