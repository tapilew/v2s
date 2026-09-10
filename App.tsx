import "./global.css";

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
	Platform,
	Pressable,
	ScrollView,
	Share,
	StyleSheet,
	Text,
	View,
} from "react-native";

type ModelProgressUpdate = { percentage: number };
type QvacSdk = typeof import("@qvac/sdk");
type ModelName = "asr" | "llm";
type ModelIds = { asr: string | null; llm: string | null };
type CapturedTurn = { id: string; content: string };
type SpreadsheetData = { title: string; columns: string[]; rows: string[][] };

type AssistantPhase =
	| { kind: "booting" }
	| { kind: "loading"; model: ModelName; progress: number }
	| { kind: "ready" }
	| { kind: "recording" }
	| { kind: "transcribing" }
	| { kind: "converting" }
	| { kind: "error"; message: string };

const uiOnly = process.env.EXPO_PUBLIC_UI_ONLY === "true";
let qvacSdk: QvacSdk | null = null;

const getQvacSdk = async (): Promise<QvacSdk> => {
	if (!qvacSdk) qvacSdk = await import("@qvac/sdk");
	return qvacSdk;
};

const EXTRACTION_PROMPT =
	"Eres una asistente que convierte conversaciones en datos de hoja de cálculo. " +
	"Responde siempre con JSON válido, sin markdown ni texto adicional. " +
	'Devuelve exactamente este formato: {"title": string, "columns": string[], "rows": string[][]}. ' +
	"Elige columnas útiles según la conversación, por ejemplo Tarea, Responsable, Fecha, Estado y Notas. " +
	'Cada fila debe tener el mismo número de celdas que columns. No inventes datos: usa "—" cuando falte información. ' +
	"Si no hay tareas, organiza hechos, decisiones o pendientes en filas claras.";

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
	web: { mimeType: "audio/mp4", bitsPerSecond: 64000 },
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

const fallbackSpreadsheet = (turns: CapturedTurn[]): SpreadsheetData => ({
	title: "Conversación sin clasificar",
	columns: ["#", "Fragmento de conversación"],
	rows: turns.map((turn, index) => [String(index + 1), turn.content]),
});

const normalizeSpreadsheet = (
	value: unknown,
	turns: CapturedTurn[],
): SpreadsheetData => {
	if (!value || typeof value !== "object") return fallbackSpreadsheet(turns);
	const candidate = value as {
		title?: unknown;
		columns?: unknown;
		rows?: unknown;
	};
	const columns = Array.isArray(candidate.columns)
		? candidate.columns
				.map(String)
				.map((column) => column.trim())
				.filter(Boolean)
		: [];
	if (!columns.length || !Array.isArray(candidate.rows))
		return fallbackSpreadsheet(turns);
	const rows = candidate.rows
		.map((row) => {
			if (Array.isArray(row)) return row.map((cell) => String(cell ?? "—"));
			if (row && typeof row === "object") {
				const record = row as Record<string, unknown>;
				return columns.map((column) => String(record[column] ?? "—"));
			}
			return null;
		})
		.filter((row): row is string[] => row !== null)
		.map((row) => columns.map((_, index) => (row[index] ?? "—").trim() || "—"));
	return {
		title:
			typeof candidate.title === "string" && candidate.title.trim()
				? candidate.title.trim()
				: "Conversación organizada",
		columns,
		rows: rows.length ? rows : fallbackSpreadsheet(turns).rows,
	};
};

const parseSpreadsheet = (response: string, turns: CapturedTurn[]) => {
	const jsonCandidate = response.match(/\{[\s\S]*\}/)?.[0];
	if (!jsonCandidate) return fallbackSpreadsheet(turns);
	try {
		return normalizeSpreadsheet(JSON.parse(jsonCandidate), turns);
	} catch {
		return fallbackSpreadsheet(turns);
	}
};

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
const toCsv = (sheet: SpreadsheetData) =>
	[sheet.columns, ...sheet.rows]
		.map((row) => row.map(csvCell).join(","))
		.join("\n");

export default function App() {
	const recorder = useAudioRecorder(RECORDING_OPTIONS);
	const [phase, setPhase] = useState<AssistantPhase>({ kind: "booting" });
	const [turns, setTurns] = useState<CapturedTurn[]>([]);
	const [spreadsheet, setSpreadsheet] = useState<SpreadsheetData | null>(null);
	const [recordingSeconds, setRecordingSeconds] = useState(0);
	const [modelAttempt, setModelAttempt] = useState(0);
	const loadedModels = useRef<ModelIds>({ asr: null, llm: null });
	const pulse = useRef(new Animated.Value(1)).current;
	const demoTurn = useRef(0);
	const isBusy = phase.kind === "transcribing" || phase.kind === "converting";
	const canRecord = phase.kind === "ready" || phase.kind === "recording";

	// biome-ignore lint/correctness/useExhaustiveDependencies: modelAttempt intentionally retries initialization.
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
			if (uiOnly) {
				setPhase({ kind: "ready" });
				return;
			}
			setPhase({ kind: "loading", model: "asr", progress: 0 });
			try {
				const sdk = await getQvacSdk();
				const asr = await sdk.loadModel({
					modelSrc: sdk.WHISPER_SPANISH_TINY_Q8_0,
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
					await sdk.unloadModel({ modelId: asr });
					return;
				}
				loadedModels.current.asr = asr;
				setPhase({ kind: "loading", model: "llm", progress: 0 });
				const llm = await sdk.loadModel({
					modelSrc: sdk.LLAMA_3_2_1B_INST_Q4_0,
					modelType: "llm",
					modelConfig: { device: "gpu", ctx_size: 4096 },
					onProgress: progressFor("llm"),
				});
				if (cancelled) {
					await sdk.unloadModel({ modelId: llm });
					return;
				}
				loadedModels.current.llm = llm;
				setPhase({ kind: "ready" });
			} catch (error) {
				if (!cancelled)
					setPhase({ kind: "error", message: errorMessage(error) });
			}
		};
		void initializeModels();
		return () => {
			cancelled = true;
			if (!qvacSdk) return;
			const sdk = qvacSdk;
			const models = loadedModels.current;
			loadedModels.current = { asr: null, llm: null };
			void Promise.all(
				[models.asr, models.llm]
					.filter((modelId): modelId is string => modelId !== null)
					.map((modelId) =>
						sdk.unloadModel({ modelId }).catch(() => undefined),
					),
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
		const interval = setInterval(
			() => setRecordingSeconds((seconds) => seconds + 1),
			1000,
		);
		return () => clearInterval(interval);
	}, [phase.kind]);

	const statusText = useMemo(() => {
		switch (phase.kind) {
			case "booting":
				return "Preparando tu espacio";
			case "loading":
				return `Cargando modelo de ${phase.model === "asr" ? "voz" : "hoja"}`;
			case "ready":
				return turns.length
					? "Sigue agregando o crea tu hoja"
					: "Listo para escuchar";
			case "recording":
				return "Te escucho";
			case "transcribing":
				return "Pasando voz a texto";
			case "converting":
				return "Ordenando la conversación";
			case "error":
				return "No se pudo continuar";
		}
	}, [phase, turns.length]);

	const appendTurn = (content: string) => {
		setTurns((current) => [...current, { id: makeId(), content }]);
		setSpreadsheet(null);
		setPhase({ kind: "ready" });
	};

	const stopRecording = async () => {
		setPhase({ kind: "transcribing" });
		try {
			if (uiOnly) {
				const demoTurns = [
					"Revisar el presupuesto de marketing el viernes y confirmar los cambios con Ana.",
					"Deja la campaña de mayo como pendiente y asigna el diseño a Marcos.",
				];
				appendTurn(demoTurns[demoTurn.current % demoTurns.length]);
				demoTurn.current += 1;
				return;
			}
			await recorder.stop();
			const uri = recorder.uri;
			const asrModelId = loadedModels.current.asr;
			if (!uri || !asrModelId)
				throw new Error("No se encontró el audio grabado.");
			const sdk = await getQvacSdk();
			const transcript = (
				await sdk.transcribe({
					modelId: asrModelId,
					audioChunk: toLocalPath(uri),
				})
			).trim();
			if (isMeaningfulTranscript(transcript)) appendTurn(transcript);
			else setPhase({ kind: "ready" });
		} catch (error) {
			setPhase({ kind: "error", message: errorMessage(error) });
		}
	};

	const startRecording = async () => {
		if (phase.kind !== "ready") return;
		try {
			if (!uiOnly) {
				const permission = await requestRecordingPermissionsAsync();
				if (!permission.granted)
					throw new Error("Necesito permiso para usar el micrófono.");
				await setAudioModeAsync({
					allowsRecording: true,
					playsInSilentMode: true,
				});
				await recorder.prepareToRecordAsync();
				recorder.record();
			}
			setRecordingSeconds(0);
			setPhase({ kind: "recording" });
		} catch (error) {
			setPhase({ kind: "error", message: errorMessage(error) });
		}
	};

	const generateSpreadsheet = async () => {
		if (!turns.length) return;
		const capturedTurns = turns;
		setPhase({ kind: "converting" });
		if (uiOnly) {
			setSpreadsheet(fallbackSpreadsheet(capturedTurns));
			setPhase({ kind: "ready" });
			return;
		}
		const llmModelId = loadedModels.current.llm;
		if (!llmModelId) {
			setSpreadsheet(fallbackSpreadsheet(capturedTurns));
			setPhase({ kind: "ready" });
			return;
		}
		try {
			const sdk = await getQvacSdk();
			const transcript = capturedTurns
				.map((turn, index) => `Fragmento ${index + 1}: ${turn.content}`)
				.join("\n");
			const run = sdk.completion({
				modelId: llmModelId,
				history: [
					{ role: "system", content: EXTRACTION_PROMPT },
					{ role: "user", content: transcript },
				],
				stream: true,
			});
			let response = "";
			for await (const event of run.events)
				if (event.type === "contentDelta") response += event.text;
			setSpreadsheet(parseSpreadsheet(response, capturedTurns));
			setPhase({ kind: "ready" });
		} catch {
			setSpreadsheet(fallbackSpreadsheet(capturedTurns));
			setPhase({ kind: "ready" });
		}
	};

	const resetSession = () => {
		setTurns([]);
		setSpreadsheet(null);
		setPhase({ kind: "ready" });
	};

	const shareSpreadsheet = async () => {
		if (spreadsheet)
			await Share.share({
				title: `${spreadsheet.title}.csv`,
				message: toCsv(spreadsheet),
			});
	};

	return (
		<View style={styles.safeArea}>
			<StatusBar style="light" />
			<ScrollView
				contentContainerStyle={styles.container}
				showsVerticalScrollIndicator={false}
			>
				<View style={styles.header}>
					<View style={styles.brandLockup}>
						<View style={styles.logoMark}>
							<Text style={styles.logoWave}>∿</Text>
						</View>
						<View>
							<Text style={styles.eyebrow}>V2S / VOICE TO SPREADSHEET</Text>
							<Text style={styles.title}>Habla. Se ordena.</Text>
						</View>
					</View>
					<View style={styles.localBadge}>
						<View style={styles.localDot} />
						<Text style={styles.localText}>Local</Text>
					</View>
				</View>

				<View style={styles.statusCard}>
					<View style={styles.statusIcon}>
						{phase.kind === "loading" || isBusy ? (
							<ActivityIndicator color="#B8F56F" size="small" />
						) : (
							<View style={styles.statusDot} />
						)}
					</View>
					<View style={styles.statusCopy}>
						<Text style={styles.statusTitle}>{statusText}</Text>
						<Text style={styles.statusCaption}>
							{phase.kind === "loading"
								? `${phase.progress}% · Descarga única, luego funciona sin conexión`
								: phase.kind === "recording"
									? "Pulsa de nuevo cuando termines este fragmento"
									: "Tu audio y tus datos se quedan en este dispositivo"}
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

				<View style={styles.sectionHeading}>
					<View>
						<Text style={styles.sectionLabel}>CAPTURA</Text>
						<Text style={styles.sectionTitle}>Conversación</Text>
					</View>
					<View style={styles.countBadge}>
						<Text style={styles.countText}>{turns.length} fragmentos</Text>
					</View>
				</View>

				{turns.length === 0 ? (
					<View style={styles.emptyState}>
						<View style={styles.emptyIcon}>
							<Text style={styles.emptyGlyph}>◌</Text>
						</View>
						<Text style={styles.emptyTitle}>Tu hoja empieza aquí</Text>
						<Text style={styles.emptyCopy}>
							Graba una conversación por partes. Cada fragmento quedará listo
							para organizarlo en filas.
						</Text>
					</View>
				) : (
					<View style={styles.turnList}>
						{turns.map((turn, index) => (
							<View key={turn.id} style={styles.turnCard}>
								<View style={styles.turnNumber}>
									<Text style={styles.turnNumberText}>
										{String(index + 1).padStart(2, "0")}
									</Text>
								</View>
								<Text style={styles.turnText}>{turn.content}</Text>
							</View>
						))}
					</View>
				)}

				{spreadsheet ? (
					<View style={styles.sheetSection}>
						<View style={styles.sectionHeading}>
							<View>
								<Text style={styles.sectionLabel}>RESULTADO</Text>
								<Text style={styles.sectionTitle}>{spreadsheet.title}</Text>
							</View>
							<View style={styles.csvBadge}>
								<Text style={styles.csvText}>
									CSV · {spreadsheet.rows.length} filas
								</Text>
							</View>
						</View>
						<ScrollView horizontal showsHorizontalScrollIndicator={false}>
							<View style={styles.table}>
								<View style={[styles.tableRow, styles.tableHeader]}>
									{spreadsheet.columns.map((column) => (
										<Text key={column} style={[styles.cell, styles.headerCell]}>
											{column}
										</Text>
									))}
								</View>
								{spreadsheet.rows.map((row) => {
									const rowKey = row.join("\u0001");
									return (
										<View key={rowKey} style={styles.tableRow}>
											{row.map((cell) => (
												<Text key={`${rowKey}-${cell}`} style={styles.cell}>
													{cell}
												</Text>
											))}
										</View>
									);
								})}
							</View>
						</ScrollView>
						<Pressable
							onPress={() => void shareSpreadsheet()}
							style={styles.shareButton}
						>
							<Text style={styles.shareIcon}>↗</Text>
							<Text style={styles.shareText}>Compartir como CSV</Text>
						</Pressable>
						<Pressable onPress={resetSession} style={styles.newSessionButton}>
							<Text style={styles.newSessionText}>Nueva conversación</Text>
						</Pressable>
					</View>
				) : (
					<View style={styles.controls}>
						<Text style={styles.helperText}>
							{phase.kind === "recording"
								? `Grabando · 00:${String(recordingSeconds).padStart(2, "0")}`
								: "Toca para añadir un fragmento"}
						</Text>
						<Animated.View style={{ transform: [{ scale: pulse }] }}>
							<Pressable
								accessibilityLabel={
									phase.kind === "recording"
										? "Detener grabación"
										: "Grabar fragmento"
								}
								disabled={!canRecord}
								onPress={() =>
									phase.kind === "recording"
										? void stopRecording()
										: void startRecording()
								}
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
							Procesamiento privado · sin nube
						</Text>
						<Pressable
							disabled={!turns.length || isBusy}
							onPress={() => void generateSpreadsheet()}
							style={({ pressed }) => [
								styles.convertButton,
								(!turns.length || isBusy) && styles.convertButtonDisabled,
								pressed && styles.convertButtonPressed,
							]}
						>
							{phase.kind === "converting" && (
								<ActivityIndicator color="#122014" size="small" />
							)}
							<Text style={styles.convertText}>Convertir en hoja</Text>
						</Pressable>
					</View>
				)}

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
			</ScrollView>
		</View>
	);
}

const styles = StyleSheet.create({
	safeArea: { flex: 1, backgroundColor: "#0B0F0E" },
	container: {
		paddingHorizontal: 20,
		paddingTop: Platform.OS === "android" ? 18 : 8,
		paddingBottom: 34,
	},
	header: {
		alignItems: "center",
		flexDirection: "row",
		justifyContent: "space-between",
		paddingBottom: 20,
	},
	brandLockup: { alignItems: "center", flex: 1, flexDirection: "row" },
	logoMark: {
		alignItems: "center",
		backgroundColor: "#B8F56F",
		borderRadius: 13,
		height: 36,
		justifyContent: "center",
		marginRight: 10,
		width: 36,
	},
	logoWave: {
		color: "#122014",
		fontSize: 29,
		fontWeight: "800",
		lineHeight: 31,
	},
	eyebrow: {
		color: "#B8F56F",
		fontSize: 10,
		fontWeight: "800",
		letterSpacing: 1.4,
	},
	title: {
		color: "#F1F7EE",
		fontSize: 29,
		fontWeight: "700",
		letterSpacing: -0.8,
		marginTop: 4,
	},
	localBadge: {
		alignItems: "center",
		backgroundColor: "#162018",
		borderColor: "#2C452F",
		borderRadius: 20,
		borderWidth: 1,
		flexDirection: "row",
		paddingHorizontal: 9,
		paddingVertical: 7,
	},
	localDot: {
		backgroundColor: "#B8F56F",
		borderRadius: 4,
		height: 7,
		marginRight: 6,
		width: 7,
	},
	localText: { color: "#BED4BD", fontSize: 11, fontWeight: "700" },
	statusCard: {
		alignItems: "center",
		backgroundColor: "#121A15",
		borderColor: "#243226",
		borderRadius: 18,
		borderWidth: 1,
		flexDirection: "row",
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
		backgroundColor: "#B8F56F",
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
	progressFill: { backgroundColor: "#B8F56F", borderRadius: 2, height: "100%" },
	sectionHeading: {
		alignItems: "center",
		flexDirection: "row",
		justifyContent: "space-between",
		marginBottom: 12,
		marginTop: 27,
	},
	sectionLabel: {
		color: "#748A79",
		fontSize: 10,
		fontWeight: "800",
		letterSpacing: 1.5,
	},
	sectionTitle: {
		color: "#F1F7EE",
		fontSize: 21,
		fontWeight: "700",
		letterSpacing: -0.3,
		marginTop: 3,
	},
	countBadge: {
		backgroundColor: "#18231B",
		borderRadius: 12,
		paddingHorizontal: 10,
		paddingVertical: 7,
	},
	countText: { color: "#9BB39C", fontSize: 11, fontWeight: "700" },
	emptyState: {
		alignItems: "center",
		backgroundColor: "#111813",
		borderColor: "#243226",
		borderRadius: 20,
		borderStyle: "dashed",
		borderWidth: 1,
		paddingHorizontal: 28,
		paddingVertical: 30,
	},
	emptyIcon: {
		alignItems: "center",
		backgroundColor: "#1A2A1D",
		borderRadius: 24,
		height: 48,
		justifyContent: "center",
		width: 48,
	},
	emptyGlyph: { color: "#B8F56F", fontSize: 31, lineHeight: 34 },
	emptyTitle: {
		color: "#E8F3E5",
		fontSize: 16,
		fontWeight: "700",
		marginTop: 13,
	},
	emptyCopy: {
		color: "#7F9682",
		fontSize: 13,
		lineHeight: 19,
		marginTop: 7,
		textAlign: "center",
	},
	turnList: { gap: 9 },
	turnCard: {
		alignItems: "flex-start",
		backgroundColor: "#18211B",
		borderColor: "#243226",
		borderRadius: 15,
		borderWidth: 1,
		flexDirection: "row",
		padding: 13,
	},
	turnNumber: {
		alignItems: "center",
		backgroundColor: "#253B28",
		borderRadius: 8,
		height: 28,
		justifyContent: "center",
		marginRight: 11,
		width: 28,
	},
	turnNumberText: { color: "#B8F56F", fontSize: 10, fontWeight: "800" },
	turnText: { color: "#DCE9D9", flex: 1, fontSize: 14, lineHeight: 21 },
	controls: {
		alignItems: "center",
		borderTopColor: "#1D2A20",
		borderTopWidth: StyleSheet.hairlineWidth,
		marginTop: 22,
		paddingTop: 16,
	},
	helperText: { color: "#97AA9A", fontSize: 13, marginBottom: 12 },
	micButton: {
		alignItems: "center",
		backgroundColor: "#B8F56F",
		borderRadius: 38,
		elevation: 6,
		height: 76,
		justifyContent: "center",
		shadowColor: "#B8F56F",
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
	convertButton: {
		alignItems: "center",
		backgroundColor: "#B8F56F",
		borderRadius: 13,
		flexDirection: "row",
		justifyContent: "center",
		marginTop: 18,
		paddingHorizontal: 20,
		paddingVertical: 13,
		width: "100%",
	},
	convertButtonDisabled: { backgroundColor: "#263328" },
	convertButtonPressed: { opacity: 0.82 },
	convertText: {
		color: "#122014",
		fontSize: 14,
		fontWeight: "800",
		marginLeft: 7,
	},
	sheetSection: {
		borderTopColor: "#1D2A20",
		borderTopWidth: StyleSheet.hairlineWidth,
		marginTop: 25,
		paddingTop: 2,
	},
	csvBadge: {
		backgroundColor: "#213625",
		borderRadius: 12,
		paddingHorizontal: 9,
		paddingVertical: 7,
	},
	csvText: { color: "#B8F56F", fontSize: 10, fontWeight: "800" },
	table: {
		backgroundColor: "#121A15",
		borderColor: "#2A3D2D",
		borderRadius: 14,
		borderWidth: 1,
		minWidth: 520,
		overflow: "hidden",
	},
	tableRow: {
		borderTopColor: "#26382A",
		borderTopWidth: StyleSheet.hairlineWidth,
		flexDirection: "row",
	},
	tableHeader: { backgroundColor: "#1D3020", borderTopWidth: 0 },
	cell: {
		color: "#CFE0CE",
		fontSize: 12,
		lineHeight: 17,
		paddingHorizontal: 12,
		paddingVertical: 11,
		width: 150,
	},
	headerCell: { color: "#B8F56F", fontSize: 11, fontWeight: "800" },
	shareButton: {
		alignItems: "center",
		backgroundColor: "#B8F56F",
		borderRadius: 13,
		flexDirection: "row",
		justifyContent: "center",
		marginTop: 14,
		paddingVertical: 13,
	},
	shareIcon: {
		color: "#122014",
		fontSize: 18,
		fontWeight: "800",
		marginRight: 7,
	},
	shareText: { color: "#122014", fontSize: 14, fontWeight: "800" },
	newSessionButton: { alignItems: "center", paddingVertical: 14 },
	newSessionText: { color: "#9FB89F", fontSize: 13, fontWeight: "700" },
	errorPanel: { alignItems: "center", paddingBottom: 14, paddingTop: 12 },
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
