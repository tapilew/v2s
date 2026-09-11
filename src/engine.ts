import {
	type NoteDraft,
	noteRequest,
	parseNote,
	unverifiedPaths,
} from "./clinical-note";
import { MODEL_ROLES, MODELS, type ModelRole } from "./models";
import { DEVICE, logPerf } from "./perf-log";

export type Engine = {
	load(onProgress: (role: ModelRole, percent: number) => void): Promise<void>;
	loaded(): readonly ModelRole[];
	unload(): Promise<void>;
	transcribe(audioPath: string | null): Promise<string>;
	draftNote(transcript: string): Promise<NoteDraft | null>;
};

const sdk = () => import("@qvac/sdk");

export const createQvacEngine = (): Engine => {
	const ids = new Map<ModelRole, string>();
	let generation = 0;

	const modelId = (role: ModelRole) => {
		const id = ids.get(role);
		if (!id) throw new Error("Los modelos todavía no están listos.");
		return id;
	};

	return {
		async load(onProgress) {
			const qvac = await sdk();
			const started = generation;
			for (const role of MODEL_ROLES) {
				if (ids.has(role)) continue;
				const spec = MODELS[role];
				onProgress(role, 0);
				const startedAt = Date.now();
				const id = await qvac.loadModel({
					modelSrc: qvac[spec.sdkConstant],
					modelType: spec.modelType,
					modelConfig: spec.modelConfig,
					onProgress: (update) =>
						onProgress(role, Math.round(update.percentage)),
				});
				if (generation !== started) {
					await qvac.unloadModel({ modelId: id }).catch(() => undefined);
					return;
				}
				ids.set(role, id);
				logPerf({
					event: "load",
					role,
					model: spec.sdkConstant,
					quantization: spec.quantization,
					ms: Date.now() - startedAt,
					device: DEVICE,
				});
			}
		},

		loaded: () => [...ids.keys()],

		async unload() {
			generation += 1;
			const loaded = [...ids.values()];
			ids.clear();
			if (loaded.length === 0) return;
			const qvac = await sdk();
			await Promise.all(
				loaded.map((id) =>
					qvac.unloadModel({ modelId: id }).catch(() => undefined),
				),
			);
		},

		async transcribe(audioPath) {
			if (!audioPath) throw new Error("No se encontró el audio grabado.");
			const qvac = await sdk();
			const startedAt = Date.now();
			const text = (
				await qvac.transcribe({
					modelId: modelId("asr"),
					audioChunk: audioPath,
				})
			).trim();
			logPerf({
				event: "transcribe",
				model: MODELS.asr.sdkConstant,
				ms: Date.now() - startedAt,
				chars: text.length,
			});
			return text;
		},

		async draftNote(transcript) {
			const qvac = await sdk();
			const request = noteRequest(transcript, new Date());
			const startedAt = Date.now();
			const final = await qvac.completion({
				modelId: modelId("extractor"),
				stream: true,
				...request,
			}).final;
			const note = parseNote(final.contentText);
			const { stats } = final;
			logPerf({
				event: "extract",
				model: MODELS.extractor.sdkConstant,
				quantization: MODELS.extractor.quantization,
				prompt: transcript,
				transcriptChars: transcript.length,
				promptTokens: stats?.promptTokens ?? null,
				generatedTokens: stats?.generatedTokens ?? null,
				ttftMs: stats?.timeToFirstToken ?? null,
				tokensPerSecond: stats?.tokensPerSecond ?? null,
				backendDevice: stats?.backendDevice ?? null,
				ms: Date.now() - startedAt,
				parsed: note !== null,
			});
			return note === null
				? null
				: { note, unverified: unverifiedPaths(transcript, note) };
		},
	};
};
