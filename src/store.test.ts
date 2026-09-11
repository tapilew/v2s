/// <reference types="bun-types" />
import { describe, expect, mock, test } from "bun:test";

mock.module("expo-file-system", () => ({ File: class {}, Paths: {} }));

describe("parseRecords", () => {
	test("keeps good records, keeps the words of a pending one, drops the rest", async () => {
		const { parseRecords } = await import("./store");
		const movimientos = [{ concepto: "Luz", monto: 45 }];
		const text = JSON.stringify([
			{
				id: "a",
				at: 1,
				source: "Pagué 45 de luz",
				extraction: movimientos,
				unverified: ["0.monto", 4],
			},
			{ id: "b", at: 2, source: "pendiente" },
			{ id: "c", at: 3, source: "sin lista", unverified: "0.monto" },
			{ id: "d", at: "ayer", source: "fecha mala" },
			{ id: "e", at: Number.NaN, source: "fecha mala" },
			{ at: 4, source: "sin id" },
			{ id: "f", at: 5 },
			null,
			7,
		]);
		expect(parseRecords(text)).toEqual({
			records: [
				{
					id: "a",
					at: 1,
					source: "Pagué 45 de luz",
					extraction: movimientos,
					unverified: ["0.monto"],
				},
				{
					id: "b",
					at: 2,
					source: "pendiente",
					extraction: null,
					unverified: [],
				},
				{
					id: "c",
					at: 3,
					source: "sin lista",
					extraction: null,
					unverified: [],
				},
			],
			dropped: 6,
		});
	});

	test("rejects text that is not a list of records", async () => {
		const { parseRecords } = await import("./store");
		expect(parseRecords("{")).toBeNull();
		expect(parseRecords('{"records": []}')).toBeNull();
		expect(parseRecords("[]")).toEqual({ records: [], dropped: 0 });
	});
});
