import type * as Qvac from "@qvac/sdk";

type Sdk = typeof Qvac;

export type SdkModelConstant = {
	[K in keyof Sdk]: Sdk[K] extends { readonly name: K; readonly src: string }
		? K
		: never;
}[keyof Sdk];

export type ModelSpec = {
	sdkConstant: SdkModelConstant;
	label: string;
	purpose: string;
	quantization: string;
	approxSize: string;
	modelType: "parakeet-transcription" | "llm";
	modelConfig: Record<string, unknown>;
};

export const ASR_MODEL: ModelSpec = {
	sdkConstant: "PARAKEET_TDT_0_6B_V3_Q4_0",
	label: "Parakeet TDT 0.6B v3",
	purpose: "Voz a texto",
	quantization: "Q4_0",
	approxSize: "400 MB",
	modelType: "parakeet-transcription",
	modelConfig: {},
};

export const QWEN3_EXTRACTOR: ModelSpec = {
	sdkConstant: "QWEN3_1_7B_INST_Q4",
	label: "Qwen3 1.7B Instruct",
	purpose: "Genera hojas de Finanzas",
	quantization: "Q4",
	approxSize: "1.06 GB",
	modelType: "llm",
	modelConfig: { device: "gpu", ctx_size: 2048 },
};

export const MEDPSY_EXTRACTOR: ModelSpec = {
	sdkConstant: "HEALTHCARE_1_7B_MEDICAL_Q4_K_M",
	label: "MedPsy 1.7B",
	purpose: "Genera hojas de Salud",
	quantization: "Q4_K_M",
	approxSize: "1.28 GB",
	modelType: "llm",
	modelConfig: { device: "gpu", ctx_size: 2048 },
};

export const ALL_MODELS: readonly ModelSpec[] = [
	ASR_MODEL,
	QWEN3_EXTRACTOR,
	MEDPSY_EXTRACTOR,
];
