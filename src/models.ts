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
	modelType: "whisper" | "llm";
	modelConfig: Record<string, unknown>;
};

export const MODEL_ROLES: readonly ModelRole[] = ["asr", "extractor"];

export const MODELS: Readonly<Record<ModelRole, ModelSpec>> = {
	asr: {
		sdkConstant: "WHISPER_SPANISH_TINY_Q8_0",
		label: "Whisper Tiny en español (WHISPER_SPANISH_TINY)",
		purpose: "Voz a texto",
		quantization: "Q8_0",
		approxSize: "44 MB",
		modelType: "whisper",
		modelConfig: {
			audio_format: "f32le",
			language: "es",
			translate: false,
			no_timestamps: true,
			suppress_blank: true,
			temperature: 0,
		},
	},
	extractor: {
		sdkConstant: "HEALTHCARE_1_7B_MEDICAL_Q4_K_M",
		label: "MedPsy 1.7B (HEALTHCARE_1_7B_MEDICAL)",
		purpose: "Ordena la visita",
		quantization: "Q4_K_M",
		approxSize: "1.3 GB",
		modelType: "llm",
		modelConfig: { device: "gpu", ctx_size: 2048 },
	},
};
