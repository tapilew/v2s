/// <reference types="bun-types" />
import { describe, expect, mock, test } from "bun:test";
import { blankNote } from "./clinical-note";

mock.module("expo-file-system", () => ({ File: class {}, Paths: {} }));

const note = { ...blankNote(), motivo_consulta: "Fiebre" };
const physician = { name: "Ana Castillo", license: "4521" };

describe("parseConsultations", () => {
	test("keeps good consultations, keeps the words when the note is malformed, drops the rest", async () => {
		const { parseConsultations } = await import("./store");
		const edit = {
			at: 5,
			path: "motivo_consulta",
			before: null,
			after: "Fiebre",
			afterSigning: false,
		};
		const text = JSON.stringify([
			{
				id: "a",
				at: 1,
				transcript: "fiebre",
				note,
				status: { kind: "signed", at: 9, physician },
				edits: [edit, { path: "sin fecha" }],
				unverified: ["paciente.cedula", 4],
			},
			{
				id: "b",
				at: 2,
				transcript: "pendiente",
				note: null,
				status: { kind: "draft" },
			},
			{
				id: "c",
				at: 3,
				transcript: "roto",
				note: "no es un objeto",
				status: { kind: "signed", at: 9, physician: { name: "" } },
				edits: "no es una lista",
			},
			{ id: "d", at: "ayer", transcript: "fecha mala", note: null },
			{ at: 4, transcript: "sin id", note: null },
			null,
			7,
		]);
		expect(parseConsultations(text)).toEqual({
			consultations: [
				{
					id: "a",
					at: 1,
					transcript: "fiebre",
					note,
					status: { kind: "signed", at: 9, physician },
					edits: [edit],
					unverified: ["paciente.cedula"],
				},
				{
					id: "b",
					at: 2,
					transcript: "pendiente",
					note: null,
					status: { kind: "draft" },
					edits: [],
					unverified: [],
				},
				{
					id: "c",
					at: 3,
					transcript: "roto",
					note: null,
					status: { kind: "draft" },
					edits: [],
					unverified: [],
				},
			],
			dropped: 4,
		});
	});

	test("rejects text that is not a list of consultations", async () => {
		const { parseConsultations } = await import("./store");
		expect(parseConsultations("{")).toBeNull();
		expect(parseConsultations('{"consultations": []}')).toBeNull();
		expect(parseConsultations("[]")).toEqual({ consultations: [], dropped: 0 });
	});
});

describe("physicianFrom", () => {
	test("needs both a name and a license", async () => {
		const { physicianFrom } = await import("./store");
		expect(physicianFrom({ name: " Ana Castillo ", license: "4521" })).toEqual(
			physician,
		);
		expect(physicianFrom({ name: "Ana Castillo", license: "  " })).toBeNull();
		expect(physicianFrom("Ana Castillo")).toBeNull();
	});
});
