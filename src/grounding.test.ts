/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
	groundedNumber,
	groundedText,
	normalizeNumbers,
	numbersIn,
} from "./grounding";

describe("normalizeNumbers", () => {
	test("joins the decimal Parakeet splits apart", () => {
		expect(normalizeNumbers("un resonador de 30 y 8,5 kilos")).toBe(
			"un resonador de 38,5 kilos",
		);
	});

	test("leaves two plain amounts alone", () => {
		expect(normalizeNumbers("gasté 20 y 5")).toBe("gasté 20 y 5");
		expect(normalizeNumbers("vi 90 y 6 equipos")).toBe("vi 90 y 6 equipos");
	});
});

describe("tokensOf", () => {
	test("never joins tens and units, so Finanzas keeps both rows", () => {
		expect(numbersIn("Gasté 20 y 5 en el bus.")).toEqual([20, 5]);
		expect(numbersIn("Pagué 30 y 8,5 de propina.")).toEqual([30, 8.5]);
	});
});

describe("numbersIn", () => {
	test("reads digits, decimal commas, thousands and spoken numbers", () => {
		expect(numbersIn("Compré útiles por 38.50 y el taxi fue 6.")).toEqual([
			38.5, 6,
		]);
		expect(numbersIn("temperatura 38,5 y renta de 1,200")).toEqual([
			38.5, 1200,
		]);
		expect(
			numbersIn(
				"Presión ciento veinte sobre ochenta, temperatura treinta y ocho coma cinco, saturación noventa y seis por ciento.",
			),
		).toEqual([120, 80, 38.5, 96]);
	});
});

describe("grounding", () => {
	const source =
		"Paciente Carlos Pérez, cédula 8-765-432, 58 años. Presión arterial 150 sobre 95.";

	test("a cédula must match digit for digit", () => {
		expect(groundedNumber("8-765-432", source)).toBe(true);
		expect(groundedNumber("8-765-431", source)).toBe(false);
	});

	test("a number must match a whole number token", () => {
		expect(groundedNumber(150, source)).toBe(true);
		expect(groundedNumber(15, source)).toBe(false);
		expect(groundedText("150/95", source)).toBe(true);
	});

	test("text needs most of its words in the source", () => {
		expect(groundedText("Carlos Pérez", source)).toBe(true);
		expect(groundedText("Carlos Rodríguez Pérez", source)).toBe(false);
	});
});
