import { appendFileSync, writeFileSync } from "node:fs";
import * as sdk from "@qvac/sdk";

const HERE = import.meta.dirname;
const OUT = `${HERE}/asr-results.jsonl`;
const log = (row) => {
	appendFileSync(OUT, `${JSON.stringify(row)}\n`);
	console.log(JSON.stringify(row));
};

const TURNS = [
	["M1", "Buenos días. Paciente María González, de cuarenta y dos años. ¿Qué la trae hoy?"],
	["F1", "Tengo fiebre y tos desde hace tres días, y me duele el pecho del lado derecho cuando respiro."],
	["M1", "¿Es alérgica a algún medicamento?"],
	["F1", "Sí, a la penicilina."],
	[
		"M1",
		"Presión ciento veinte sobre ochenta, temperatura treinta y ocho coma cinco, saturación noventa y seis por ciento. Escucho crepitantes en la base del pulmón derecho. Impresión diagnóstica, neumonía adquirida en la comunidad. Indico azitromicina quinientos miligramos por vía oral una vez al día por tres días, y una radiografía de tórax. Si tiene dificultad para respirar, acuda a urgencias.",
	],
];
const REFERENCE = TURNS.map(([, text]) => text).join(" ");

const time = async (fn) => {
	const t0 = performance.now();
	const value = await fn();
	return { value, ms: Math.round(performance.now() - t0) };
};

const resample = (samples, from, to) => {
	const out = new Int16Array(Math.floor((samples.length * to) / from));
	for (let i = 0; i < out.length; i++) {
		const x = (i * from) / to;
		const i0 = Math.floor(x);
		const a = samples[i0] ?? 0;
		const b = samples[i0 + 1] ?? a;
		out[i] = Math.round(a + (b - a) * (x - i0));
	}
	return out;
};

const wav = (samples, rate) => {
	const data = Buffer.alloc(samples.length * 2);
	samples.forEach((v, i) => data.writeInt16LE(v, i * 2));
	const h = Buffer.alloc(44);
	h.write("RIFF", 0);
	h.writeUInt32LE(36 + data.length, 4);
	h.write("WAVEfmt ", 8);
	h.writeUInt32LE(16, 16);
	h.writeUInt16LE(1, 20);
	h.writeUInt16LE(1, 22);
	h.writeUInt32LE(rate, 24);
	h.writeUInt32LE(rate * 2, 28);
	h.writeUInt16LE(2, 32);
	h.writeUInt16LE(16, 34);
	h.write("data", 36);
	h.writeUInt32LE(data.length, 40);
	return Buffer.concat([h, data]);
};

const words = (s) =>
	s
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim()
		.split(" ")
		.filter(Boolean);

const wer = (ref, hyp) => {
	const r = words(ref);
	const h = words(hyp);
	let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
	for (let i = 1; i <= r.length; i++) {
		const cur = [i];
		for (let j = 1; j <= h.length; j++)
			cur[j] = Math.min(
				prev[j] + 1,
				cur[j - 1] + 1,
				prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1),
			);
		prev = cur;
	}
	return Number((prev[h.length] / r.length).toFixed(3));
};

const AUDIO = `${HERE}/consulta-16k.wav`;
if (process.argv[2] !== "skip-tts") {
	const voices = {};
	for (const voice of ["M1", "F1"]) {
		const tts = await time(() =>
			sdk.loadModel({
				modelSrc: sdk.TTS_MULTILINGUAL_SUPERTONIC3_Q8_0,
				modelConfig: {
					ttsEngine: "supertonic",
					language: "es",
					voice,
					ttsSpeed: 1.0,
					ttsNumInferenceSteps: 5,
				},
			}),
		);
		voices[voice] = tts.value;
		log({ kind: "load", model: `TTS_MULTILINGUAL_SUPERTONIC3_Q8_0/${voice}`, ms: tts.ms });
	}
	const chunks = [];
	const pause = new Int16Array(16000 * 0.6);
	for (const [voice, text] of TURNS) {
		const run = sdk.textToSpeech({
			modelId: voices[voice],
			text,
			inputType: "text",
			stream: false,
		});
		const samples = Int16Array.from(await run.buffer);
		chunks.push(resample(samples, 44100, 16000), pause);
	}
	const total = chunks.reduce((n, c) => n + c.length, 0);
	const all = new Int16Array(total);
	let offset = 0;
	for (const c of chunks) {
		all.set(c, offset);
		offset += c.length;
	}
	writeFileSync(AUDIO, wav(all, 16000));
	log({ kind: "tts", seconds: Number((total / 16000).toFixed(1)), file: AUDIO });
	for (const modelId of Object.values(voices))
		await sdk.unloadModel({ modelId, clearStorage: false });
}

const ASR = [
	{
		name: "PARAKEET_TDT_0_6B_V3_Q4_0",
		src: sdk.PARAKEET_TDT_0_6B_V3_Q4_0,
		modelType: "parakeet-transcription",
	},
	{
		name: "WHISPER_SPANISH_TINY_Q8_0",
		src: sdk.WHISPER_SPANISH_TINY_Q8_0,
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
];

for (const asr of ASR) {
	const load = await time(() =>
		sdk.loadModel({
			modelSrc: asr.src,
			modelType: asr.modelType,
			...(asr.modelConfig && { modelConfig: asr.modelConfig }),
		}),
	);
	const run = await time(() =>
		sdk.transcribe({ modelId: load.value, audioChunk: AUDIO }),
	);
	log({
		kind: "asr",
		model: asr.name,
		loadMs: load.ms,
		transcribeMs: run.ms,
		wer: wer(REFERENCE, run.value),
		text: run.value,
	});
	await sdk.unloadModel({ modelId: load.value, clearStorage: false });
}

log({ kind: "reference", text: REFERENCE });
process.exit(0);
