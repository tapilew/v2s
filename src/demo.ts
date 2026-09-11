import type { Engine } from "./engine";
import { ASR_MODEL } from "./models";
import { MODES } from "./modes";

const wait = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

export const createDemoEngine = (): Engine => {
	const warmed = new Set<string>();
	return {
		async prepare(mode, onProgress) {
			for (const spec of [ASR_MODEL, MODES[mode].extractor]) {
				if (warmed.has(spec.sdkConstant)) continue;
				for (const percent of [0, 30, 65, 100]) {
					onProgress(spec, percent);
					await wait(180);
				}
				warmed.add(spec.sdkConstant);
			}
		},
		loaded: () => [],
		release: async () => {},
		async transcribe(_, mode) {
			await wait(700);
			return MODES[mode].demo.example;
		},
		async extract(mode, text) {
			await wait(800);
			return MODES[mode].assemble(text, MODES[mode].demo.modelText, new Date());
		},
	};
};
