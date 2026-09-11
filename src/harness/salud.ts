import { MEDPSY_EXTRACTOR } from "../models";
import type { Harness } from "./index";

// Prompt text and the worked example for Salud live here and nowhere else.
export const SALUD_RULES =
	"Es sobre salud: equipos médicos, consultas, medicamentos con dosis, vía y frecuencia, signos vitales. Nunca agregues diagnósticos, dosis ni valores que no se dijeron.\n" +
	'Ejemplo. Texto: "En la Clínica Norte vi un ecógrafo Siemens de unos cinco años y un mamógrafo." Elementos: ["un ecógrafo Siemens de unos cinco años","un mamógrafo"] Hoja: {"titulo":"Equipos Clínica Norte","columnas":["Cliente","Modalidad","Cantidad","Marca","Antigüedad","Estado"],"filas":[["Clínica Norte","Ultrasonido","1","Siemens","5","Estimado"],["Clínica Norte","Mamografía","1","","","Confirmado"]]}';

export const salud: Harness = {
	id: "salud",
	extractor: MEDPSY_EXTRACTOR,
	label: "Salud",
	subtitle: "Datos clínicos y equipos, en hojas",
	rules: SALUD_RULES,
	demo: {
		sentence:
			"Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores Philips y un tomógrafo. Uno de los resonadores parece de unos ocho años.",
		listText: JSON.stringify({
			elementos: [
				"dos resonadores Philips, uno de unos ocho años",
				"un tomógrafo",
			],
		}),
		newRowsText: JSON.stringify({
			titulo: "Equipos Hospital DemoCare Pacific",
			columnas: [
				"Cliente",
				"Modalidad",
				"Cantidad",
				"Marca",
				"Antigüedad",
				"Estado",
			],
			filas: [
				[
					"Hospital DemoCare Pacific",
					"Resonancia magnética",
					"2",
					"Philips",
					"8",
					"Estimado",
				],
				["Hospital DemoCare Pacific", "Tomografía", "1", "", "", "Confirmado"],
			],
		}),
		updateSentence:
			"En la Clínica San Rafael de Medellín tienen un ecógrafo GE nuevo.",
		updateListText: JSON.stringify({
			elementos: ["un ecógrafo GE nuevo en la Clínica San Rafael de Medellín"],
		}),
		updateRow: {
			Cliente: "Clínica San Rafael de Medellín",
			Modalidad: "Ultrasonido",
			Cantidad: 1,
			Marca: "GE",
			Antigüedad: "",
			Estado: "Nuevo",
			Paciente: "",
		},
	},
};
