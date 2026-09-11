import { ASR_MODEL, type ModelSpec } from "./models";
import { MODES } from "./modes";
import { DEVICE, logPerf } from "./perf-log";
import type { Draft, ModeId } from "./sheet";

export type ModelProgress = (model: ModelSpec, percent: number) => void;

export type Engine = {
	prepare(mode: ModeId, onProgress: ModelProgress): Promise<void>;
	loaded(): readonly string[];
	transcribe(audioPath: string | null, mode: ModeId): Promise<string>;
	extract(mode: ModeId, text: string): Promise<Draft<unknown> | null>;
	release(): Promise<void>;
};

const sdk = () => import("@qvac/sdk");

export const createQvacEngine = (): Engine => {
	const loaded = new Map<string, string>();
	let queue: Promise<void> = Promise.resolve();

	const serial = (work: () => Promise<void>) => {
		const next = queue.then(work);
		queue = next.catch(() => undefined);
		return next;
	};

	const idFor = (spec: ModelSpec) => {
		const id = loaded.get(spec.sdkConstant);
		if (!id) throw new Error("El modelo todavía no está listo.");
		return id;
	};

	const unloadExcept = async (keep: readonly ModelSpec[]) => {
		const qvac = await sdk();
		for (const [constant, id] of [...loaded]) {
			if (keep.some((spec) => spec.sdkConstant === constant)) continue;
			loaded.delete(constant);
			await qvac.unloadModel({ modelId: id }).catch(() => undefined);
			logPerf({ event: "unload", model: constant });
		}
	};

	return {
		prepare: (mode, onProgress) =>
			serial(async () => {
				const wanted = [ASR_MODEL, MODES[mode].extractor];
				await unloadExcept(wanted);
				const qvac = await sdk();
				for (const spec of wanted) {
					if (loaded.has(spec.sdkConstant)) continue;
					onProgress(spec, 0);
					const startedAt = Date.now();
					const id = await qvac.loadModel({
						modelSrc: qvac[spec.sdkConstant],
						modelType: spec.modelType,
						modelConfig: spec.modelConfig,
						onProgress: (update) =>
							onProgress(spec, Math.round(update.percentage)),
					});
					loaded.set(spec.sdkConstant, id);
					logPerf({
						event: "load",
						model: spec.sdkConstant,
						quantization: spec.quantization,
						ms: Date.now() - startedAt,
						device: DEVICE,
					});
				}
			}),

		loaded: () => [...loaded.keys()],

		release: () => serial(() => unloadExcept([])),

		async transcribe(audioPath) {
			if (!audioPath) throw new Error("No se encontró el audio grabado.");
			const qvac = await sdk();
			const startedAt = Date.now();
			const text = (
				await qvac.transcribe({
					modelId: idFor(ASR_MODEL),
					audioChunk: audioPath,
				})
			).trim();
			logPerf({
				event: "transcribe",
				model: ASR_MODEL.sdkConstant,
				quantization: ASR_MODEL.quantization,
				ms: Date.now() - startedAt,
				chars: text.length,
				device: DEVICE,
			});
			return text;
		},

		async extract(mode, text) {
			const qvac = await sdk();
			const spec = MODES[mode];
			const now = new Date();
			const startedAt = Date.now();
			const run = qvac.completion({
				modelId: idFor(spec.extractor),
				stream: true,
				...spec.request(text, now),
			});
			for await (const _ of run.events);
			const final = await run.final;
			const draft = spec.assemble(text, final.contentText, now);
			const { stats } = final;
			logPerf({
				event: "extract",
				model: spec.extractor.sdkConstant,
				quantization: spec.extractor.quantization,
				prompt: text,
				transcriptChars: text.length,
				promptTokens: stats?.promptTokens ?? null,
				generatedTokens: stats?.generatedTokens ?? null,
				ttftMs: stats?.timeToFirstToken ?? null,
				tokensPerSecond: stats?.tokensPerSecond ?? null,
				backendDevice: stats?.backendDevice ?? null,
				ms: Date.now() - startedAt,
				parsed: draft !== null,
				device: DEVICE,
			});
			return draft;
		},
	};
};
