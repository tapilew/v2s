import {
	assemble,
	type CompletionRequest,
	type Generated,
	HARNESS,
	type Job,
	parseList,
} from "./harness";
import { ASR_MODEL, type ModelSpec } from "./models";
import { DEVICE, logPerf } from "./perf-log";
import type { ModeId } from "./spreadsheet";

export type ModelProgress = (model: ModelSpec, percent: number) => void;

export type Engine = {
	prepare(mode: ModeId, onProgress: ModelProgress): Promise<void>;
	loaded(): readonly string[];
	transcribe(audioPath: string | null, mode: ModeId): Promise<string>;
	generate(mode: ModeId, job: Job): Promise<Generated | null>;
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
				const wanted = [ASR_MODEL, HARNESS[mode].extractor];
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

		async generate(mode, job) {
			const qvac = await sdk();
			const { extractor } = HARNESS[mode];
			const complete = async (
				request: CompletionRequest,
				step: "list" | "rows",
				parsed: (contentText: string) => boolean,
			) => {
				const startedAt = Date.now();
				const run = qvac.completion({
					modelId: idFor(extractor),
					stream: true,
					...request,
				});
				for await (const _ of run.events);
				const final = await run.final;
				const { stats } = final;
				logPerf({
					event: "extract",
					step,
					model: extractor.sdkConstant,
					quantization: extractor.quantization,
					prompt: job.text,
					transcriptChars: job.text.length,
					promptTokens: stats?.promptTokens ?? null,
					generatedTokens: stats?.generatedTokens ?? null,
					ttftMs: stats?.timeToFirstToken ?? null,
					tokensPerSecond: stats?.tokensPerSecond ?? null,
					backendDevice: stats?.backendDevice ?? null,
					ms: Date.now() - startedAt,
					parsed: parsed(final.contentText),
					device: DEVICE,
				});
				return final.contentText;
			};
			const listText = await complete(
				job.list,
				"list",
				(contentText) => parseList(contentText) !== null,
			);
			// A list the model could not produce still gets one row: the whole text is the only element.
			const items = parseList(listText) ?? [job.text];
			let generated: Generated | null = null;
			await complete(job.rows(items), "rows", (contentText) => {
				generated = assemble(
					job.text,
					contentText,
					new Date(),
					job.columns ?? undefined,
				);
				return generated !== null;
			});
			return generated;
		},
	};
};
