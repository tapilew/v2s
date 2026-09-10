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

const MODE_ORDER = ["finance", "health"] as const;
type ModeId = (typeof MODE_ORDER)[number];

const LEDGER_VERSION = 1;

type LedgerEntry = {
	id: string;
	at: number;
	said: string;
	rows: string[][];
};

type Ledger = {
	version: typeof LEDGER_VERSION;
	mode: ModeId;
	entries: LedgerEntry[];
};

type Store = {
	ledgers: Record<ModeId, Ledger>;
	quarantined: readonly ModeId[];
};

type LedgerRead =
	| { kind: "ok"; ledger: Ledger }
	| { kind: "absent" }
	| { kind: "corrupt" };

type LedgerRow = {
	entryId: string;
	index: number;
	cells: readonly string[];
};

type ModeAccent = {
	fg: { color: string };
	bg: { backgroundColor: string };
	glow: { backgroundColor: string; shadowColor: string };
	ink: { color: string };
	fresh: { backgroundColor: string };
};

type ModeConfig = {
	tabLabel: string;
	tabGlyph: string;
	accent: string;
	inkColor: string;
	tint: ModeAccent;
	eyebrow: string;
	ledgerTitle: string;
	csvName: string;
	columns: readonly [string, ...string[]];
	emptyTitle: string;
	emptyCopy: string;
	readyEmpty: string;
	readySome: string;
	footerHintEmpty: string;
	footerHintSome: string;
	promptRole: string;
	exampleUtterance: string;
	exampleRows: readonly string[][];
	demoTurns: readonly string[];
	demoRows: readonly string[][];
};

type AssistantPhase =
	| { kind: "booting" }
	| { kind: "loading"; model: ModelName; progress: number }
	| { kind: "ready" }
	| { kind: "recording" }
	| { kind: "transcribing"; owner: ModeId }
	| { kind: "ordering"; owner: ModeId }
	| { kind: "error"; message: string; scope: "models" | "capture" };

const uiOnly = process.env.EXPO_PUBLIC_UI_ONLY === "true";
let qvacSdk: QvacSdk | null = null;

const getQvacSdk = async (): Promise<QvacSdk> => {
	if (!qvacSdk) qvacSdk = await import("@qvac/sdk");
	return qvacSdk;
};

const MODES: Record<ModeId, ModeConfig> = {
	finance: {
		tabLabel: "Finanzas",
		tabGlyph: "$",
		accent: "#B8F56F",
		inkColor: "#122014",
		tint: {
			fg: { color: "#B8F56F" },
			bg: { backgroundColor: "#B8F56F" },
			glow: { backgroundColor: "#B8F56F", shadowColor: "#B8F56F" },
			ink: { color: "#122014" },
			fresh: { backgroundColor: "rgba(184, 245, 111, 0.12)" },
		},
		eyebrow: "V2S / MODO FINANZAS",
		ledgerTitle: "Movimientos",
		csvName: "movimientos.csv",
		columns: ["Concepto", "Monto", "Categoría", "Fecha", "Método"],
		emptyTitle: "Así se verá tu hoja",
		emptyCopy:
			"Di un gasto o un cobro en voz alta, con su monto. Cada cosa que digas se guarda como una fila.",
		readyEmpty: "Listo para escuchar tus movimientos",
		readySome: "Sigue agregando movimientos",
		footerHintEmpty: "Toca el micrófono y di un gasto",
		footerHintSome: "Añade otro movimiento cuando quieras",
		promptRole:
			"Eres una asistente que convierte lo que alguien dice sobre dinero en filas de una hoja de cálculo. " +
			"Escribe el monto tal como se dijo, con su moneda si aparece.",
		exampleUtterance: "Me tomé un café de sesenta pesos, pagué en efectivo.",
		exampleRows: [["Café", "60 pesos", "Comida", "hoy", "Efectivo"]],
		demoTurns: [
			"Pagué dos mil pesos de la renta el primero de mayo con transferencia.",
			"Cobré ochocientos de la clase particular del sábado, todavía en efectivo.",
		],
		demoRows: [
			["Renta", "2000 pesos", "Vivienda", "1 de mayo", "Transferencia"],
			["Clase particular", "800 pesos", "Ingreso", "sábado", "Efectivo"],
		],
	},
	health: {
		tabLabel: "Salud",
		tabGlyph: "+",
		accent: "#7FE3D4",
		inkColor: "#0A211D",
		tint: {
			fg: { color: "#7FE3D4" },
			bg: { backgroundColor: "#7FE3D4" },
			glow: { backgroundColor: "#7FE3D4", shadowColor: "#7FE3D4" },
			ink: { color: "#0A211D" },
			fresh: { backgroundColor: "rgba(127, 227, 212, 0.12)" },
		},
		eyebrow: "V2S / MODO SALUD",
		ledgerTitle: "Registro",
		csvName: "registro-salud.csv",
		columns: ["Registro", "Tipo", "Valor", "Fecha", "Notas"],
		emptyTitle: "Así se verá tu registro",
		emptyCopy:
			"Cuenta en voz alta cómo te sientes, qué comiste o qué tomaste. Cada cosa que digas se guarda como una fila.",
		readyEmpty: "Listo para escuchar tu registro",
		readySome: "Sigue agregando registros",
		footerHintEmpty: "Toca el micrófono y cuenta cómo te sientes",
		footerHintSome: "Añade otro registro cuando quieras",
		promptRole:
			"Eres una asistente que convierte lo que alguien dice sobre su salud en filas de una hoja de cálculo. " +
			"En Tipo usa una de estas categorías: Síntoma, Comida, Medicamento, Ejercicio o Ánimo. " +
			"No des diagnósticos ni consejos médicos.",
		exampleUtterance: "Me duele la cabeza, como un cuatro de diez.",
		exampleRows: [["Dolor de cabeza", "Síntoma", "4 de 10", "hoy", "—"]],
		demoTurns: [
			"Me duele la cabeza desde la mañana, como un cuatro de diez.",
			"Tomé el ibuprofeno de las dos y comí ensalada con pollo.",
		],
		demoRows: [
			["Dolor de cabeza", "Síntoma", "4 de 10", "hoy por la mañana", "Sigue"],
			[
				"Ibuprofeno",
				"Medicamento",
				"1 dosis",
				"hoy a las dos",
				"Con ensalada de pollo",
			],
		],
	},
};

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
const HIGHLIGHT_MS = 5000;
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

const rowLabel = (count: number) =>
	`${count} ${count === 1 ? "fila" : "filas"}`;

const ledgerName = (mode: ModeId, suffix: string) =>
	`${uiOnly ? "demo-" : ""}ledger-${mode}${suffix}`;
const ledgerFile = (mode: ModeId) =>
	new File(Paths.document, ledgerName(mode, ".json"));
const tempFile = (mode: ModeId) =>
	new File(Paths.document, ledgerName(mode, ".tmp.json"));
const corruptFile = (mode: ModeId) =>
	new File(Paths.document, ledgerName(mode, `.corrupt-${Date.now()}.json`));

const emptyLedger = (mode: ModeId): Ledger => ({
	version: LEDGER_VERSION,
	mode,
	entries: [],
});

const salvageEntry = (value: unknown): LedgerEntry | null => {
	if (!value || typeof value !== "object") return null;
	const candidate = value as {
		id?: unknown;
		at?: unknown;
		said?: unknown;
		rows?: unknown;
	};
	if (typeof candidate.id !== "string" || typeof candidate.said !== "string")
		return null;
	const rows = Array.isArray(candidate.rows)
		? (candidate.rows as unknown[])
				.filter((row): row is unknown[] => Array.isArray(row))
				.map((row) => row.map((cell) => String(cell ?? "—")))
		: [];
	return {
		id: candidate.id,
		at: typeof candidate.at === "number" ? candidate.at : 0,
		said: candidate.said,
		rows,
	};
};

const ledgerExists = (mode: ModeId) => {
	try {
		return ledgerFile(mode).exists;
	} catch {
		return false;
	}
};

const readLedger = (mode: ModeId): LedgerRead => {
	if (!ledgerExists(mode)) return { kind: "absent" };
	let parsed: unknown;
	try {
		parsed = JSON.parse(ledgerFile(mode).textSync());
	} catch {
		return { kind: "corrupt" };
	}
	if (!parsed || typeof parsed !== "object") return { kind: "corrupt" };
	const candidate = parsed as { version?: unknown; entries?: unknown };
	if (
		typeof candidate.version !== "number" ||
		!Array.isArray(candidate.entries)
	)
		return { kind: "corrupt" };
	if (candidate.version > LEDGER_VERSION) return { kind: "corrupt" };
	const entries = (candidate.entries as unknown[])
		.map(salvageEntry)
		.filter((entry): entry is LedgerEntry => entry !== null);
	return { kind: "ok", ledger: { version: LEDGER_VERSION, mode, entries } };
};

const discardTemp = (mode: ModeId) => {
	try {
		const temp = tempFile(mode);
		if (temp.exists) temp.delete();
	} catch {}
};

const quarantineLedger = (mode: ModeId) => {
	try {
		const file = ledgerFile(mode);
		if (file.exists) file.moveSync(corruptFile(mode));
	} catch {}
};

const loadStore = (): Store => {
	const quarantined: ModeId[] = [];
	const load = (mode: ModeId): Ledger => {
		discardTemp(mode);
		const read = readLedger(mode);
		if (read.kind === "ok") return read.ledger;
		if (read.kind === "corrupt") {
			quarantineLedger(mode);
			quarantined.push(mode);
		}
		return emptyLedger(mode);
	};
	const ledgers = { finance: load("finance"), health: load("health") };
	return { ledgers, quarantined };
};

const saveLedger = (ledger: Ledger) => {
	const temp = tempFile(ledger.mode);
	if (temp.exists) temp.delete();
	temp.create();
	temp.write(JSON.stringify(ledger));
	temp.moveSync(ledgerFile(ledger.mode), { overwrite: true });
};

const appendEntry = (ledger: Ledger, entry: LedgerEntry): Ledger =>
	ledger.entries.some((existing) => existing.id === entry.id)
		? ledger
		: { ...ledger, entries: [...ledger.entries, entry] };

const setEntryRows = (
	ledger: Ledger,
	id: string,
	rows: string[][],
): Ledger => ({
	...ledger,
	entries: ledger.entries.map((entry) =>
		entry.id === id ? { ...entry, rows } : entry,
	),
});

const removeEntry = (ledger: Ledger, id: string): Ledger => ({
	...ledger,
	entries: ledger.entries.filter((entry) => entry.id !== id),
});

const ledgerRows = (
	ledger: Ledger,
	columns: readonly [string, ...string[]],
): LedgerRow[] =>
	ledger.entries.flatMap((entry) =>
		entry.rows.length
			? entry.rows.map((cells, index) => ({
					entryId: entry.id,
					index,
					cells,
				}))
			: [
					{
						entryId: entry.id,
						index: 0,
						cells: columns.map((_, index) => (index === 0 ? entry.said : "—")),
					},
				],
	);

const orderPrompt = (config: ModeConfig) =>
	`${config.promptRole} ` +
	"Responde solo con un arreglo JSON de arreglos de texto, sin markdown ni explicaciones. " +
	`Cada fila lleva exactamente ${config.columns.length} celdas, en este orden: ${config.columns.join(", ")}. ` +
	'No inventes datos: escribe "—" cuando falte información. ' +
	`Ejemplo. Si la persona dice "${config.exampleUtterance}", respondes ${JSON.stringify(config.exampleRows)}.`;

const parseRows = (
	response: string,
	columns: readonly string[],
): string[][] => {
	const start = response.indexOf("[");
	const end = response.lastIndexOf("]");
	if (start === -1 || end < start) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(response.slice(start, end + 1));
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	return (parsed as unknown[])
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
};

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
const toCsv = (
	columns: readonly string[],
	rows: readonly (readonly string[])[],
) => [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");

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

function ModeTabs({
	active,
	locked,
	onSelect,
}: {
	active: ModeId;
	locked: boolean;
	onSelect: (mode: ModeId) => void;
}) {
	return (
		<View style={styles.tabBar}>
			{MODE_ORDER.map((id) => {
				const config = MODES[id];
				const isActive = id === active;
				return (
					<PressableBox
						accessibilityLabel={`Modo ${config.tabLabel}`}
						accessibilityState={{ disabled: locked, selected: isActive }}
						disabled={locked}
						key={id}
						onPress={() => onSelect(id)}
						pressedStyle={styles.pressedSoft}
						style={[styles.tab, locked && styles.tabLocked]}
					>
						<Text style={[styles.tabGlyph, isActive && config.tint.fg]}>
							{config.tabGlyph}
						</Text>
						<Text style={[styles.tabLabel, isActive && config.tint.fg]}>
							{config.tabLabel}
						</Text>
					</PressableBox>
				);
			})}
		</View>
	);
}

function LedgerTable({
	accent,
	columns,
	freshId,
	muted,
	rows,
	widths,
}: {
	accent: ModeAccent;
	columns: readonly string[];
	freshId?: string | null;
	muted?: boolean;
	rows: readonly LedgerRow[];
	widths: number[];
}) {
	const width = widths.reduce((sum, value) => sum + value, 0);
	return (
		<View style={[styles.table, muted && styles.tableMuted, { width }]}>
			<View style={[styles.tableRow, styles.tableHeader]}>
				{columns.map((column, index) => (
					<Text
						key={column}
						style={[
							styles.cell,
							styles.headerCell,
							accent.fg,
							{ width: widths[index] },
						]}
					>
						{column}
					</Text>
				))}
			</View>
			{rows.map((row, rowIndex) => {
				const key = `${row.entryId}-${row.index}`;
				const fresh = row.entryId === freshId;
				return (
					<View
						key={key}
						style={[
							styles.tableRow,
							rowIndex % 2 === 1 && styles.tableRowAlt,
							fresh && accent.fresh,
						]}
					>
						{columns.map((column, index) => (
							<Text
								key={`${key}-${column}`}
								style={[
									styles.cell,
									muted && styles.cellMuted,
									{ width: widths[index] },
								]}
							>
								{fresh && index === 0 ? (
									<Text style={[styles.freshTag, accent.fg]}>NUEVO </Text>
								) : null}
								{row.cells[index] ?? "—"}
							</Text>
						))}
					</View>
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
	const [mode, setMode] = useState<ModeId>("finance");
	const [store, setStore] = useState<Store>(loadStore);
	const [capture, setCapture] = useState<{
		mode: ModeId;
		entryId: string;
		count: number;
	} | null>(null);
	const [freshId, setFreshId] = useState<string | null>(null);
	const [recordingSeconds, setRecordingSeconds] = useState(0);
	const [level, setLevel] = useState(0);
	const [modelAttempt, setModelAttempt] = useState(0);
	const [footerHeight, setFooterHeight] = useState(0);
	const loadedModels = useRef<ModelIds>({ asr: null, llm: null });
	const ledgersRef = useRef(store.ledgers);
	const scrollRef = useRef<ScrollView>(null);
	const pulse = useRef(new Animated.Value(1)).current;
	const demoTurn = useRef<Record<ModeId, number>>({ finance: 0, health: 0 });
	const scrollAnchor = useRef({ count: 0, mode });
	const commit = useCallback(
		(target: ModeId, change: (ledger: Ledger) => Ledger) => {
			const next = change(ledgersRef.current[target]);
			// Not inside the setStore updater: StrictMode runs updaters twice and would double-write.
			// Ahead of the ref and state writes so a failed save leaves neither holding a row the disk lacks.
			saveLedger(next);
			ledgersRef.current = { ...ledgersRef.current, [target]: next };
			setStore((current) => ({ ...current, ledgers: ledgersRef.current }));
		},
		[],
	);
	const config = MODES[mode];
	const rows = ledgerRows(store.ledgers[mode], config.columns);
	const ghostRows: LedgerRow[] = config.exampleRows.map((cells, index) => ({
		entryId: "ejemplo",
		index,
		cells,
	}));
	const shownRows = rows.length ? rows : ghostRows;
	const isBusy = phase.kind === "transcribing" || phase.kind === "ordering";
	const isRecording = phase.kind === "recording";
	const canRecord = phase.kind === "ready" || isRecording;
	const modelsReady =
		uiOnly ||
		(loadedModels.current.asr !== null && loadedModels.current.llm !== null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: modelAttempt intentionally retries initialization. Never add mode here: the cleanup unloads both models, so a mode dependency would re-download ~750 MB on every tab tap.
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

	useEffect(() => {
		if (!capture) return;
		setFreshId(capture.entryId);
		const timeout = setTimeout(() => setFreshId(null), HIGHLIGHT_MS);
		return () => clearTimeout(timeout);
	}, [capture]);

	const statusText = useMemo(() => {
		switch (phase.kind) {
			case "booting":
				return "Preparando tu espacio";
			case "loading":
				return `Descargando ${MODEL_LABELS[phase.model]}`;
			case "ready":
				return rows.length ? config.readySome : config.readyEmpty;
			case "recording":
				return "Te escucho";
			case "transcribing":
				return "Pasando voz a texto";
			case "ordering":
				return "Ordenando lo que dijiste";
			case "error":
				return phase.scope === "models"
					? "No se pudieron cargar los modelos"
					: "Algo salió mal con esa captura";
		}
	}, [config, phase, rows.length]);

	const statusCaption = useMemo(() => {
		switch (phase.kind) {
			case "loading":
				return `Modelo ${phase.model === "asr" ? 1 : 2} de 2 · ${MODEL_SIZES[phase.model]} · descarga única, después funciona sin conexión`;
			case "recording":
				return "Pulsa de nuevo cuando termines de hablar";
			case "error":
				return phase.message;
			default:
				return "Tu audio y tus datos se quedan en este dispositivo";
		}
	}, [phase]);

	const captureTranscript = async (owner: ModeId) => {
		if (uiOnly) {
			const { demoTurns } = MODES[owner];
			const transcript = demoTurns[demoTurn.current[owner] % demoTurns.length];
			demoTurn.current[owner] += 1;
			return transcript;
		}
		await recorder.stop();
		const uri = recorder.uri;
		const asrModelId = loadedModels.current.asr;
		if (!uri || !asrModelId)
			throw new Error("No se encontró el audio grabado.");
		const sdk = await getQvacSdk();
		return (
			await sdk.transcribe({
				modelId: asrModelId,
				audioChunk: toLocalPath(uri),
			})
		).trim();
	};

	const orderEntry = async (owner: ModeId, transcript: string) => {
		const target = MODES[owner];
		if (uiOnly) {
			const index = target.demoTurns.indexOf(transcript);
			return index < 0 ? [] : [target.demoRows[index]];
		}
		const llmModelId = loadedModels.current.llm;
		if (!llmModelId) return [];
		try {
			const sdk = await getQvacSdk();
			const run = sdk.completion({
				modelId: llmModelId,
				history: [
					{ role: "system", content: orderPrompt(target) },
					{ role: "user", content: transcript },
				],
				stream: true,
			});
			let response = "";
			for await (const event of run.events)
				if (event.type === "contentDelta") response += event.text;
			return parseRows(response, target.columns);
		} catch {
			return [];
		}
	};

	const stopRecording = async () => {
		const owner = mode;
		setPhase({ kind: "transcribing", owner });
		try {
			const transcript = await captureTranscript(owner);
			if (!isMeaningfulTranscript(transcript)) {
				setPhase({
					kind: "error",
					message:
						"No se escuchó voz. Acerca el micrófono e inténtalo otra vez.",
					scope: "capture",
				});
				return;
			}
			const entry: LedgerEntry = {
				id: makeId(),
				at: Date.now(),
				said: transcript,
				rows: [],
			};
			commit(owner, (ledger) => appendEntry(ledger, entry));
			setPhase({ kind: "ordering", owner });
			const ordered = await orderEntry(owner, transcript);
			setCapture({
				mode: owner,
				entryId: entry.id,
				count: Math.max(ordered.length, 1),
			});
			if (!ordered.length) {
				setPhase({
					kind: "error",
					message:
						"Guardé tus palabras, pero no pude separarlas en columnas. La fila quedó tal como la dijiste.",
					scope: "capture",
				});
				return;
			}
			commit(owner, (ledger) => setEntryRows(ledger, entry.id, ordered));
			setPhase({ kind: "ready" });
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

	const undoCapture = () => {
		if (!capture) return;
		commit(capture.mode, (ledger) => removeEntry(ledger, capture.entryId));
		setCapture(null);
		setFreshId(null);
		setPhase({ kind: "ready" });
	};

	const selectMode = (next: ModeId) => {
		setMode(next);
		setCapture(null);
		setFreshId(null);
		scrollRef.current?.scrollTo({ animated: false, y: 0 });
	};

	const retry = () => {
		if (phase.kind === "error" && phase.scope === "capture" && modelsReady) {
			setPhase({ kind: "ready" });
			return;
		}
		setModelAttempt((attempt) => attempt + 1);
	};

	const shareLedger = async () => {
		if (!rows.length) return;
		const csv = toCsv(
			config.columns,
			rows.map((row) => row.cells),
		);
		try {
			if (!(await Sharing.isAvailableAsync())) throw new Error("unavailable");
			const file = new File(Paths.cache, config.csvName);
			if (file.exists) file.delete();
			file.create();
			file.write(csv);
			await Sharing.shareAsync(file.uri, {
				dialogTitle: config.ledgerTitle,
				mimeType: "text/csv",
				UTI: "public.comma-separated-values-text",
			});
		} catch {
			await Share.share({ message: csv, title: config.csvName }).catch(
				() => undefined,
			);
		}
	};

	const columnWidths = config.columns.map((column, index) => {
		const longest = shownRows.reduce(
			(max, row) => Math.max(max, (row.cells[index] ?? "").length),
			column.length,
		);
		return Math.min(210, Math.max(58, longest * 7.1 + 26));
	});
	const rawWidth = columnWidths.reduce((sum, value) => sum + value, 0);
	const available = width - 42;
	const widths =
		rawWidth >= available
			? columnWidths
			: columnWidths.map(
					(value) => value + (available - rawWidth) * (value / rawWidth),
				);
	const tableWidth = widths.reduce((sum, value) => sum + value, 0);
	const tableScrolls = tableWidth > available;

	useEffect(() => {
		const previous = scrollAnchor.current;
		scrollAnchor.current = { count: rows.length, mode };
		if (previous.mode !== mode || rows.length <= previous.count) return;
		const timeout = setTimeout(
			() => scrollRef.current?.scrollToEnd({ animated: true }),
			80,
		);
		return () => clearTimeout(timeout);
	}, [mode, rows.length]);

	const errored = phase.kind === "error";
	const footerHint =
		isBusy && phase.owner !== mode
			? `Terminando en ${MODES[phase.owner].tabLabel}`
			: isBusy
				? statusText
				: rows.length
					? config.footerHintSome
					: config.footerHintEmpty;

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
						<View style={[styles.logoMark, config.tint.bg]}>
							<Text style={[styles.logoWave, config.tint.ink]}>∿</Text>
						</View>
						<View style={styles.brandCopy}>
							<Text numberOfLines={1} style={[styles.eyebrow, config.tint.fg]}>
								{config.eyebrow}
							</Text>
							<Text numberOfLines={1} style={styles.title}>
								Habla. Se ordena.
							</Text>
						</View>
					</View>
					<View style={styles.localBadge}>
						<View style={[styles.localDot, config.tint.bg]} />
						<Text style={styles.localText}>Local</Text>
					</View>
				</View>

				<View style={[styles.statusCard, errored && styles.statusCardError]}>
					<View style={styles.statusRow}>
						<View
							style={[styles.statusIcon, errored && styles.statusIconError]}
						>
							{phase.kind === "loading" || isBusy ? (
								<ActivityIndicator color={config.accent} size="small" />
							) : (
								<View
									style={[
										styles.statusDot,
										config.tint.bg,
										errored && styles.statusDotError,
									]}
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
									style={[
										styles.progressFill,
										config.tint.bg,
										{ width: `${phase.progress}%` },
									]}
								/>
							</View>
							<Text style={[styles.progressValue, config.tint.fg]}>
								{phase.progress}%
							</Text>
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

				{store.quarantined.length > 0 && (
					<View style={styles.quarantineNotice}>
						<Text style={styles.quarantineText}>
							No pude leer lo que había guardado en{" "}
							{store.quarantined.map((id) => MODES[id].tabLabel).join(" y ")}.
							Aparté ese archivo sin borrarlo y ese modo empieza vacío.
						</Text>
					</View>
				)}

				<SectionHeading
					badge={
						<View style={styles.headingActions}>
							<View style={styles.countBadge}>
								<Text style={styles.countText}>{rowLabel(rows.length)}</Text>
							</View>
							<PressableBox
								accessibilityLabel="Compartir como CSV"
								disabled={!rows.length}
								hitSlop={8}
								onPress={() => void shareLedger()}
								pressedStyle={styles.pressedStrong}
								style={[
									styles.shareButton,
									config.tint.bg,
									!rows.length && styles.shareButtonDisabled,
								]}
							>
								<Text
									style={[
										styles.shareIcon,
										config.tint.ink,
										!rows.length && styles.shareIconDisabled,
									]}
								>
									↗
								</Text>
							</PressableBox>
						</View>
					}
					label="CAPTURA"
					title={config.ledgerTitle}
				/>

				{rows.length === 0 ? (
					<View style={styles.emptyState}>
						<Text style={styles.emptyTitle}>{config.emptyTitle}</Text>
						<Text style={styles.emptyCopy}>{config.emptyCopy}</Text>
						<ScrollView
							horizontal
							showsHorizontalScrollIndicator={false}
							style={styles.emptyTable}
						>
							<LedgerTable
								accent={config.tint}
								columns={config.columns}
								muted
								rows={ghostRows}
								widths={widths}
							/>
						</ScrollView>
						<Text style={styles.emptyTag}>(ejemplo)</Text>
					</View>
				) : (
					<ScrollView horizontal showsHorizontalScrollIndicator={tableScrolls}>
						<LedgerTable
							accent={config.tint}
							columns={config.columns}
							freshId={freshId}
							rows={rows}
							widths={widths}
						/>
					</ScrollView>
				)}

				{rows.length > 0 && tableScrolls && (
					<Text style={styles.tableHint}>
						Desliza la tabla para ver el resto de las columnas
					</Text>
				)}

				{capture?.mode === mode && (
					<View style={styles.toast}>
						<Text style={styles.toastText}>
							Agregué {rowLabel(capture.count)}.
						</Text>
						<PressableBox
							accessibilityLabel="Deshacer la última captura"
							hitSlop={8}
							onPress={undoCapture}
							pressedStyle={styles.pressedSoft}
							style={styles.toastAction}
						>
							<Text style={[styles.toastActionText, config.tint.fg]}>
								Deshacer
							</Text>
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
					<Text style={styles.footerHint}>{footerHint}</Text>
				)}
				<View style={styles.footerRow}>
					<Animated.View style={{ transform: [{ scale: pulse }] }}>
						<PressableBox
							accessibilityLabel={
								isRecording ? "Detener grabación" : "Grabar una fila"
							}
							disabled={!canRecord}
							onPress={() =>
								isRecording ? void stopRecording() : void startRecording()
							}
							pressedStyle={styles.pressedStrong}
							style={[
								styles.micButton,
								config.tint.glow,
								isRecording && styles.micButtonRecording,
								!canRecord && styles.micButtonDisabled,
							]}
						>
							<Text
								style={[
									styles.micGlyph,
									config.tint.ink,
									!canRecord && styles.micGlyphDisabled,
								]}
							>
								{isRecording ? "■" : "●"}
							</Text>
						</PressableBox>
					</Animated.View>
				</View>
				<ModeTabs active={mode} locked={isRecording} onSelect={selectMode} />
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
	quarantineNotice: {
		backgroundColor: "#1B2419",
		borderColor: "#3C4A2E",
		borderRadius: 14,
		borderWidth: 1,
		marginTop: 12,
		padding: 13,
	},
	quarantineText: { color: "#D9CB9C", fontSize: 12, lineHeight: 18 },
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
	headingActions: {
		alignItems: "center",
		flexDirection: "row",
		flexShrink: 0,
		gap: 8,
	},
	countBadge: {
		backgroundColor: "#18231B",
		borderRadius: 12,
		flexShrink: 0,
		paddingHorizontal: 10,
		paddingVertical: 7,
	},
	countText: { color: "#9BB39C", fontSize: 11, fontWeight: "700" },
	shareButton: {
		alignItems: "center",
		backgroundColor: "#B8F56F",
		borderRadius: 11,
		height: 34,
		justifyContent: "center",
		width: 34,
	},
	shareButtonDisabled: { backgroundColor: "#232E25" },
	shareIcon: {
		color: "#122014",
		fontSize: 17,
		fontWeight: "800",
		lineHeight: 20,
	},
	shareIconDisabled: { color: "#8A9C8C" },
	emptyState: {
		backgroundColor: "#111813",
		borderColor: "#243226",
		borderRadius: 20,
		borderStyle: "dashed",
		borderWidth: 1,
		paddingHorizontal: 14,
		paddingVertical: 20,
	},
	emptyTitle: {
		color: "#E8F3E5",
		fontSize: 16,
		fontWeight: "700",
		textAlign: "center",
	},
	emptyCopy: {
		color: "#8FA792",
		fontSize: 13,
		lineHeight: 19,
		marginTop: 7,
		textAlign: "center",
	},
	emptyTable: { marginTop: 16 },
	emptyTag: {
		color: "#7E9483",
		fontSize: 11,
		fontWeight: "700",
		letterSpacing: 0.6,
		marginTop: 10,
		textAlign: "center",
	},
	table: {
		backgroundColor: "#121A15",
		borderColor: "#2A3D2D",
		borderRadius: 14,
		borderWidth: 1,
		overflow: "hidden",
	},
	tableMuted: { borderColor: "#2A3D2D", borderStyle: "dashed" },
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
	cellMuted: { color: "#7E9483", fontStyle: "italic" },
	freshTag: { fontSize: 10, fontWeight: "800", letterSpacing: 0.6 },
	headerCell: { color: "#B8F56F", fontSize: 11, fontWeight: "800" },
	tableHint: {
		color: "#8CA391",
		fontSize: 11,
		marginTop: 8,
		textAlign: "center",
	},
	toast: {
		alignItems: "center",
		backgroundColor: "#18231B",
		borderColor: "#2A3D2D",
		borderRadius: 14,
		borderWidth: 1,
		flexDirection: "row",
		gap: 10,
		marginTop: 14,
		paddingHorizontal: 13,
		paddingVertical: 11,
	},
	toastText: { color: "#C3D6C2", flex: 1, fontSize: 12, lineHeight: 17 },
	toastAction: { flexShrink: 0, paddingHorizontal: 4, paddingVertical: 2 },
	toastActionText: { color: "#B8F56F", fontSize: 13, fontWeight: "800" },
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
	footerRow: {
		alignItems: "center",
		flexDirection: "row",
		justifyContent: "center",
	},
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
	tabBar: {
		borderTopColor: "#1A251C",
		borderTopWidth: 1,
		flexDirection: "row",
		marginTop: 12,
		paddingTop: 8,
	},
	tab: { alignItems: "center", flex: 1, gap: 2, paddingVertical: 6 },
	tabLocked: { opacity: 0.35 },
	tabGlyph: { color: "#8CA391", fontSize: 15, lineHeight: 18 },
	tabLabel: { color: "#8CA391", fontSize: 11, fontWeight: "700" },
	pressedSoft: { opacity: 0.6 },
	pressedStrong: { opacity: 0.82 },
});
