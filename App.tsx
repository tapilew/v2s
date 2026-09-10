import "./global.css";

import {
	completion,
	LLAMA_3_2_1B_INST_Q4_0,
	loadModel,
	type ModelProgressUpdate,
	transcribe,
	unloadModel,
	WHISPER_SPANISH_TINY_Q8_0,
} from "@qvac/sdk";
import {
	AudioQuality,
	IOSOutputFormat,
	type RecordingOptions,
	requestRecordingPermissionsAsync,
	setAudioModeAsync,
	useAudioRecorder,
} from "expo-audio";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	ActivityIndicator,
	Animated,
	Easing,
	FlatList,
	Platform,
	Pressable,
	SafeAreaView,
	StyleSheet,
	Text,
	View,
} from "react-native";

type MessageRole = "user" | "assistant";

type ChatMessage = {
	id: string;
	role: MessageRole;
	content: string;
};

type ConversationTurn = {
	role: "system" | MessageRole;
	content: string;
};

type ModelName = "asr" | "llm";

type ModelIds = {
	asr: string | null;
	llm: string | null;
};

type AssistantPhase =
	| { kind: "booting" }
	| { kind: "loading"; model: ModelName; progress: number }
	| { kind: "ready" }
	| { kind: "recording" }
	| { kind: "transcribing" }
	| { kind: "thinking" }
	| { kind: "error"; message: string };

const SYSTEM_PROMPT =
	"Eres una asistente de voz amable y concisa. Responde siempre en español. " +
	"Usa una o dos frases cortas. No uses markdown, listas ni código porque tu respuesta se mostrará como una conversación hablada.";

const INITIAL_MESSAGES: ChatMessage[] = [
	{
		id: "welcome",
		role: "assistant",
		content: "Hola. Toca el micrófono y dime en qué puedo ayudarte.",
	},
];

const RECORDING_OPTIONS: RecordingOptions = {
	directory: "cache",
	extension: ".m4a",
	sampleRate: 16000,
	numberOfChannels: 1,
	bitRate: 64000,
	android: {
		extension: ".m4a",
		outputFormat: "mpeg4",
		audioEncoder: "aac",
		audioSource: "mic",
	},
	ios: {
		outputFormat: IOSOutputFormat.MPEG4AAC,
		audioQuality: AudioQuality.HIGH,
		linearPCMBitDepth: 16,
		linearPCMIsBigEndian: false,
		linearPCMIsFloat: false,
	},
	web: {
		mimeType: "audio/mp4",
		bitsPerSecond: 64000,
	},
};

const makeId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : "Ocurrió un error inesperado.";

const toLocalPath = (uri: string) =>
	uri.startsWith("file://") ? uri.slice("file://".length) : uri;

const isMeaningfulTranscript = (text: string) => {
	const normalized = text.trim();
	if (!normalized || /^\[[^\]]+\]$/.test(normalized)) return false;
	return normalized.replace(/[^\p{L}\p{N}]/gu, "").length >= 3;
};

const modelLabel = (model: ModelName) =>
	model === "asr" ? "voz" : "respuesta";

export default function App() {
	const recorder = useAudioRecorder(RECORDING_OPTIONS);
	const [phase, setPhase] = useState<AssistantPhase>({ kind: "booting" });
	const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
	const [recordingSeconds, setRecordingSeconds] = useState(0);
	const [modelAttempt, setModelAttempt] = useState(0);
	const loadedModels = useRef<ModelIds>({ asr: null, llm: null });
	const messagesRef = useRef<ChatMessage[]>(INITIAL_MESSAGES);
	const historyRef = useRef<ConversationTurn[]>([
		{ role: "system", content: SYSTEM_PROMPT },
	]);
	const pulse = useRef(new Animated.Value(1)).current;

	const isBusy = phase.kind === "transcribing" || phase.kind === "thinking";
	const canRecord = phase.kind === "ready" || phase.kind === "recording";

	// biome-ignore lint/correctness/useExhaustiveDependencies: modelAttempt intentionally reruns model initialization after recovery.
	useEffect(() => {
		let cancelled = false;

		const progressFor =
			(model: ModelName) => (progress: ModelProgressUpdate) => {
				if (!cancelled) {
					setPhase({
						kind: "loading",
						model,
						progress: Math.round(progress.percentage),
					});
				}
			};

		const initializeModels = async () => {
			setPhase({ kind: "loading", model: "asr", progress: 0 });
			try {
				const asr = await loadModel({
					modelSrc: WHISPER_SPANISH_TINY_Q8_0,
					modelType: "whisper",
					modelConfig: {
						audio_format: "f32le",
						language: "es",
						translate: false,
						no_timestamps: true,
						suppress_blank: true,
						temperature: 0,
					},
					onProgress: progressFor("asr"),
				});

				if (cancelled) {
					await unloadModel({ modelId: asr });
					return;
				}
				loadedModels.current.asr = asr;

				setPhase({ kind: "loading", model: "llm", progress: 0 });
				const llm = await loadModel({
					modelSrc: LLAMA_3_2_1B_INST_Q4_0,
					modelType: "llm",
					modelConfig: {
						device: "gpu",
						ctx_size: 2048,
					},
					onProgress: progressFor("llm"),
				});

				if (cancelled) {
					await unloadModel({ modelId: llm });
					return;
				}
				loadedModels.current.llm = llm;
				setPhase({ kind: "ready" });
			} catch (error) {
				if (!cancelled) {
					setPhase({ kind: "error", message: errorMessage(error) });
				}
			}
		};

		void initializeModels();

		return () => {
			cancelled = true;
			const models = loadedModels.current;
			loadedModels.current = { asr: null, llm: null };
			void Promise.all(
				[models.asr, models.llm]
					.filter((modelId): modelId is string => modelId !== null)
					.map((modelId) => unloadModel({ modelId }).catch(() => undefined)),
			);
		};
	}, [modelAttempt]);

	useEffect(() => {
		if (phase.kind !== "recording") {
			pulse.stopAnimation();
			pulse.setValue(1);
			return;
		}

		const animation = Animated.loop(
			Animated.sequence([
				Animated.timing(pulse, {
					toValue: 1.08,
					duration: 850,
					easing: Easing.inOut(Easing.ease),
					useNativeDriver: true,
				}),
				Animated.timing(pulse, {
					toValue: 1,
					duration: 850,
					easing: Easing.inOut(Easing.ease),
					useNativeDriver: true,
				}),
			]),
		);
		animation.start();
		return () => animation.stop();
	}, [phase.kind, pulse]);

	useEffect(() => {
		if (phase.kind !== "recording") return;
		const interval = setInterval(() => {
			setRecordingSeconds((seconds) => seconds + 1);
		}, 1000);
		return () => clearInterval(interval);
	}, [phase.kind]);

	const statusText = useMemo(() => {
		switch (phase.kind) {
			case "booting":
				return "Preparando modelos locales";
			case "loading":
				return `Cargando modelo de ${modelLabel(phase.model)}`;
			case "ready":
				return "Listo para escuchar";
			case "recording":
				return "Te escucho";
			case "transcribing":
				return "Entendiendo tu mensaje";
			case "thinking":
				return "Preparando una respuesta";
			case "error":
				return "No se pudo iniciar";
		}
	}, [phase]);

	const updateAssistantMessage = (id: string, content: string) => {
		const nextMessages = messagesRef.current.map((message) =>
			message.id === id ? { ...message, content } : message,
		);
		messagesRef.current = nextMessages;
		setMessages(nextMessages);
	};

	const generateResponse = async (transcript: string) => {
		const llmModelId = loadedModels.current.llm;
		if (!llmModelId) return;

		const userMessage: ChatMessage = {
			id: makeId(),
			role: "user",
			content: transcript,
		};
		const assistantId = makeId();
		const assistantMessage: ChatMessage = {
			id: assistantId,
			role: "assistant",
			content: "",
		};
		historyRef.current = [
			...historyRef.current,
			{ role: "user", content: transcript },
		];
		messagesRef.current = [
			...messagesRef.current,
			userMessage,
			assistantMessage,
		];
		setMessages(messagesRef.current);
		setPhase({ kind: "thinking" });

		try {
			const run = completion({
				modelId: llmModelId,
				history: historyRef.current,
				stream: true,
			});
			let response = "";
			for await (const event of run.events) {
				if (event.type === "contentDelta") {
					response += event.text;
					updateAssistantMessage(assistantId, response);
				}
			}
			historyRef.current = [
				...historyRef.current,
				{ role: "assistant", content: response.trim() },
			];
			setPhase({ kind: "ready" });
		} catch (error) {
			updateAssistantMessage(
				assistantId,
				`No pude responder. ${errorMessage(error)}`,
			);
			setPhase({ kind: "ready" });
		}
	};

	const stopRecording = async () => {
		setPhase({ kind: "transcribing" });
		try {
			await recorder.stop();
			const uri = recorder.uri;
			const asrModelId = loadedModels.current.asr;
			if (!uri || !asrModelId)
				throw new Error("No se encontró el audio grabado.");

			const transcript = (
				await transcribe({
					modelId: asrModelId,
					audioChunk: toLocalPath(uri),
				})
			).trim();
			if (!isMeaningfulTranscript(transcript)) {
				setPhase({ kind: "ready" });
				return;
			}
			await generateResponse(transcript);
		} catch (error) {
			setPhase({ kind: "error", message: errorMessage(error) });
		}
	};

	const startRecording = async () => {
		if (phase.kind !== "ready") return;
		try {
			const permission = await requestRecordingPermissionsAsync();
			if (!permission.granted) {
				throw new Error("Necesito permiso para usar el micrófono.");
			}
			await setAudioModeAsync({
				allowsRecording: true,
				playsInSilentMode: true,
			});
			await recorder.prepareToRecordAsync();
			recorder.record();
			setRecordingSeconds(0);
			setPhase({ kind: "recording" });
		} catch (error) {
			setPhase({ kind: "error", message: errorMessage(error) });
		}
	};

	const handleRecordPress = () => {
		if (phase.kind === "recording") {
			void stopRecording();
		} else {
			void startRecording();
		}
	};

	const renderMessage = ({ item }: { item: ChatMessage }) => (
		<View
			style={[
				styles.message,
				item.role === "user" ? styles.userMessage : styles.assistantMessage,
			]}
		>
			{item.role === "assistant" && (
				<Text style={styles.messageLabel}>QVAC</Text>
			)}
			<Text
				style={[
					styles.messageText,
					item.role === "user" && styles.userMessageText,
				]}
			>
				{item.content || "..."}
			</Text>
		</View>
	);

	return (
		<SafeAreaView style={styles.safeArea}>
			<StatusBar style="light" />
			<View style={styles.container}>
				<View style={styles.header}>
					<View>
						<Text style={styles.eyebrow}>ASISTENTE LOCAL</Text>
						<Text style={styles.title}>Hola, soy QVAC</Text>
					</View>
					<View style={styles.localBadge}>
						<View style={styles.localDot} />
						<Text style={styles.localText}>En el teléfono</Text>
					</View>
				</View>

				<View style={styles.statusCard}>
					<View style={styles.statusIcon}>
						{phase.kind === "loading" || isBusy ? (
							<ActivityIndicator color="#A8F26B" size="small" />
						) : (
							<View style={styles.statusDot} />
						)}
					</View>
					<View style={styles.statusCopy}>
						<Text style={styles.statusTitle}>{statusText}</Text>
						<Text style={styles.statusCaption}>
							{phase.kind === "loading"
								? `${phase.progress}% · Descarga única, luego funciona sin conexión`
								: "Whisper + Llama corren de forma privada en Android"}
						</Text>
					</View>
					{phase.kind === "loading" && (
						<View style={styles.progressTrack}>
							<View
								style={[styles.progressFill, { width: `${phase.progress}%` }]}
							/>
						</View>
					)}
				</View>

				<FlatList
					data={messages}
					keyExtractor={(item) => item.id}
					renderItem={renderMessage}
					contentContainerStyle={styles.messageList}
					style={styles.messageListContainer}
					showsVerticalScrollIndicator={false}
				/>

				<View style={styles.controls}>
					<Text style={styles.helperText}>
						{phase.kind === "recording"
							? `Grabando · 00:${String(recordingSeconds).padStart(2, "0")}`
							: "Toca para hablar en español"}
					</Text>
					<Animated.View style={{ transform: [{ scale: pulse }] }}>
						<Pressable
							accessibilityLabel={
								phase.kind === "recording" ? "Detener grabación" : "Hablar"
							}
							disabled={!canRecord}
							onPress={handleRecordPress}
							style={({ pressed }) => [
								styles.micButton,
								phase.kind === "recording" && styles.micButtonRecording,
								!canRecord && styles.micButtonDisabled,
								pressed && styles.micButtonPressed,
							]}
						>
							<Text style={styles.micGlyph}>
								{phase.kind === "recording" ? "■" : "●"}
							</Text>
						</Pressable>
					</Animated.View>
					<Text style={styles.privacyText}>
						Audio y modelos no salen del dispositivo.
					</Text>
				</View>

				{phase.kind === "error" && (
					<View style={styles.errorPanel}>
						<Text style={styles.errorText}>{phase.message}</Text>
						<Pressable
							onPress={() => setModelAttempt((attempt) => attempt + 1)}
							style={styles.retryButton}
						>
							<Text style={styles.retryText}>Reintentar</Text>
						</Pressable>
					</View>
				)}
			</View>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	safeArea: { flex: 1, backgroundColor: "#0B0F0E" },
	container: {
		flex: 1,
		paddingHorizontal: 20,
		paddingTop: Platform.OS === "android" ? 18 : 8,
	},
	header: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingBottom: 20,
	},
	eyebrow: {
		color: "#A8F26B",
		fontSize: 11,
		fontWeight: "700",
		letterSpacing: 1.8,
	},
	title: {
		color: "#F1F7EE",
		fontSize: 30,
		fontWeight: "700",
		letterSpacing: -0.7,
		marginTop: 5,
	},
	localBadge: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		backgroundColor: "#162018",
		borderColor: "#273C2A",
		borderRadius: 20,
		borderWidth: 1,
		paddingHorizontal: 10,
		paddingVertical: 7,
	},
	localDot: {
		backgroundColor: "#A8F26B",
		borderRadius: 4,
		height: 7,
		width: 7,
	},
	localText: { color: "#BED4BD", fontSize: 11, fontWeight: "600" },
	statusCard: {
		backgroundColor: "#121A15",
		borderColor: "#243226",
		borderRadius: 18,
		borderWidth: 1,
		flexDirection: "row",
		alignItems: "center",
		minHeight: 76,
		padding: 14,
	},
	statusIcon: {
		alignItems: "center",
		backgroundColor: "#1C2A1E",
		borderRadius: 20,
		height: 40,
		justifyContent: "center",
		width: 40,
	},
	statusDot: {
		backgroundColor: "#A8F26B",
		borderRadius: 5,
		height: 10,
		width: 10,
	},
	statusCopy: { flex: 1, marginLeft: 12 },
	statusTitle: { color: "#EDF5EA", fontSize: 14, fontWeight: "700" },
	statusCaption: {
		color: "#89A08D",
		fontSize: 11,
		lineHeight: 16,
		marginTop: 3,
	},
	progressTrack: {
		backgroundColor: "#26362A",
		borderRadius: 2,
		height: 4,
		marginLeft: 10,
		overflow: "hidden",
		width: 42,
	},
	progressFill: { backgroundColor: "#A8F26B", borderRadius: 2, height: "100%" },
	messageListContainer: { flex: 1, marginHorizontal: -4 },
	messageList: {
		gap: 14,
		paddingBottom: 20,
		paddingHorizontal: 4,
		paddingTop: 22,
	},
	message: {
		borderRadius: 18,
		maxWidth: "88%",
		paddingHorizontal: 16,
		paddingVertical: 13,
	},
	assistantMessage: {
		alignSelf: "flex-start",
		backgroundColor: "#18211B",
		borderBottomLeftRadius: 5,
	},
	userMessage: {
		alignSelf: "flex-end",
		backgroundColor: "#C5F99D",
		borderBottomRightRadius: 5,
	},
	messageLabel: {
		color: "#A8F26B",
		fontSize: 10,
		fontWeight: "800",
		letterSpacing: 1.2,
		marginBottom: 6,
	},
	messageText: { color: "#EDF5EA", fontSize: 16, lineHeight: 24 },
	userMessageText: { color: "#102015" },
	controls: {
		alignItems: "center",
		borderTopColor: "#1D2A20",
		borderTopWidth: StyleSheet.hairlineWidth,
		paddingBottom: 10,
		paddingTop: 16,
	},
	helperText: { color: "#97AA9A", fontSize: 13, marginBottom: 12 },
	micButton: {
		alignItems: "center",
		backgroundColor: "#A8F26B",
		borderRadius: 38,
		elevation: 6,
		height: 76,
		justifyContent: "center",
		shadowColor: "#A8F26B",
		shadowOffset: { height: 6, width: 0 },
		shadowOpacity: 0.2,
		shadowRadius: 14,
		width: 76,
	},
	micButtonRecording: { backgroundColor: "#F6B8A8", shadowColor: "#F6B8A8" },
	micButtonDisabled: {
		backgroundColor: "#39443A",
		elevation: 0,
		opacity: 0.65,
		shadowOpacity: 0,
	},
	micButtonPressed: { opacity: 0.82 },
	micGlyph: { color: "#102015", fontSize: 24, fontWeight: "800" },
	privacyText: { color: "#607264", fontSize: 11, marginTop: 12 },
	errorPanel: { alignItems: "center", paddingBottom: 14, paddingTop: 6 },
	errorText: {
		color: "#F6B8A8",
		fontSize: 12,
		marginBottom: 8,
		textAlign: "center",
	},
	retryButton: {
		alignSelf: "center",
		backgroundColor: "#253629",
		borderRadius: 12,
		paddingHorizontal: 18,
		paddingVertical: 10,
	},
	retryText: { color: "#C5F99D", fontSize: 13, fontWeight: "700" },
});
