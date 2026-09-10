import "./global.css";

import {
	AudioQuality,
	IOSOutputFormat,
	type RecordingOptions,
	requestRecordingPermissionsAsync,
	setAudioModeAsync,
	useAudioRecorder,
} from "expo-audio";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { StatusBar } from "expo-status-bar";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	ActivityIndicator,
	Animated,
	Easing,
	Pressable,
	type PressableProps,
	ScrollView,
	Share,
	type StyleProp,
	StyleSheet,
	Text,
	useWindowDimensions,
	View,
	type ViewStyle,
} from "react-native";
import {
	SafeAreaProvider,
	useSafeAreaInsets,
} from "react-native-safe-area-context";

type ModelProgressUpdate = { percentage: number };
type QvacSdk = typeof import("@qvac/sdk");
type ModelName = "asr" | "llm";
type ModelIds = { asr: string | null; llm: string | null };
type CapturedTurn = { id: string; content: string };
type SpreadsheetData = {
	title: string;
	columns: string[];
	rows: string[][];
	fallback: boolean;
};

type AssistantPhase =
	| { kind: "booting" }
	| { kind: "loading"; model: ModelName; progress: number }
	| { kind: "ready" }
	| { kind: "recording" }
	| { kind: "transcribing" }
	| { kind: "converting" }
	| { kind: "error"; message: string; scope: "models" | "capture" };

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
	isMeteringEnabled: true,
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

const METER_BARS = 9;
const MODEL_LABELS: Record<ModelName, string> = {
	asr: "reconocimiento de voz",
	llm: "organización en tablas",
};
const MODEL_SIZES: Record<ModelName, string> = {
	asr: "~45 MB",
	llm: "~750 MB",
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

const formatClock = (totalSeconds: number) => {
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const countLabel = (count: number) =>
	`${count} ${count === 1 ? "fragmento" : "fragmentos"}`;

const rowLabel = (count: number) =>
	`${count} ${count === 1 ? "fila" : "filas"}`;

const slugify = (value: string) =>
	value
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-zA-Z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.toLowerCase()
		.slice(0, 40) || "hoja";

const fallbackSpreadsheet = (turns: CapturedTurn[]): SpreadsheetData => ({
	title: "Conversación sin clasificar",
	columns: ["#", "Fragmento de conversación"],
	rows: turns.map((turn, index) => [String(index + 1), turn.content]),
	fallback: true,
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
	if (!rows.length) return fallbackSpreadsheet(turns);
	return {
		title:
			typeof candidate.title === "string" && candidate.title.trim()
				? candidate.title.trim()
				: "Conversación organizada",
		columns,
		rows,
		fallback: false,
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

/**
 * NativeWind drops the styles of a Pressable that uses the `style={({ pressed }) => ...}`
 * callback form, which left the mic and convert buttons unstyled on Android. Tracking the
 * press in state keeps the visual feedback while passing a plain style array.
 */
type PressableBoxProps = Omit<PressableProps, "style" | "children"> & {
	style?: StyleProp<ViewStyle>;
	pressedStyle?: StyleProp<ViewStyle>;
	children: ReactNode;
};

function PressableBox({
	style,
	pressedStyle,
	children,
	...props
}: PressableBoxProps) {
	const [pressed, setPressed] = useState(false);
	return (
		<Pressable
			accessibilityRole="button"
			{...props}
			onPressIn={() => setPressed(true)}
			onPressOut={() => setPressed(false)}
			style={[style, pressed ? pressedStyle : null]}
		>
			{children}
		</Pressable>
	);
}

function SectionHeading({
	label,
	title,
	badge,
}: {
	label: string;
	title: string;
	badge?: ReactNode;
}) {
	return (
		<View style={styles.sectionHeading}>
			<View style={styles.sectionHeadingCopy}>
				<Text style={styles.sectionLabel}>{label}</Text>
				<Text numberOfLines={2} style={styles.sectionTitle}>
					{title}
				</Text>
			</View>
			{badge}
		</View>
	);
}

function LevelMeter({ level }: { level: number }) {
	return (
		<View style={styles.meter}>
			{Array.from({ length: METER_BARS }, (_, index) => {
				const distance = Math.abs(index - (METER_BARS - 1) / 2);
				const falloff = 1 - distance / METER_BARS;
				const height = Math.round(5 + falloff * 7 + level * falloff * 20);
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: bars are positional, not data.
					<View key={index} style={[styles.meterBar, { height }]} />
				);
			})}
		</View>
	);
}

function Assistant() {
	const recorder = useAudioRecorder(RECORDING_OPTIONS);
	const insets = useSafeAreaInsets();
	const { width } = useWindowDimensions();
	const [phase, setPhase] = useState<AssistantPhase>({ kind: "booting" });
	const [turns, setTurns] = useState<CapturedTurn[]>([]);
	const [spreadsheet, setSpreadsheet] = useState<SpreadsheetData | null>(null);
	const [recordingSeconds, setRecordingSeconds] = useState(0);
	const [level, setLevel] = useState(0);
	const [modelAttempt, setModelAttempt] = useState(0);
	const [footerHeight, setFooterHeight] = useState(0);
	const loadedModels = useRef<ModelIds>({ asr: null, llm: null });
	const scrollRef = useRef<ScrollView>(null);
	const pulse = useRef(new Animated.Value(1)).current;
	const demoTurn = useRef(0);
	const isBusy = phase.kind === "transcribing" || phase.kind === "converting";
	const isRecording = phase.kind === "recording";
	const canRecord = phase.kind === "ready" || isRecording;
	const modelsReady =
		uiOnly ||
		(loadedModels.current.asr !== null && loadedModels.current.llm !== null);

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
					setPhase({
						kind: "error",
						message: errorMessage(error),
						scope: "models",
					});
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
		if (!isRecording) {
			pulse.stopAnimation();
			pulse.setValue(1);
			return;
		}
		const animation = Animated.loop(
			Animated.sequence([
				Animated.timing(pulse, {
					toValue: 1.06,
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
	}, [isRecording, pulse]);

	useEffect(() => {
		if (!isRecording) {
			setLevel(0);
			return;
		}
		const started = Date.now();
		const interval = setInterval(() => {
			const elapsed = Date.now() - started;
			if (uiOnly) {
				setRecordingSeconds(Math.floor(elapsed / 1000));
				const t = elapsed / 1000;
				const wave =
					0.4 +
					0.3 * Math.sin(t * 5.1) * Math.sin(t * 1.7) +
					0.2 * Math.sin(t * 11);
				setLevel(Math.max(0.05, Math.min(1, wave)));
				return;
			}
			const status = recorder.getStatus();
			setRecordingSeconds(
				typeof status.durationMillis === "number"
					? Math.floor(status.durationMillis / 1000)
					: Math.floor(elapsed / 1000),
			);
			const metering = status.metering;
			if (typeof metering === "number")
				setLevel(Math.max(0, Math.min(1, (metering + 60) / 60)));
		}, 100);
		return () => clearInterval(interval);
	}, [isRecording, recorder]);

	const statusText = useMemo(() => {
		switch (phase.kind) {
			case "booting":
				return "Preparando tu espacio";
			case "loading":
				return `Descargando ${MODEL_LABELS[phase.model]}`;
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
				return phase.scope === "models"
					? "No se pudieron cargar los modelos"
					: "No se pudo guardar ese fragmento";
		}
	}, [phase, turns.length]);

	const statusCaption = useMemo(() => {
		switch (phase.kind) {
			case "loading":
				return `Modelo ${phase.model === "asr" ? 1 : 2} de 2 · ${MODEL_SIZES[phase.model]} · descarga única, después funciona sin conexión`;
			case "recording":
				return "Pulsa de nuevo cuando termines este fragmento";
			case "error":
				return phase.message;
			default:
				return "Tu audio y tus datos se quedan en este dispositivo";
		}
	}, [phase]);

	const appendTurn = useCallback((content: string) => {
		setTurns((current) => [...current, { id: makeId(), content }]);
		setSpreadsheet(null);
		setPhase({ kind: "ready" });
	}, []);

	const removeTurn = (id: string) => {
		setTurns((current) => current.filter((turn) => turn.id !== id));
		setSpreadsheet(null);
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
			if (isMeaningfulTranscript(transcript)) {
				appendTurn(transcript);
				return;
			}
			setPhase({
				kind: "error",
				message:
					"No se escuchó voz en ese fragmento. Acerca el micrófono e inténtalo otra vez.",
				scope: "capture",
			});
		} catch (error) {
			setPhase({
				kind: "error",
				message: errorMessage(error),
				scope: "capture",
			});
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
			setPhase({
				kind: "error",
				message: errorMessage(error),
				scope: "capture",
			});
		}
	};

	const generateSpreadsheet = async () => {
		if (!turns.length) return;
		const capturedTurns = turns;
		setPhase({ kind: "converting" });
		if (uiOnly) {
			setSpreadsheet({
				title: "Plan de acción del equipo de marketing",
				columns: ["Tarea", "Responsable", "Fecha", "Estado", "Notas"],
				rows: capturedTurns.map((turn, index) => [
					turn.content.split(" ").slice(0, 4).join(" "),
					index % 2 === 0 ? "Ana" : "Marcos",
					index % 2 === 0 ? "viernes" : "—",
					index % 2 === 0 ? "Pendiente" : "En pausa",
					index % 2 === 0 ? "Confirmar con dirección" : "—",
				]),
				fallback: false,
			});
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

	const retry = () => {
		if (phase.kind === "error" && phase.scope === "capture" && modelsReady) {
			setPhase({ kind: "ready" });
			return;
		}
		setModelAttempt((attempt) => attempt + 1);
	};

	const shareSpreadsheet = async () => {
		if (!spreadsheet) return;
		const csv = toCsv(spreadsheet);
		const filename = `${slugify(spreadsheet.title)}.csv`;
		try {
			if (!(await Sharing.isAvailableAsync())) throw new Error("unavailable");
			const file = new File(Paths.cache, filename);
			if (file.exists) file.delete();
			file.create();
			file.write(csv);
			await Sharing.shareAsync(file.uri, {
				dialogTitle: spreadsheet.title,
				mimeType: "text/csv",
				UTI: "public.comma-separated-values-text",
			});
		} catch {
			await Share.share({ message: csv, title: filename }).catch(
				() => undefined,
			);
		}
	};

	const columnWidths = useMemo(() => {
		if (!spreadsheet) return [];
		const raw = spreadsheet.columns.map((column, index) => {
			const longest = spreadsheet.rows.reduce(
				(max, row) => Math.max(max, (row[index] ?? "").length),
				column.length,
			);
			return Math.min(210, Math.max(58, longest * 7.1 + 26));
		});
		const total = raw.reduce((sum, value) => sum + value, 0);
		const available = width - 42;
		if (total >= available) return raw;
		return raw.map((value) => value + (available - total) * (value / total));
	}, [spreadsheet, width]);

	const tableWidth = columnWidths.reduce((sum, value) => sum + value, 0);
	const tableScrolls = tableWidth > width - 42;

	useEffect(() => {
		if (!turns.length) return;
		const timeout = setTimeout(
			() => scrollRef.current?.scrollToEnd({ animated: true }),
			80,
		);
		return () => clearTimeout(timeout);
	}, [turns.length]);

	const errored = phase.kind === "error";

	return (
		<View style={styles.safeArea}>
			<StatusBar style="light" />
			<ScrollView
				contentContainerStyle={[
					styles.container,
					{ paddingBottom: footerHeight + 24, paddingTop: insets.top + 12 },
				]}
				ref={scrollRef}
				showsVerticalScrollIndicator={false}
			>
				<View style={styles.header}>
					<View style={styles.brandLockup}>
						<View style={styles.logoMark}>
							<Text style={styles.logoWave}>∿</Text>
						</View>
						<View style={styles.brandCopy}>
							<Text numberOfLines={1} style={styles.eyebrow}>
								V2S / VOICE TO SPREADSHEET
							</Text>
							<Text numberOfLines={1} style={styles.title}>
								Habla. Se ordena.
							</Text>
						</View>
					</View>
					<View style={styles.localBadge}>
						<View style={styles.localDot} />
						<Text style={styles.localText}>Local</Text>
					</View>
				</View>

				<View style={[styles.statusCard, errored && styles.statusCardError]}>
					<View style={styles.statusRow}>
						<View
							style={[styles.statusIcon, errored && styles.statusIconError]}
						>
							{phase.kind === "loading" || isBusy ? (
								<ActivityIndicator color="#B8F56F" size="small" />
							) : (
								<View
									style={[styles.statusDot, errored && styles.statusDotError]}
								/>
							)}
						</View>
						<View style={styles.statusCopy}>
							<Text style={styles.statusTitle}>{statusText}</Text>
							<Text
								style={[
									styles.statusCaption,
									errored && styles.statusCaptionError,
								]}
							>
								{statusCaption}
							</Text>
						</View>
					</View>
					{phase.kind === "loading" && (
						<View style={styles.progressBlock}>
							<View style={styles.progressTrack}>
								<View
									style={[styles.progressFill, { width: `${phase.progress}%` }]}
								/>
							</View>
							<Text style={styles.progressValue}>{phase.progress}%</Text>
						</View>
					)}
					{errored && (
						<PressableBox
							onPress={retry}
							pressedStyle={styles.pressedSoft}
							style={styles.retryButton}
						>
							<Text style={styles.retryText}>
								{phase.scope === "models" && !modelsReady
									? "Reintentar descarga"
									: "Volver a intentar"}
							</Text>
						</PressableBox>
					)}
				</View>

				<SectionHeading
					badge={
						<View style={styles.countBadge}>
							<Text style={styles.countText}>{countLabel(turns.length)}</Text>
						</View>
					}
					label="CAPTURA"
					title="Conversación"
				/>

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
								<PressableBox
									accessibilityLabel={`Borrar fragmento ${index + 1}`}
									hitSlop={10}
									onPress={() => removeTurn(turn.id)}
									pressedStyle={styles.pressedSoft}
									style={styles.turnDelete}
								>
									<Text style={styles.turnDeleteGlyph}>×</Text>
								</PressableBox>
							</View>
						))}
					</View>
				)}

				{spreadsheet && (
					<View style={styles.sheetSection}>
						<SectionHeading
							badge={
								<View style={styles.csvBadge}>
									<Text style={styles.csvText}>
										CSV · {rowLabel(spreadsheet.rows.length)}
									</Text>
								</View>
							}
							label="RESULTADO"
							title={spreadsheet.title}
						/>

						{spreadsheet.fallback && (
							<View style={styles.fallbackNotice}>
								<Text style={styles.fallbackText}>
									El modelo no devolvió una tabla utilizable, así que aquí está
									la conversación tal cual.
								</Text>
								<PressableBox
									onPress={() => void generateSpreadsheet()}
									pressedStyle={styles.pressedSoft}
									style={styles.fallbackButton}
								>
									<Text style={styles.fallbackButtonText}>
										Intentar organizar otra vez
									</Text>
								</PressableBox>
							</View>
						)}

						<ScrollView
							horizontal
							showsHorizontalScrollIndicator={tableScrolls}
						>
							<View style={[styles.table, { width: tableWidth }]}>
								<View style={[styles.tableRow, styles.tableHeader]}>
									{spreadsheet.columns.map((column, index) => (
										<Text
											key={column}
											style={[
												styles.cell,
												styles.headerCell,
												{ width: columnWidths[index] },
											]}
										>
											{column}
										</Text>
									))}
								</View>
								{spreadsheet.rows.map((row, rowIndex) => {
									const rowKey = `${rowIndex}-${row.join("")}`;
									return (
										<View
											key={rowKey}
											style={[
												styles.tableRow,
												rowIndex % 2 === 1 && styles.tableRowAlt,
											]}
										>
											{row.map((cell, index) => (
												<Text
													key={`${rowKey}-${spreadsheet.columns[index]}`}
													style={[styles.cell, { width: columnWidths[index] }]}
												>
													{cell}
												</Text>
											))}
										</View>
									);
								})}
							</View>
						</ScrollView>

						{tableScrolls && (
							<Text style={styles.tableHint}>
								Desliza la tabla para ver el resto de las columnas
							</Text>
						)}

						<PressableBox
							onPress={() => void shareSpreadsheet()}
							pressedStyle={styles.pressedStrong}
							style={styles.shareButton}
						>
							<Text style={styles.shareIcon}>↗</Text>
							<Text style={styles.shareText}>Compartir como CSV</Text>
						</PressableBox>
						<PressableBox
							onPress={resetSession}
							pressedStyle={styles.pressedSoft}
							style={styles.newSessionButton}
						>
							<Text style={styles.newSessionText}>Nueva conversación</Text>
						</PressableBox>
					</View>
				)}
			</ScrollView>

			<View
				onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
				style={[
					styles.footer,
					{ paddingBottom: Math.max(insets.bottom, 10) + 10 },
				]}
			>
				{isRecording ? (
					<View style={styles.footerStatus}>
						<LevelMeter level={level} />
						<Text style={styles.footerTimer}>
							{formatClock(recordingSeconds)}
						</Text>
					</View>
				) : (
					<Text style={styles.footerHint}>
						{isBusy
							? statusText
							: turns.length
								? "Añade otro fragmento o crea la hoja"
								: "Toca el micrófono y habla"}
					</Text>
				)}
				<View style={styles.footerRow}>
					<PressableBox
						disabled={!turns.length || isBusy}
						onPress={() => void generateSpreadsheet()}
						pressedStyle={styles.pressedStrong}
						style={[
							styles.convertButton,
							(!turns.length || isBusy) && styles.convertButtonDisabled,
						]}
					>
						{phase.kind === "converting" && (
							<ActivityIndicator color="#122014" size="small" />
						)}
						<Text
							style={[
								styles.convertText,
								(!turns.length || isBusy) && styles.convertTextDisabled,
							]}
						>
							{spreadsheet ? "Actualizar hoja" : "Convertir en hoja"}
						</Text>
					</PressableBox>
					<Animated.View style={{ transform: [{ scale: pulse }] }}>
						<PressableBox
							accessibilityLabel={
								isRecording ? "Detener grabación" : "Grabar fragmento"
							}
							disabled={!canRecord}
							onPress={() =>
								isRecording ? void stopRecording() : void startRecording()
							}
							pressedStyle={styles.pressedStrong}
							style={[
								styles.micButton,
								isRecording && styles.micButtonRecording,
								!canRecord && styles.micButtonDisabled,
							]}
						>
							<Text
								style={[styles.micGlyph, !canRecord && styles.micGlyphDisabled]}
							>
								{isRecording ? "■" : "●"}
							</Text>
						</PressableBox>
					</Animated.View>
				</View>
			</View>
		</View>
	);
}

export default function App() {
	return (
		<SafeAreaProvider>
			<Assistant />
		</SafeAreaProvider>
	);
}

const styles = StyleSheet.create({
	safeArea: { backgroundColor: "#0B0F0E", flex: 1 },
	container: { paddingHorizontal: 20 },
	header: {
		alignItems: "center",
		flexDirection: "row",
		justifyContent: "space-between",
		paddingBottom: 20,
	},
	brandLockup: {
		alignItems: "center",
		flexDirection: "row",
		flexShrink: 1,
		minWidth: 0,
	},
	brandCopy: { flexShrink: 1, minWidth: 0 },
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
		fontSize: 27,
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
		flexShrink: 0,
		marginLeft: 10,
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
		backgroundColor: "#121A15",
		borderColor: "#243226",
		borderRadius: 18,
		borderWidth: 1,
		padding: 14,
	},
	statusCardError: { borderColor: "#6A4A32" },
	statusRow: { alignItems: "center", flexDirection: "row" },
	statusIcon: {
		alignItems: "center",
		backgroundColor: "#1C2A1E",
		borderRadius: 20,
		height: 40,
		justifyContent: "center",
		width: 40,
	},
	statusIconError: { backgroundColor: "#2E2117" },
	statusDot: {
		backgroundColor: "#B8F56F",
		borderRadius: 5,
		height: 10,
		width: 10,
	},
	statusDotError: { backgroundColor: "#F0B37A" },
	statusCopy: { flex: 1, marginLeft: 12 },
	statusTitle: { color: "#EDF5EA", fontSize: 14, fontWeight: "700" },
	statusCaption: {
		color: "#9CB3A0",
		fontSize: 12,
		lineHeight: 17,
		marginTop: 3,
	},
	statusCaptionError: { color: "#F0B37A" },
	progressBlock: { alignItems: "center", flexDirection: "row", marginTop: 12 },
	progressTrack: {
		backgroundColor: "#26362A",
		borderRadius: 3,
		flex: 1,
		height: 6,
		overflow: "hidden",
	},
	progressFill: { backgroundColor: "#B8F56F", borderRadius: 3, height: "100%" },
	progressValue: {
		color: "#B8F56F",
		fontSize: 12,
		fontWeight: "800",
		marginLeft: 10,
		minWidth: 40,
		textAlign: "right",
	},
	retryButton: {
		alignSelf: "flex-start",
		backgroundColor: "#2E2117",
		borderRadius: 12,
		marginTop: 12,
		paddingHorizontal: 16,
		paddingVertical: 10,
	},
	retryText: { color: "#F0B37A", fontSize: 13, fontWeight: "700" },
	sectionHeading: {
		alignItems: "center",
		flexDirection: "row",
		justifyContent: "space-between",
		marginBottom: 12,
		marginTop: 27,
	},
	sectionHeadingCopy: { flexShrink: 1, minWidth: 0, paddingRight: 10 },
	sectionLabel: {
		color: "#8CA391",
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
		flexShrink: 0,
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
		color: "#8FA792",
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
	turnDelete: {
		alignItems: "center",
		height: 28,
		justifyContent: "center",
		marginLeft: 8,
		width: 28,
	},
	turnDeleteGlyph: { color: "#8CA391", fontSize: 20, lineHeight: 22 },
	sheetSection: { marginTop: 4 },
	fallbackNotice: {
		backgroundColor: "#1B2419",
		borderColor: "#3C4A2E",
		borderRadius: 14,
		borderWidth: 1,
		marginBottom: 12,
		padding: 13,
	},
	fallbackText: { color: "#D9CB9C", fontSize: 12, lineHeight: 18 },
	fallbackButton: {
		alignSelf: "flex-start",
		backgroundColor: "#2A3524",
		borderRadius: 10,
		marginTop: 10,
		paddingHorizontal: 14,
		paddingVertical: 8,
	},
	fallbackButtonText: { color: "#C5F99D", fontSize: 12, fontWeight: "700" },
	csvBadge: {
		backgroundColor: "#213625",
		borderRadius: 12,
		flexShrink: 0,
		paddingHorizontal: 9,
		paddingVertical: 7,
	},
	csvText: { color: "#B8F56F", fontSize: 10, fontWeight: "800" },
	table: {
		backgroundColor: "#121A15",
		borderColor: "#2A3D2D",
		borderRadius: 14,
		borderWidth: 1,
		overflow: "hidden",
	},
	tableRow: {
		borderTopColor: "#26382A",
		borderTopWidth: StyleSheet.hairlineWidth,
		flexDirection: "row",
	},
	tableRowAlt: { backgroundColor: "#151E18" },
	tableHeader: { backgroundColor: "#1D3020", borderTopWidth: 0 },
	cell: {
		color: "#CFE0CE",
		fontSize: 12,
		lineHeight: 17,
		paddingHorizontal: 12,
		paddingVertical: 11,
	},
	headerCell: { color: "#B8F56F", fontSize: 11, fontWeight: "800" },
	tableHint: {
		color: "#8CA391",
		fontSize: 11,
		marginTop: 8,
		textAlign: "center",
	},
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
	footer: {
		backgroundColor: "#0D1210",
		borderTopColor: "#1D2A20",
		borderTopWidth: 1,
		bottom: 0,
		left: 0,
		paddingHorizontal: 20,
		paddingTop: 12,
		position: "absolute",
		right: 0,
	},
	footerHint: {
		color: "#9CB3A0",
		fontSize: 12,
		marginBottom: 10,
		textAlign: "center",
	},
	footerStatus: {
		alignItems: "center",
		flexDirection: "row",
		justifyContent: "center",
		marginBottom: 10,
	},
	footerTimer: {
		color: "#F6B8A8",
		fontSize: 13,
		fontVariant: ["tabular-nums"],
		fontWeight: "700",
		marginLeft: 12,
	},
	meter: { alignItems: "center", flexDirection: "row", gap: 3, height: 30 },
	meterBar: { backgroundColor: "#F6B8A8", borderRadius: 2, width: 4 },
	footerRow: { alignItems: "center", flexDirection: "row", gap: 12 },
	convertButton: {
		alignItems: "center",
		backgroundColor: "#B8F56F",
		borderRadius: 14,
		flex: 1,
		flexDirection: "row",
		gap: 7,
		justifyContent: "center",
		paddingHorizontal: 16,
		paddingVertical: 16,
	},
	convertButtonDisabled: { backgroundColor: "#232E25" },
	convertText: { color: "#122014", fontSize: 14, fontWeight: "800" },
	convertTextDisabled: { color: "#8A9C8C" },
	micButton: {
		alignItems: "center",
		backgroundColor: "#B8F56F",
		borderRadius: 30,
		elevation: 6,
		height: 60,
		justifyContent: "center",
		shadowColor: "#B8F56F",
		shadowOffset: { height: 6, width: 0 },
		shadowOpacity: 0.2,
		shadowRadius: 14,
		width: 60,
	},
	micButtonRecording: { backgroundColor: "#F6B8A8", shadowColor: "#F6B8A8" },
	micButtonDisabled: {
		backgroundColor: "#232E25",
		elevation: 0,
		shadowOpacity: 0,
	},
	micGlyph: { color: "#102015", fontSize: 22, fontWeight: "800" },
	micGlyphDisabled: { color: "#8A9C8C" },
	pressedSoft: { opacity: 0.6 },
	pressedStrong: { opacity: 0.82 },
});
