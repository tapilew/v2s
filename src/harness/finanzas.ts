import { QWEN3_EXTRACTOR } from "../models";
import type { Harness } from "./index";

// Prompt text and the worked example for Finanzas live here and nowhere else.
export const FINANZAS_RULES =
	"Es sobre dinero: columnas como Fecha, Concepto, Tipo (Ingreso, Gasto o Ahorro), Categoría, Monto, Método. Concepto en dos o tres palabras (Luz, Almuerzo, Quincena), nunca la frase completa ni el día. Monto como número sin símbolo.\n" +
	'Ejemplo. Texto: "Compré el súper por 80 con tarjeta y le pasé 20 a mi cuenta de ahorros." Elementos: ["Compré el súper por 80 con tarjeta","le pasé 20 a mi cuenta de ahorros"] Hoja: {"titulo":"Movimientos","columnas":["Fecha","Concepto","Tipo","Categoría","Monto","Método"],"filas":[["2026-09-10","Supermercado","Gasto","Alimentación","80","Tarjeta"],["2026-09-10","Cuenta de ahorros","Ahorro","Ahorro","20",""]]}';

export const finanzas: Harness = {
	id: "finanzas",
	extractor: QWEN3_EXTRACTOR,
	label: "Finanzas",
	subtitle: "Tu dinero, en hojas",
	rules: FINANZAS_RULES,
	demo: {
		sentence:
			"Hoy pagué 45 dólares de luz con Yappy y 12 de almuerzo en efectivo. Me cayó la quincena, 850.",
		listText: JSON.stringify({
			elementos: [
				"Hoy pagué 45 dólares de luz con Yappy",
				"12 de almuerzo en efectivo",
				"Me cayó la quincena, 850",
			],
		}),
		newRowsText: JSON.stringify({
			titulo: "Movimientos de septiembre",
			columnas: ["Fecha", "Concepto", "Tipo", "Monto", "Método"],
			filas: [
				["2026-09-10", "Luz", "Gasto", "45", "Yappy"],
				["2026-09-10", "Almuerzo", "Gasto", "12", "Efectivo"],
				["2026-09-10", "Quincena", "Ingreso", "850", ""],
			],
		}),
		updateSentence: "Ayer pagué el internet, 35 dólares, con tarjeta.",
		updateListText: JSON.stringify({
			elementos: ["Ayer pagué el internet, 35 dólares, con tarjeta"],
		}),
		updateRow: {
			Fecha: "2026-09-09",
			Concepto: "Internet",
			Tipo: "Gasto",
			Categoría: "Servicios",
			Monto: 35,
			Método: "Tarjeta",
		},
	},
};
