/// <reference types="bun-types" />
import { describe, expect, mock, test } from "bun:test";

type Written = Map<string, string>;

const files: Written = new Map();
const moves: string[] = [];

class FakeFile {
	name: string;
	constructor(_dir: unknown, name: string) {
		this.name = name;
	}
	get exists() {
		return files.has(this.name);
	}
	create() {
		files.set(this.name, "");
	}
	delete() {
		files.delete(this.name);
	}
	write(text: string) {
		files.set(this.name, text);
	}
	textSync() {
		return files.get(this.name) ?? "";
	}
	moveSync(target: FakeFile) {
		files.set(target.name, files.get(this.name) ?? "");
		files.delete(this.name);
		moves.push(`${this.name} -> ${target.name}`);
	}
}

mock.module("expo-file-system", () => ({ File: FakeFile, Paths: {} }));

describe("openLibraryStore", () => {
	test("writes through a temp file and reads back", async () => {
		const { openLibraryStore } = await import("./store");
		const store = openLibraryStore("library-test");
		expect(store.load()).toEqual({ kind: "absent" });
		store.save({ sheets: [], pending: [] });
		expect(moves.at(-1)).toBe("library-test.json.tmp -> library-test.json");
		expect(store.load()).toEqual({
			kind: "ok",
			library: { sheets: [], pending: [] },
		});
	});

	test("quarantines a file it cannot parse and removes a stale temp file", async () => {
		const { openLibraryStore } = await import("./store");
		files.set("library-bad.json", "{ not json");
		files.set("library-bad.json.tmp", "half written");
		const store = openLibraryStore("library-bad");
		expect(store.load()).toEqual({ kind: "quarantined" });
		expect(files.has("library-bad.json")).toBe(false);
		expect(files.has("library-bad.json.tmp")).toBe(false);
		expect(
			[...files.keys()].some((name) => name.startsWith("library-bad.corrupt-")),
		).toBe(true);
	});

	test("keeps a salvaged copy when it drops entries", async () => {
		const { openLibraryStore } = await import("./store");
		files.set(
			"library-mixed.json",
			JSON.stringify({ sheets: [null], pending: [] }),
		);
		const read = openLibraryStore("library-mixed").load();
		expect(read.kind).toBe("ok");
		expect(
			[...files.keys()].some((name) =>
				name.startsWith("library-mixed.salvaged-"),
			),
		).toBe(true);
	});
});
