import type { Engine } from "./engine";
import {
	assemble,
	demoListText,
	demoRowsText,
	HARNESS,
	parseList,
} from "./harness";
import { ASR_MODEL } from "./models";

const wait = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

// The emulator cannot run the models, so the demo engine answers with canned text after a short pause.
export const createDemoEngine = (): Engine => {
	const warmed = new Set<string>();
	return {
		async prepare(mode, onProgress) {
			for (const spec of [ASR_MODEL, HARNESS[mode].extractor]) {
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
			await wait(600);
			return HARNESS[mode].demo.sentence;
		},
		async generate(mode, job) {
			await wait(300);
			const items = parseList(demoListText(mode, job.columns)) ?? [job.text];
			job.rows(items);
			await wait(500);
			return assemble(
				job.text,
				demoRowsText(mode, job.columns),
				new Date(),
				job.columns ?? undefined,
			);
		},
	};
};
