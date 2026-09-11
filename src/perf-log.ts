import * as Device from "expo-device";
import { File, Paths } from "expo-file-system";

export const DEVICE = {
	modelName: Device.modelName,
	osVersion: Device.osVersion,
	totalMemory: Device.totalMemory,
};

export type PerfEntry =
	| {
			event: "load";
			model: string;
			quantization: string;
			ms: number;
			device: typeof DEVICE;
	  }
	| { event: "unload"; model: string }
	| {
			event: "transcribe";
			model: string;
			quantization: string;
			ms: number;
			chars: number;
			device: typeof DEVICE;
	  }
	| {
			event: "extract";
			model: string;
			quantization: string;
			prompt: string;
			transcriptChars: number;
			promptTokens: number | null;
			generatedTokens: number | null;
			ttftMs: number | null;
			tokensPerSecond: number | null;
			backendDevice: string | null;
			ms: number;
			parsed: boolean;
			device: typeof DEVICE;
	  };

export const perfLogFile = () => new File(Paths.document, "perf-log.jsonl");

export const hasPerfLog = () => {
	try {
		return perfLogFile().exists;
	} catch {
		return false;
	}
};

export const logPerf = (entry: PerfEntry) => {
	try {
		const file = perfLogFile();
		if (!file.exists) file.create();
		file.write(
			`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
			{ append: true },
		);
	} catch {}
};
