import type * as Qvac from "@qvac/sdk";

type Sdk = typeof Qvac;

export type SdkModelConstant = {
	[K in keyof Sdk]: Sdk[K] extends { readonly name: K; readonly src: string }
		? K
		: never;
}[keyof Sdk];

export type ModelRole = "asr" | "extractor";

export type ModelSpec = {
	sdkConstant: SdkModelConstant;
	label: string;
	purpose: string;
	quantization: string;
	approxSize: string;
	modelType: "whisper" | "parakeet-transcription" | "llm";
	modelConfig: Record<string, unknown>;
};

export const MODEL_ROLES: readonly ModelRole[] = ["asr", "extractor"];

export const MODELS: Readonly<Record<ModelRole, ModelSpec>> = {
	asr: {
		sdkConstant: "PARAKEET_TDT_0_6B_V3_Q4_0",
		label: "Parakeet TDT 0.6B v3 (NVIDIA, multilingüe)",
		purpose: "Voz a texto",
		quantization: "Q4_0",
		approxSize: "400 MB",
		modelType: "parakeet-transcription",
		modelConfig: {},
	},
	extractor: {
		sdkConstant: "HEALTHCARE_1_7B_MEDICAL_Q4_K_M",
		label: "MedPsy 1.7B (HEALTHCARE_1_7B_MEDICAL)",
		purpose: "Redacta la nota",
		quantization: "Q4_K_M",
		approxSize: "1.3 GB",
		modelType: "llm",
		modelConfig: { device: "gpu", ctx_size: 4096 },
	},
};
