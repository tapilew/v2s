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
	Alert,
	Animated,
	Easing,
	KeyboardAvoidingView,
	Modal,
	Pressable,
	type PressableProps,
	ScrollView,
	Share,
	type StyleProp,
	StyleSheet,
	Text,
	TextInput,
	View,
	type ViewStyle,
} from "react-native";
import {
	SafeAreaProvider,
	useSafeAreaInsets,
} from "react-native-safe-area-context";
import { createDemoEngine } from "./src/demo";
import { createQvacEngine } from "./src/engine";
import { ALL_MODELS, type ModelSpec } from "./src/models";
import { MODES } from "./src/modes";
import { DEVICE, hasPerfLog, perfLogFile } from "./src/perf-log";
import {
	type Badge,
	type Cell,
	type ClientGroup,
	type Field,
	type LooseRecord,
	MODE_IDS,
	type Mode,
	type ModeId,
	type SheetRow,
	type SheetView,
	type SummaryItem,
	sheetRows,
	type TableLine,
	type Tone,
} from "./src/sheet";
import { openRecordStore, openTextStore } from "./src/store";

type ErrorScope =
	| { kind: "models" }
	| { kind: "capture" }
	| { kind: "extract"; recordId: string };

type Capture =
	| { kind: "booting" }
	| { kind: "loading"; model: ModelSpec; progress: number }
	| { kind: "ready" }
	| { kind: "starting" }
	| { kind: "recording" }
	| { kind: "transcribing" }
	| { kind: "extracting"; recordId: string }
	| { kind: "error"; message: string; scope: ErrorScope };

type Ledgers = Record<ModeId, readonly LooseRecord[]>;

type Undo = {
	mode: ModeId;
	before: readonly LooseRecord[];
	label: string;
	text: string | null;
	reopen: string | null;
};

type Focus = { mode: ModeId; recordId: string };

type StatusView = {
	title: string;
	caption: string | null;
	tone: "busy" | "error";
	progress: number | null;
};

const uiOnly = process.env.EXPO_PUBLIC_UI_ONLY === "true";
const engine = uiOnly ? createDemoEngine() : createQvacEngine();
const filePrefix = uiOnly ? "demo-" : "";

const byMode = <T,>(make: (id: ModeId) => T): Record<ModeId, T> => ({
	finanzas: make("finanzas"),
	salud: make("salud"),
});

const recordStores = byMode((id) => openRecordStore(`${filePrefix}${id}`));
const composerStores = byMode((id) =>
	openTextStore(`${filePrefix}composer-${id}`),
);

const ACCENT = "#B8F56F";
const INK = "#122014";
const METER_BARS = 9;
const MAX_RECORDING_SECONDS = 600;

const LOCKED_PHASES: ReadonlySet<Capture["kind"]> = new Set([
	"starting",
	"recording",
	"transcribing",
	"extracting",
]);

const TONE_COLOR: Record<Tone, string> = {
	neutral: "#E3EEEA",
	income: "#A6E08A",
	expense: "#F6B8A8",
	saving: "#93BDFF",
	confirmed: "#A6E08A",
	reported: "#93BDFF",
	estimated: "#F2C46D",
	unknown: "#A7B0AA",
	renewal: "#F3A27A",
};

const ERROR_TITLE: Record<ErrorScope["kind"], string> = {
	models: "No se pudo cargar el modelo",
	capture: "No pude usar esa captura",
	extract: "No pude llenar la hoja",
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
const questionKey = (recordId: string, question: string) =>
	`${recordId}\n${question}`;
const isIdle = (phase: Capture) =>
	phase.kind === "ready" ||
	(phase.kind === "error" && phase.scope.kind !== "models");
const cellText = (cell: Cell | undefined) =>
	cell === null || cell === undefined ? "" : String(cell);
const count = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;

const formatClock = (totalSeconds: number) => {
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const busyStatus = (title: string): StatusView => ({
	title,
	caption: null,
	tone: "busy",
	progress: null,
});

const statusFor = (phase: Capture): StatusView | null => {
	switch (phase.kind) {
		case "ready":
		case "starting":
		case "recording":
			return null;
		case "booting":
			return busyStatus("Preparando los modelos");
		case "loading":
			return {
				title: `Cargando ${phase.model.label}`,
				caption: `${phase.model.approxSize} · se descarga una sola vez y se queda en el teléfono`,
				tone: "busy",
				progress: phase.progress,
			};
		case "transcribing":
			return busyStatus("Transcribiendo tu voz");
		case "extracting":
			return busyStatus("Llenando la hoja");
		case "error":
			return {
				title: ERROR_TITLE[phase.scope.kind],
				caption: phase.message,
				tone: "error",
				progress: null,
			};
	}
};

const bootLedgers = (): { ledgers: Ledgers; quarantined: boolean } => {
	let quarantined = false;
	const ledgers = byMode((id) => {
		const read = recordStores[id].load();
		if (read.kind === "ok") return MODES[id].admit(read.records);
		if (read.kind === "quarantined") {
			quarantined = true;
			return [];
		}
		if (!uiOnly) return [];
		const seeded = MODES[id].demo.seed(new Date());
		try {
			recordStores[id].save(seeded);
		} catch {}
		return seeded;
	});
	return { ledgers, quarantined };
};

const shareFile = async (
	file: File,
	mimeType: string,
	UTI: string,
	dialogTitle: string,
) => {
	try {
		if (!(await Sharing.isAvailableAsync())) throw new Error("unavailable");
		await Sharing.shareAsync(file.uri, { dialogTitle, mimeType, UTI });
	} catch {
		try {
			await Share.share({ message: file.textSync(), title: file.name });
		} catch {}
	}
};

const deviceLine = () =>
	[
		DEVICE.modelName ?? "Teléfono desconocido",
		DEVICE.osVersion ? `Android ${DEVICE.osVersion}` : null,
		DEVICE.totalMemory
			? `${(DEVICE.totalMemory / 1024 ** 3).toFixed(1)} GB de RAM`
			: null,
	]
		.filter(Boolean)
		.join(" · ");

type PressableBoxProps = Omit<PressableProps, "style" | "children"> & {
	style?: StyleProp<ViewStyle>;
	pressedStyle?: StyleProp<ViewStyle>;
	children: ReactNode;
};

// NativeWind drops the styles of a Pressable that uses a style callback, so the pressed state lives in React state.
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

function Tappable({
	onPress,
	style,
	children,
}: {
	onPress: (() => void) | null;
	style: StyleProp<ViewStyle>;
	children: ReactNode;
}) {
	if (!onPress) return <View style={style}>{children}</View>;
	return (
		<PressableBox
			accessibilityHint="Abre el detalle de la fila"
			onPress={onPress}
			pressedStyle={styles.pressedRow}
			style={style}
		>
			{children}
		</PressableBox>
	);
}

function LevelMeter({ level }: { level: number }) {
	return (
		<View style={styles.meter}>
			{Array.from({ length: METER_BARS }, (_, index) => {
				const distance = Math.abs(index - (METER_BARS - 1) / 2);
				const falloff = 1 - distance / METER_BARS;
				const height = Math.round(4 + falloff * 6 + level * falloff * 16);
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: bars are positional, not data.
					<View key={index} style={[styles.meterBar, { height }]} />
				);
			})}
		</View>
	);
}

function Chip({ badge }: { badge: Badge }) {
	const color = TONE_COLOR[badge.tone];
	return (
		<View style={[styles.chip, { borderColor: `${color}55` }]}>
			<Text style={[styles.chipText, { color }]}>{badge.label}</Text>
		</View>
	);
}

function SummaryStrip({ items }: { items: readonly SummaryItem[] }) {
	const basis = items.length > 4 ? "30%" : "45%";
	return (
		<View style={styles.summary}>
			{items.map((item) => (
				<View key={item.label} style={[styles.tile, { flexBasis: basis }]}>
					<Text numberOfLines={1} style={styles.tileLabel}>
						{item.label}
					</Text>
					<Text
						numberOfLines={1}
						style={[styles.tileValue, { color: TONE_COLOR[item.tone] }]}
					>
						{item.value}
					</Text>
				</View>
			))}
		</View>
	);
}

function TableView({
	headers,
	lines,
	onOpen,
}: {
	headers: Extract<SheetView, { kind: "table" }>["headers"];
	lines: readonly TableLine[];
	onOpen: ((row: SheetRow) => void) | null;
}) {
	return (
		<View>
			<View style={styles.tableHead}>
				<Text style={[styles.th, styles.colDate]}>{headers.date}</Text>
				<Text style={[styles.th, styles.colTitle]}>{headers.title}</Text>
				<Text style={[styles.th, styles.colSub]}>{headers.subtitle}</Text>
				<Text style={[styles.th, styles.colAmount]}>{headers.amount}</Text>
			</View>
			{lines.map((line) => (
				<Tappable
					key={line.row.key}
					onPress={onOpen && (() => onOpen(line.row))}
					style={styles.tr}
				>
					<Text style={[styles.td, styles.tdMuted, styles.colDate]}>
						{line.date}
					</Text>
					<View style={styles.colTitle}>
						<Text style={styles.td}>{line.title}</Text>
						{line.row.unverified.length > 0 ? (
							<Text style={styles.flag}>Revisar</Text>
						) : null}
					</View>
					<Text style={[styles.td, styles.tdMuted, styles.colSub]}>
						{line.subtitle}
					</Text>
					<Text
						style={[
							styles.td,
							styles.amount,
							styles.colAmount,
							{ color: TONE_COLOR[line.amount.tone] },
						]}
					>
						{line.amount.label}
					</Text>
				</Tappable>
			))}
		</View>
	);
}

function CardsView({
	clients,
	onOpen,
}: {
	clients: readonly ClientGroup[];
	onOpen: ((row: SheetRow) => void) | null;
}) {
	return (
		<View style={styles.cards}>
			{clients.map((client) => (
				<View key={client.key} style={styles.clientCard}>
					<Text style={styles.clientName}>{client.name}</Text>
					{client.meta ? (
						<Text style={styles.clientMeta}>{client.meta}</Text>
					) : null}
					{client.units.map((unit) => (
						<Tappable
							key={unit.row.key}
							onPress={onOpen && (() => onOpen(unit.row))}
							style={styles.unitRow}
						>
							<View style={styles.unitLine}>
								<View style={styles.flexCopy}>
									<Text style={styles.unitTitle}>{unit.title}</Text>
									<Text style={styles.unitDetail}>{unit.detail}</Text>
								</View>
								<Chip badge={unit.status} />
							</View>
							{unit.tags.length > 0 ? (
								<View style={styles.tags}>
									{unit.tags.map((tag) => (
										<Chip badge={tag} key={tag.label} />
									))}
								</View>
							) : null}
						</Tappable>
					))}
				</View>
			))}
		</View>
	);
}

function SheetBody({
	view,
	onOpen,
}: {
	view: SheetView;
	onOpen: ((row: SheetRow) => void) | null;
}) {
	return view.kind === "table" ? (
		<TableView headers={view.headers} lines={view.lines} onOpen={onOpen} />
	) : (
		<CardsView clients={view.clients} onOpen={onOpen} />
	);
}

function EmptyState({ mode }: { mode: Mode }) {
	const example = useMemo(() => {
		const now = new Date();
		const draft = mode.assemble(mode.demo.example, mode.demo.modelText, now);
		return draft === null
			? null
			: mode.view(
					[
						{
							id: "ejemplo",
							at: now.getTime(),
							source: mode.demo.example,
							...draft,
						},
					],
					now,
				);
	}, [mode]);
	return (
		<View style={styles.empty}>
			<Text style={styles.emptyTitle}>Escribe o dicta algo así</Text>
			<View style={styles.exampleQuote}>
				<Text style={styles.exampleQuoteText}>"{mode.demo.example}"</Text>
			</View>
			<Text style={styles.emptyArrow}>y se convierte en</Text>
			{example ? (
				<View pointerEvents="none" style={styles.ghost}>
					<SheetBody onOpen={null} view={example} />
				</View>
			) : null}
		</View>
	);
}

function PendingCard({
	record,
	extracting,
	canAct,
	onRetry,
	onDelete,
}: {
	record: LooseRecord;
	extracting: boolean;
	canAct: boolean;
	onRetry: () => void;
	onDelete: () => void;
}) {
	return (
		<View style={styles.pendingCard}>
			<Text style={styles.cardLabel}>
				{extracting ? "LLENANDO LA HOJA" : "GUARDADO SIN LLENAR"}
			</Text>
			<Text numberOfLines={4} style={styles.pendingText}>
				{record.source}
			</Text>
			{extracting ? (
				<View style={styles.inlineBusy}>
					<ActivityIndicator color={ACCENT} size="small" />
					<Text style={styles.inlineBusyText}>El modelo está leyendo</Text>
				</View>
			) : (
				<View style={styles.pendingActions}>
					<PressableBox
						accessibilityLabel="Intentar llenar la hoja otra vez"
						disabled={!canAct}
						onPress={onRetry}
						pressedStyle={styles.pressedSoft}
						style={styles.textButton}
					>
						<Text style={[styles.textButtonLabel, !canAct && styles.dimmed]}>
							Reintentar
						</Text>
					</PressableBox>
					<PressableBox
						accessibilityLabel="Eliminar este texto"
						disabled={!canAct}
						onPress={onDelete}
						pressedStyle={styles.pressedSoft}
						style={styles.textButton}
					>
						<Text style={[styles.textButtonDanger, !canAct && styles.dimmed]}>
							Eliminar
						</Text>
					</PressableBox>
				</View>
			)}
		</View>
	);
}

function ModeMenu({
	current,
	top,
	locked,
	onPick,
	onClose,
}: {
	current: ModeId;
	top: number;
	locked: boolean;
	onPick: (id: ModeId) => void;
	onClose: () => void;
}) {
	return (
		<View style={StyleSheet.absoluteFill}>
			<Pressable
				accessibilityLabel="Cerrar el menú de hojas"
				onPress={onClose}
				style={StyleSheet.absoluteFill}
			/>
			<View style={[styles.menu, { top }]}>
				{MODE_IDS.map((id) => {
					const option = MODES[id];
					const active = id === current;
					const disabled = locked && !active;
					return (
						<PressableBox
							accessibilityState={{ selected: active, disabled }}
							disabled={disabled}
							key={id}
							onPress={() => onPick(id)}
							pressedStyle={styles.pressedRow}
							style={[styles.menuOption, disabled && styles.dimmed]}
						>
							<View style={styles.flexCopy}>
								<Text style={styles.menuTitle}>{option.label}</Text>
								<Text style={styles.menuSubtitle}>{option.subtitle}</Text>
							</View>
							<Text style={styles.menuCheck}>{active ? "✓" : ""}</Text>
						</PressableBox>
					);
				})}
				{locked ? (
					<Text style={styles.menuHint}>
						Termina la captura para cambiar de hoja.
					</Text>
				) : null}
			</View>
		</View>
	);
}

function DeviceSheet({
	visible,
	bottomInset,
	onClose,
}: {
	visible: boolean;
	bottomInset: number;
	onClose: () => void;
}) {
	const loaded = engine.loaded();
	const canShare = visible && !uiOnly && hasPerfLog();
	return (
		<Modal
			animationType="fade"
			navigationBarTranslucent
			onRequestClose={onClose}
			statusBarTranslucent
			transparent
			visible={visible}
		>
			<View style={styles.sheetScreen}>
				<Pressable
					accessibilityLabel="Cerrar"
					onPress={onClose}
					style={[StyleSheet.absoluteFill, styles.backdrop]}
				/>
				<View style={[styles.sheet, { paddingBottom: bottomInset + 18 }]}>
					<Text style={styles.eyebrow}>EN EL DISPOSITIVO</Text>
					<Text style={styles.sheetHeadline}>
						Nada sale del teléfono. Los modelos corren aquí, sin internet
						después de la descarga.
					</Text>
					{ALL_MODELS.map((spec) => (
						<View key={spec.sdkConstant} style={styles.modelRow}>
							<Text style={styles.modelPurpose}>{spec.purpose}</Text>
							<Text style={styles.modelLabel}>{spec.label}</Text>
							<Text style={styles.modelMeta}>
								{spec.quantization} · {spec.approxSize} ·{" "}
								{uiOnly
									? "modo demo, sin cargar"
									: loaded.includes(spec.sdkConstant)
										? "cargado"
										: "sin cargar"}
							</Text>
						</View>
					))}
					<Text style={styles.deviceLine}>{deviceLine()}</Text>
					<PressableBox
						disabled={!canShare}
						onPress={() =>
							void shareFile(
								perfLogFile(),
								"text/plain",
								"public.plain-text",
								"Registro de rendimiento",
							)
						}
						pressedStyle={styles.pressedStrong}
						style={[styles.primaryButton, !canShare && styles.buttonOff]}
					>
						<Text
							style={[styles.primaryText, !canShare && styles.buttonOffText]}
						>
							Compartir registro de rendimiento
						</Text>
					</PressableBox>
					{canShare ? null : (
						<Text style={styles.sheetHint}>
							{uiOnly
								? "El modo demo no escribe registro."
								: "El registro aparece después de la primera carga."}
						</Text>
					)}
					<PressableBox
						onPress={onClose}
						pressedStyle={styles.pressedSoft}
						style={styles.sheetClose}
					>
						<Text style={styles.sheetCloseText}>Cerrar</Text>
					</PressableBox>
				</View>
			</View>
		</Modal>
	);
}

function FieldEditor({
	field,
	value,
	unverified,
	onChange,
}: {
	field: Field;
	value: string;
	unverified: boolean;
	onChange: (value: string) => void;
}) {
	const { input } = field;
	return (
		<View style={styles.field}>
			<Text style={styles.fieldLabel}>{field.label}</Text>
			{unverified ? (
				<Text style={styles.unverifiedText}>
					No verificado en el texto original
				</Text>
			) : null}
			{input.kind === "readonly" ? (
				<Text style={styles.fieldValue}>{value || "Sin dato"}</Text>
			) : input.kind === "choice" ? (
				<View style={styles.options}>
					{input.options.map((option) => {
						const on = value === option;
						return (
							<PressableBox
								accessibilityState={{ selected: on }}
								key={option}
								onPress={() => onChange(on ? "" : option)}
								pressedStyle={styles.pressedSoft}
								style={[styles.option, on && styles.optionOn]}
							>
								<Text style={[styles.optionText, on && styles.optionTextOn]}>
									{option}
								</Text>
							</PressableBox>
						);
					})}
				</View>
			) : (
				<TextInput
					accessibilityLabel={field.label}
					keyboardType={input.kind === "number" ? "decimal-pad" : "default"}
					onChangeText={onChange}
					placeholder={input.kind === "date" ? "AAAA-MM-DD" : "Sin dato"}
					placeholderTextColor="#6F8574"
					style={[styles.fieldInput, unverified && styles.fieldInputFlag]}
					value={value}
				/>
			)}
		</View>
	);
}

function DetailSheet({
	mode,
	row,
	source,
	bottomInset,
	onClose,
	onSave,
	onDelete,
}: {
	mode: Mode;
	row: SheetRow;
	source: string;
	bottomInset: number;
	onClose: () => void;
	onSave: (edits: ReadonlyArray<readonly [string, string]>) => void;
	onDelete: () => void;
}) {
	const [edits, setEdits] = useState<Record<string, string>>({});
	const [showSource, setShowSource] = useState(false);
	const original = (key: string) => cellText(row.cells[key]);
	const changed = Object.entries(edits).filter(
		([key, value]) => value !== original(key),
	);
	const fields = mode.fields.filter(
		(field) =>
			field.input.kind !== "readonly" || original(field.key) !== source,
	);
	return (
		<Modal
			animationType="slide"
			navigationBarTranslucent
			onRequestClose={onClose}
			statusBarTranslucent
			transparent
			visible
		>
			<KeyboardAvoidingView behavior="padding" style={styles.sheetScreen}>
				<Pressable
					accessibilityLabel="Cerrar"
					onPress={onClose}
					style={[StyleSheet.absoluteFill, styles.backdrop]}
				/>
				<View
					style={[
						styles.sheet,
						styles.detailSheet,
						{ paddingBottom: bottomInset + 14 },
					]}
				>
					<ScrollView
						contentContainerStyle={styles.detailContent}
						keyboardShouldPersistTaps="handled"
					>
						<Text style={styles.eyebrow}>{mode.sheetTitle.toUpperCase()}</Text>
						{row.factors ? (
							<View style={styles.factors}>
								<Text style={styles.factorsTitle}>
									Confianza {cellText(row.cells.confianza)}
								</Text>
								<Text style={styles.factorsText}>{row.factors}</Text>
							</View>
						) : null}
						{fields.map((field) => (
							<FieldEditor
								field={field}
								key={field.key}
								onChange={(value) =>
									setEdits((current) => ({ ...current, [field.key]: value }))
								}
								unverified={row.unverified.includes(field.key)}
								value={edits[field.key] ?? original(field.key)}
							/>
						))}
						<PressableBox
							accessibilityState={{ expanded: showSource }}
							onPress={() => setShowSource((open) => !open)}
							pressedStyle={styles.pressedSoft}
							style={styles.textButton}
						>
							<Text style={styles.textButtonLabel}>
								{showSource ? "Ocultar texto original" : "Ver texto original"}
							</Text>
						</PressableBox>
						{showSource ? (
							<View style={styles.exampleQuote}>
								<Text style={styles.exampleQuoteText}>{source}</Text>
							</View>
						) : null}
						<PressableBox
							accessibilityLabel="Eliminar esta fila"
							onPress={onDelete}
							pressedStyle={styles.pressedSoft}
							style={styles.textButton}
						>
							<Text style={styles.textButtonDanger}>Eliminar fila</Text>
						</PressableBox>
					</ScrollView>
					<View style={styles.detailActions}>
						<PressableBox
							onPress={onClose}
							pressedStyle={styles.pressedSoft}
							style={styles.secondaryButton}
						>
							<Text style={styles.secondaryText}>Cerrar</Text>
						</PressableBox>
						<PressableBox
							disabled={changed.length === 0}
							onPress={() => onSave(changed)}
							pressedStyle={styles.pressedStrong}
							style={[
								styles.primaryButton,
								styles.flexCopy,
								changed.length === 0 && styles.buttonOff,
							]}
						>
							<Text
								style={[
									styles.primaryText,
									changed.length === 0 && styles.buttonOffText,
								]}
							>
								Guardar cambios
							</Text>
						</PressableBox>
					</View>
				</View>
			</KeyboardAvoidingView>
		</Modal>
	);
}

function Assistant() {
	const recorder = useAudioRecorder(RECORDING_OPTIONS);
	const insets = useSafeAreaInsets();
	const [boot] = useState(bootLedgers);
	const [ledgers, setLedgers] = useState<Ledgers>(boot.ledgers);
	const ledgersRef = useRef<Ledgers>(boot.ledgers);
	const [modeId, setModeId] = useState<ModeId>(MODE_IDS[0]);
	const [drafts, setDrafts] = useState<Record<ModeId, string>>(() =>
		byMode((id) => composerStores[id].load()),
	);
	const savedDrafts = useRef(drafts);
	const [phase, setPhase] = useState<Capture>({ kind: "booting" });
	// Handlers read the phase from here: two taps in one frame both see the stale render value.
	const phaseRef = useRef<Capture>(phase);
	const [focus, setFocus] = useState<Focus | null>(null);
	const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
	const [undo, setUndo] = useState<Undo | null>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const [menuTop, setMenuTop] = useState(0);
	const [deviceOpen, setDeviceOpen] = useState(false);
	const [detailKey, setDetailKey] = useState<string | null>(null);
	const [seconds, setSeconds] = useState(0);
	const [level, setLevel] = useState(0);
	const alive = useRef(true);
	const attempt = useRef(0);
	const stopRef = useRef<() => void>(() => {});
	const pulse = useRef(new Animated.Value(1)).current;

	const mode = MODES[modeId];
	const ledger = ledgers[modeId];
	const draft = drafts[modeId];
	const view = useMemo(() => mode.view(ledger, new Date()), [mode, ledger]);
	const rows = useMemo(() => sheetRows(view), [view]);
	const summary = useMemo(
		() => mode.summary(ledger, new Date()),
		[mode, ledger],
	);
	const pending = ledger.filter((record) => record.extraction === null);
	const extractingId = phase.kind === "extracting" ? phase.recordId : null;
	const focused =
		focus?.mode === modeId
			? (ledger.find((record) => record.id === focus.recordId) ?? null)
			: null;
	const asked =
		focused && extractingId !== focused.id
			? mode.ask(focused, ledger, new Date())
			: null;
	const question =
		focused && asked && !closed.has(questionKey(focused.id, asked))
			? asked
			: null;
	const idle = isIdle(phase);
	const recording = phase.kind === "recording";
	const locked = LOCKED_PHASES.has(phase.kind);
	const status = statusFor(phase);
	const detailRow = detailKey
		? (rows.find((row) => row.key === detailKey) ?? null)
		: null;
	const detailSource = detailRow
		? (ledger.find((record) => record.id === detailRow.recordId)?.source ?? "")
		: "";
	const canAdd = idle && draft.trim() !== "";

	const go = useCallback((next: Capture) => {
		phaseRef.current = next;
		setPhase(next);
	}, []);

	const prepare = useCallback(
		async (id: ModeId) => {
			attempt.current += 1;
			const mine = attempt.current;
			const current = () => alive.current && mine === attempt.current;
			go({ kind: "booting" });
			try {
				await engine.prepare(id, (model, progress) => {
					if (current()) go({ kind: "loading", model, progress });
				});
				if (current()) go({ kind: "ready" });
			} catch (error) {
				if (current())
					go({
						kind: "error",
						message: errorMessage(error),
						scope: { kind: "models" },
					});
			}
		},
		[go],
	);

	useEffect(() => {
		alive.current = true;
		void prepare(MODE_IDS[0]);
		return () => {
			alive.current = false;
			void engine.release();
		};
	}, [prepare]);

	useEffect(() => {
		const timer = setTimeout(() => {
			for (const id of MODE_IDS)
				if (savedDrafts.current[id] !== drafts[id])
					composerStores[id].save(drafts[id]);
			savedDrafts.current = drafts;
		}, 400);
		return () => clearTimeout(timer);
	}, [drafts]);

	useEffect(() => {
		if (!recording) {
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
	}, [recording, pulse]);

	useEffect(() => {
		if (!recording) {
			setLevel(0);
			return;
		}
		const started = Date.now();
		const interval = setInterval(() => {
			const elapsed = Date.now() - started;
			let total = Math.floor(elapsed / 1000);
			if (uiOnly) {
				const t = elapsed / 1000;
				const wave =
					0.4 +
					0.3 * Math.sin(t * 5.1) * Math.sin(t * 1.7) +
					0.2 * Math.sin(t * 11);
				setLevel(Math.max(0.05, Math.min(1, wave)));
			} else {
				const recorderStatus = recorder.getStatus();
				if (typeof recorderStatus.durationMillis === "number")
					total = Math.floor(recorderStatus.durationMillis / 1000);
				if (typeof recorderStatus.metering === "number")
					setLevel(
						Math.max(0, Math.min(1, (recorderStatus.metering + 60) / 60)),
					);
			}
			setSeconds(total);
			if (total >= MAX_RECORDING_SECONDS) stopRef.current();
		}, 100);
		return () => clearInterval(interval);
	}, [recording, recorder]);

	const setDraft = (id: ModeId, change: (text: string) => string) =>
		setDrafts((current) => ({ ...current, [id]: change(current[id]) }));

	const fail = (error: unknown, scope: ErrorScope) =>
		go({ kind: "error", message: errorMessage(error), scope });

	// Disk first, so a failed save never leaves the screen showing a record the file lacks.
	const commit = (
		id: ModeId,
		change: (records: readonly LooseRecord[]) => readonly LooseRecord[],
	) => {
		const next = change(ledgersRef.current[id]);
		recordStores[id].save(next);
		const all = { ...ledgersRef.current, [id]: next };
		ledgersRef.current = all;
		setLedgers(all);
	};

	const extract = async (id: ModeId, record: LooseRecord) => {
		go({ kind: "extracting", recordId: record.id });
		try {
			const filled = await engine.extract(id, record.source);
			if (!alive.current) return;
			if (filled === null) {
				go({
					kind: "error",
					message:
						record.extraction === null
							? "Guardé tu texto, pero no encontré qué poner en la hoja. Reintenta o elimínalo."
							: "Guardé tu respuesta, pero no pude volver a llenar la hoja.",
					scope: { kind: "extract", recordId: record.id },
				});
				return;
			}
			commit(id, (records) =>
				records.map((found) =>
					found.id === record.id ? { ...found, ...filled } : found,
				),
			);
			go({ kind: "ready" });
		} catch (error) {
			if (alive.current) fail(error, { kind: "extract", recordId: record.id });
		}
	};

	const submit = () => {
		const text = draft.trim();
		if (!text || !isIdle(phaseRef.current)) return;
		const id = modeId;
		const before = ledgersRef.current[id];
		try {
			if (focused && question) {
				const key = questionKey(focused.id, question);
				const answered = {
					...focused,
					source: mode.answer(focused.source, question, text),
				};
				commit(id, (records) =>
					records.map((found) => (found.id === answered.id ? answered : found)),
				);
				setClosed((current) => new Set(current).add(key));
				setUndo({
					mode: id,
					before,
					label: "Respuesta agregada",
					text,
					reopen: key,
				});
				setDraft(id, () => "");
				void extract(id, answered);
				return;
			}
			const record: LooseRecord = {
				id: makeId(),
				at: Date.now(),
				source: text,
				extraction: null,
				unverified: [],
			};
			commit(id, (records) => [...records, record]);
			setFocus({ mode: id, recordId: record.id });
			setUndo({
				mode: id,
				before,
				label: "Agregado a la hoja",
				text,
				reopen: null,
			});
			setDraft(id, () => "");
			void extract(id, record);
		} catch (error) {
			fail(error, { kind: "capture" });
		}
	};

	const runUndo = () => {
		if (!undo || !isIdle(phaseRef.current)) return;
		try {
			commit(undo.mode, () => undo.before);
			const { text, reopen } = undo;
			if (text !== null)
				setDraft(undo.mode, (current) => (current.trim() ? current : text));
			if (reopen !== null)
				setClosed((current) => {
					const next = new Set(current);
					next.delete(reopen);
					return next;
				});
			setUndo(null);
			go({ kind: "ready" });
		} catch (error) {
			fail(error, { kind: "capture" });
		}
	};

	const retry = (recordId: string) => {
		if (!isIdle(phaseRef.current)) return;
		const record = ledgersRef.current[modeId].find(
			(found) => found.id === recordId,
		);
		if (record) void extract(modeId, record);
	};

	const removeWithUndo = (
		change: (records: readonly LooseRecord[]) => readonly LooseRecord[],
	) => {
		const id = modeId;
		const before = ledgersRef.current[id];
		try {
			commit(id, change);
			setUndo({
				mode: id,
				before,
				label: "Eliminado",
				text: null,
				reopen: null,
			});
			setDetailKey(null);
			if (phaseRef.current.kind === "error") go({ kind: "ready" });
		} catch (error) {
			fail(error, { kind: "capture" });
		}
	};

	const confirmDeleteRecord = (record: LooseRecord) =>
		Alert.alert("¿Eliminar este texto?", "Se borra del teléfono.", [
			{ text: "Cancelar", style: "cancel" },
			{
				text: "Eliminar",
				style: "destructive",
				onPress: () =>
					removeWithUndo((records) =>
						records.filter((found) => found.id !== record.id),
					),
			},
		]);

	const confirmDeleteRow = (row: SheetRow) =>
		Alert.alert("¿Eliminar esta fila?", "Se quita de la hoja.", [
			{ text: "Cancelar", style: "cancel" },
			{
				text: "Eliminar",
				style: "destructive",
				onPress: () =>
					removeWithUndo((records) =>
						records.flatMap((record) => {
							if (record.id !== row.recordId) return [record];
							const left = mode.remove(record, row.index);
							return left === null ? [] : [left];
						}),
					),
			},
		]);

	const saveRow = (
		row: SheetRow,
		edits: ReadonlyArray<readonly [string, string]>,
	) => {
		try {
			commit(modeId, (records) =>
				records.map((record) =>
					record.id !== row.recordId
						? record
						: edits.reduce(
								(edited, [key, value]) =>
									mode.edit(
										edited,
										row.index,
										key,
										value.trim() === "" ? null : value,
									),
								record,
							),
				),
			);
			setUndo(null);
			setDetailKey(null);
		} catch (error) {
			fail(error, { kind: "capture" });
		}
	};

	const pickMode = (id: ModeId) => {
		setMenuOpen(false);
		if (id === modeId || LOCKED_PHASES.has(phaseRef.current.kind)) return;
		setModeId(id);
		setDetailKey(null);
		void prepare(id);
	};

	const startRecording = async () => {
		if (!isIdle(phaseRef.current)) return;
		go({ kind: "starting" });
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
			if (!alive.current) return;
			setSeconds(0);
			go({ kind: "recording" });
		} catch (error) {
			fail(error, { kind: "capture" });
		}
	};

	const stopRecording = async () => {
		if (phaseRef.current.kind !== "recording") return;
		const id = modeId;
		go({ kind: "transcribing" });
		try {
			let audioPath: string | null = null;
			if (!uiOnly) {
				await recorder.stop();
				audioPath = recorder.uri ? toLocalPath(recorder.uri) : null;
			}
			const heard = (await engine.transcribe(audioPath, id)).trim();
			if (!alive.current) return;
			if (!isMeaningfulTranscript(heard)) {
				go({
					kind: "error",
					message: "No escuché voz. Acerca el teléfono e inténtalo otra vez.",
					scope: { kind: "capture" },
				});
				return;
			}
			setDraft(id, (current) =>
				current.trim() ? `${current.trimEnd()} ${heard}` : heard,
			);
			go({ kind: "ready" });
		} catch (error) {
			fail(error, { kind: "capture" });
		}
	};
	stopRef.current = () => void stopRecording();

	const exportSheet = async () => {
		try {
			const file = new File(Paths.cache, mode.csvName);
			if (file.exists) file.delete();
			file.create();
			file.write(mode.csv(ledgersRef.current[modeId], new Date()));
			await shareFile(
				file,
				"text/csv",
				"public.comma-separated-values-text",
				"Exportar a Google Sheets",
			);
		} catch (error) {
			fail(error, { kind: "capture" });
		}
	};

	const skipQuestion = () => {
		if (!focused || !question) return;
		const key = questionKey(focused.id, question);
		setClosed((current) => new Set(current).add(key));
	};

	const errorAction =
		phase.kind !== "error"
			? null
			: phase.scope.kind === "models"
				? { label: "Reintentar", run: () => void prepare(modeId) }
				: phase.scope.kind === "extract"
					? {
							label: "Reintentar",
							run: (
								(recordId: string) => () =>
									retry(recordId)
							)(phase.scope.recordId),
						}
					: null;

	return (
		<KeyboardAvoidingView behavior="padding" style={styles.screen}>
			<StatusBar style="light" />
			<View
				onLayout={(event) =>
					setMenuTop(
						event.nativeEvent.layout.y + event.nativeEvent.layout.height - 6,
					)
				}
				style={[styles.header, { paddingTop: insets.top + 8 }]}
			>
				<PressableBox
					accessibilityHint="Cambia entre Finanzas y Salud"
					accessibilityLabel={`Hoja ${mode.label}`}
					accessibilityState={{ expanded: menuOpen }}
					onPress={() => setMenuOpen((open) => !open)}
					pressedStyle={styles.pressedSoft}
					style={styles.switcher}
				>
					<Text numberOfLines={1} style={styles.title}>
						{mode.label}
					</Text>
					<View style={[styles.chevron, menuOpen && styles.chevronOpen]} />
				</PressableBox>
				<PressableBox
					accessibilityLabel="Ver los modelos que corren en el dispositivo"
					onPress={() => setDeviceOpen(true)}
					pressedStyle={styles.pressedSoft}
					style={styles.localBadge}
				>
					<View style={styles.localDot} />
					<Text style={styles.localText}>En el dispositivo</Text>
				</PressableBox>
			</View>

			{status ? (
				<View
					style={[styles.status, status.tone === "error" && styles.statusError]}
				>
					<View style={styles.statusRow}>
						{status.tone === "busy" ? (
							<ActivityIndicator color={ACCENT} size="small" />
						) : (
							<View style={styles.statusDotError} />
						)}
						<View style={styles.statusCopy}>
							<Text style={styles.statusTitle}>{status.title}</Text>
							{status.caption ? (
								<Text
									style={[
										styles.statusCaption,
										status.tone === "error" && styles.statusCaptionError,
									]}
								>
									{status.caption}
								</Text>
							) : null}
						</View>
						{errorAction ? (
							<PressableBox
								onPress={errorAction.run}
								pressedStyle={styles.pressedSoft}
								style={styles.retryButton}
							>
								<Text style={styles.retryText}>{errorAction.label}</Text>
							</PressableBox>
						) : null}
					</View>
					{status.progress !== null ? (
						<View style={styles.progressBlock}>
							<View style={styles.progressTrack}>
								<View
									style={[
										styles.progressFill,
										{ width: `${status.progress}%` },
									]}
								/>
							</View>
							<Text style={styles.progressValue}>{status.progress}%</Text>
						</View>
					) : null}
				</View>
			) : null}

			<ScrollView
				contentContainerStyle={styles.content}
				keyboardShouldPersistTaps="handled"
				showsVerticalScrollIndicator={false}
			>
				{boot.quarantined ? (
					<View style={styles.notice}>
						<Text style={styles.noticeText}>
							No pude leer una hoja guardada. Aparté ese archivo sin borrarlo y
							empecé esa hoja de cero.
						</Text>
					</View>
				) : null}

				<SummaryStrip items={summary} />

				{pending.map((record) => (
					<PendingCard
						canAct={idle}
						extracting={extractingId === record.id}
						key={record.id}
						onDelete={() => confirmDeleteRecord(record)}
						onRetry={() => retry(record.id)}
						record={record}
					/>
				))}

				<View style={styles.sheetCard}>
					<View style={styles.sheetHead}>
						<View style={styles.flexCopy}>
							<Text style={styles.sheetTitle}>{mode.sheetTitle}</Text>
							<Text style={styles.sheetCount}>
								{count(rows.length, "fila", "filas")}
							</Text>
						</View>
						<PressableBox
							accessibilityLabel={`Exportar ${mode.csvName} a Google Sheets`}
							disabled={rows.length === 0}
							onPress={() => void exportSheet()}
							pressedStyle={styles.pressedStrong}
							style={[
								styles.exportButton,
								rows.length === 0 && styles.buttonOff,
							]}
						>
							<Text
								style={[
									styles.exportText,
									rows.length === 0 && styles.buttonOffText,
								]}
							>
								Exportar a Google Sheets
							</Text>
						</PressableBox>
					</View>
					{rows.length > 0 ? (
						<SheetBody onOpen={(row) => setDetailKey(row.key)} view={view} />
					) : (
						<EmptyState mode={mode} />
					)}
				</View>
			</ScrollView>

			<View
				style={[
					styles.footer,
					{ paddingBottom: Math.max(insets.bottom, 8) + 8 },
				]}
			>
				{question ? (
					<View style={styles.question}>
						<Text style={styles.questionText}>{question}</Text>
						<PressableBox
							accessibilityLabel="Omitir la pregunta"
							onPress={skipQuestion}
							pressedStyle={styles.pressedSoft}
							style={styles.textButton}
						>
							<Text style={styles.textButtonMuted}>Omitir</Text>
						</PressableBox>
					</View>
				) : null}
				{undo && undo.mode === modeId ? (
					<View style={styles.undoBar}>
						<Text style={styles.undoText}>{undo.label}</Text>
						<PressableBox
							accessibilityLabel="Deshacer"
							disabled={!idle}
							onPress={runUndo}
							pressedStyle={styles.pressedSoft}
							style={styles.textButton}
						>
							<Text style={[styles.textButtonLabel, !idle && styles.dimmed]}>
								Deshacer
							</Text>
						</PressableBox>
					</View>
				) : null}
				{recording ? (
					<View style={styles.recordingLine}>
						<LevelMeter level={level} />
						<Text style={styles.recordingClock}>
							{formatClock(seconds)} / {formatClock(MAX_RECORDING_SECONDS)}
						</Text>
					</View>
				) : null}
				<TextInput
					accessibilityLabel={question ?? mode.placeholder}
					multiline
					onChangeText={(text) => setDraft(modeId, () => text)}
					placeholder={question ? "Tu respuesta" : mode.placeholder}
					placeholderTextColor="#6F8574"
					scrollEnabled
					style={styles.input}
					textAlignVertical="top"
					value={draft}
				/>
				<View style={styles.composerRow}>
					<Animated.View style={{ transform: [{ scale: pulse }] }}>
						<PressableBox
							accessibilityLabel={
								recording ? "Detener y transcribir" : "Dictar"
							}
							disabled={!idle && !recording}
							onPress={() =>
								recording ? void stopRecording() : void startRecording()
							}
							pressedStyle={styles.pressedStrong}
							style={[
								styles.micButton,
								recording && styles.micButtonRecording,
								!idle && !recording && styles.buttonOff,
							]}
						>
							{phase.kind === "starting" || phase.kind === "transcribing" ? (
								<ActivityIndicator color={INK} size="small" />
							) : (
								<Text
									style={[
										styles.micGlyph,
										!idle && !recording && styles.buttonOffText,
									]}
								>
									{recording ? "■" : "●"}
								</Text>
							)}
						</PressableBox>
					</Animated.View>
					<PressableBox
						disabled={!canAdd}
						onPress={submit}
						pressedStyle={styles.pressedStrong}
						style={[
							styles.primaryButton,
							styles.flexCopy,
							!canAdd && styles.buttonOff,
						]}
					>
						<Text style={[styles.primaryText, !canAdd && styles.buttonOffText]}>
							{question ? "Responder" : "Agregar a la hoja"}
						</Text>
					</PressableBox>
				</View>
			</View>

			{menuOpen ? (
				<ModeMenu
					current={modeId}
					locked={locked}
					onClose={() => setMenuOpen(false)}
					onPick={pickMode}
					top={menuTop}
				/>
			) : null}

			<DeviceSheet
				bottomInset={insets.bottom}
				onClose={() => setDeviceOpen(false)}
				visible={deviceOpen}
			/>

			{detailRow ? (
				<DetailSheet
					bottomInset={insets.bottom}
					key={detailRow.key}
					mode={mode}
					onClose={() => setDetailKey(null)}
					onDelete={() => confirmDeleteRow(detailRow)}
					onSave={(edits) => saveRow(detailRow, edits)}
					row={detailRow}
					source={detailSource}
				/>
			) : null}
		</KeyboardAvoidingView>
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
	screen: { backgroundColor: "#0B0F0E", flex: 1 },
	content: { gap: 12, paddingBottom: 20, paddingHorizontal: 16, paddingTop: 4 },
	flexCopy: { flex: 1, minWidth: 0 },
	dimmed: { opacity: 0.4 },
	header: {
		alignItems: "center",
		flexDirection: "row",
		gap: 10,
		paddingBottom: 8,
		paddingHorizontal: 16,
	},
	switcher: {
		alignItems: "center",
		flexDirection: "row",
		flexShrink: 1,
		gap: 6,
		marginRight: "auto",
		minHeight: 48,
		paddingRight: 8,
	},
	title: {
		color: "#F1F7EE",
		flexShrink: 1,
		fontSize: 28,
		fontWeight: "700",
		letterSpacing: -0.6,
	},
	chevron: {
		borderBottomWidth: 2,
		borderColor: "#8CA39D",
		borderRightWidth: 2,
		height: 10,
		marginHorizontal: 4,
		marginTop: -5,
		transform: [{ rotate: "45deg" }],
		width: 10,
	},
	chevronOpen: { marginTop: 5, transform: [{ rotate: "-135deg" }] },
	localBadge: {
		alignItems: "center",
		backgroundColor: "#161F12",
		borderColor: "#34482A",
		borderRadius: 22,
		borderWidth: 1,
		flexDirection: "row",
		minHeight: 44,
		paddingHorizontal: 12,
	},
	localDot: {
		backgroundColor: ACCENT,
		borderRadius: 4,
		height: 7,
		marginRight: 6,
		width: 7,
	},
	localText: { color: "#BFD9D3", fontSize: 12, fontWeight: "700" },
	menu: {
		backgroundColor: "#141C1A",
		borderColor: "#2A3A36",
		borderRadius: 16,
		borderWidth: 1,
		elevation: 12,
		left: 12,
		paddingVertical: 6,
		position: "absolute",
		shadowColor: "#000",
		shadowOffset: { height: 8, width: 0 },
		shadowOpacity: 0.4,
		shadowRadius: 18,
		width: 290,
	},
	menuOption: {
		alignItems: "center",
		flexDirection: "row",
		gap: 12,
		minHeight: 60,
		paddingHorizontal: 16,
		paddingVertical: 8,
	},
	menuTitle: { color: "#F1F7EE", fontSize: 16, fontWeight: "700" },
	menuSubtitle: { color: "#8CA39D", fontSize: 13, marginTop: 2 },
	menuCheck: { color: ACCENT, fontSize: 18, fontWeight: "800", width: 20 },
	menuHint: {
		color: "#8CA39D",
		fontSize: 12,
		paddingBottom: 8,
		paddingHorizontal: 16,
	},
	status: {
		backgroundColor: "#111816",
		borderColor: "#1F2C28",
		borderRadius: 14,
		borderWidth: 1,
		marginBottom: 8,
		marginHorizontal: 16,
		paddingHorizontal: 12,
		paddingVertical: 10,
	},
	statusError: { borderColor: "#6A4A32" },
	statusRow: { alignItems: "center", flexDirection: "row", gap: 10 },
	statusDotError: {
		backgroundColor: "#F0B37A",
		borderRadius: 5,
		height: 10,
		width: 10,
	},
	statusCopy: { flex: 1 },
	statusTitle: { color: "#EDF5EA", fontSize: 14, fontWeight: "700" },
	statusCaption: {
		color: "#9CB3A0",
		fontSize: 12,
		lineHeight: 17,
		marginTop: 2,
	},
	statusCaptionError: { color: "#F0B37A" },
	progressBlock: { alignItems: "center", flexDirection: "row", marginTop: 8 },
	progressTrack: {
		backgroundColor: "#22322E",
		borderRadius: 3,
		flex: 1,
		height: 6,
		overflow: "hidden",
	},
	progressFill: { backgroundColor: ACCENT, borderRadius: 3, height: "100%" },
	progressValue: {
		color: ACCENT,
		fontSize: 12,
		fontVariant: ["tabular-nums"],
		fontWeight: "800",
		marginLeft: 10,
		minWidth: 40,
		textAlign: "right",
	},
	retryButton: {
		alignItems: "center",
		backgroundColor: "#2E2117",
		borderRadius: 12,
		justifyContent: "center",
		minHeight: 44,
		paddingHorizontal: 14,
	},
	retryText: { color: "#F0B37A", fontSize: 13, fontWeight: "700" },
	notice: {
		backgroundColor: "#1B2419",
		borderColor: "#3C4A2E",
		borderRadius: 14,
		borderWidth: 1,
		padding: 12,
	},
	noticeText: { color: "#D9CB9C", fontSize: 12, lineHeight: 18 },
	summary: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
	tile: {
		backgroundColor: "#111816",
		borderColor: "#1F2C28",
		borderRadius: 14,
		borderWidth: 1,
		flexGrow: 1,
		paddingHorizontal: 12,
		paddingVertical: 9,
	},
	tileLabel: { color: "#8CA39D", fontSize: 12, fontWeight: "600" },
	tileValue: {
		fontSize: 18,
		fontVariant: ["tabular-nums"],
		fontWeight: "800",
		marginTop: 2,
	},
	sheetCard: {
		backgroundColor: "#0F1614",
		borderColor: "#22312D",
		borderRadius: 18,
		borderWidth: 1,
		padding: 12,
	},
	sheetHead: {
		alignItems: "center",
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 10,
		marginBottom: 10,
	},
	sheetTitle: { color: "#F1F7EE", fontSize: 18, fontWeight: "700" },
	sheetCount: { color: "#8CA39D", fontSize: 12, marginTop: 1 },
	exportButton: {
		alignItems: "center",
		backgroundColor: ACCENT,
		borderRadius: 12,
		justifyContent: "center",
		minHeight: 44,
		paddingHorizontal: 14,
	},
	exportText: { color: INK, fontSize: 14, fontWeight: "800" },
	tableHead: {
		borderBottomColor: "#22312D",
		borderBottomWidth: 1,
		flexDirection: "row",
		gap: 8,
		paddingBottom: 6,
	},
	th: {
		color: "#8CA39D",
		fontSize: 11,
		fontWeight: "800",
		letterSpacing: 0.6,
		textTransform: "uppercase",
	},
	tr: {
		alignItems: "center",
		borderBottomColor: "#1A2522",
		borderBottomWidth: StyleSheet.hairlineWidth,
		flexDirection: "row",
		gap: 8,
		minHeight: 48,
		paddingVertical: 8,
	},
	td: { color: "#E3EEEA", fontSize: 14, lineHeight: 19 },
	tdMuted: { color: "#A9BDB6", fontSize: 13 },
	amount: { fontVariant: ["tabular-nums"], fontWeight: "700" },
	colDate: { width: 46 },
	colTitle: { flex: 1.4, minWidth: 0 },
	colSub: { flex: 1, minWidth: 0 },
	colAmount: { textAlign: "right", width: 92 },
	flag: { color: TONE_COLOR.estimated, fontSize: 11, fontWeight: "700" },
	cards: { gap: 10 },
	clientCard: {
		backgroundColor: "#111816",
		borderColor: "#1F2C28",
		borderRadius: 14,
		borderWidth: 1,
		paddingHorizontal: 12,
		paddingVertical: 10,
	},
	clientName: {
		color: "#F1F7EE",
		fontSize: 16,
		fontWeight: "700",
		lineHeight: 22,
	},
	clientMeta: { color: "#8CA39D", fontSize: 12, lineHeight: 17, marginTop: 1 },
	unitRow: {
		borderTopColor: "#1D2926",
		borderTopWidth: StyleSheet.hairlineWidth,
		justifyContent: "center",
		marginTop: 8,
		minHeight: 48,
		paddingTop: 8,
	},
	unitLine: { alignItems: "center", flexDirection: "row", gap: 10 },
	unitTitle: { color: "#E3EEEA", fontSize: 14, fontWeight: "700" },
	unitDetail: { color: "#A9BDB6", fontSize: 12, lineHeight: 17, marginTop: 1 },
	chip: {
		borderRadius: 9,
		borderWidth: 1,
		paddingHorizontal: 8,
		paddingVertical: 3,
	},
	chipText: { fontSize: 11, fontWeight: "700" },
	tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
	empty: { gap: 10, paddingVertical: 4 },
	emptyTitle: { color: "#EDF5EA", fontSize: 16, fontWeight: "700" },
	exampleQuote: {
		backgroundColor: "#1A2614",
		borderRadius: 14,
		borderTopLeftRadius: 4,
		padding: 12,
	},
	exampleQuoteText: { color: "#D5E6E0", fontSize: 14, lineHeight: 21 },
	emptyArrow: {
		color: "#8CA39D",
		fontSize: 12,
		fontWeight: "700",
		textAlign: "center",
	},
	ghost: { opacity: 0.55 },
	pendingCard: {
		backgroundColor: "#111816",
		borderColor: "#3D5230",
		borderRadius: 14,
		borderStyle: "dashed",
		borderWidth: 1,
		gap: 6,
		paddingHorizontal: 12,
		paddingVertical: 10,
	},
	cardLabel: {
		color: "#8CA39D",
		fontSize: 10,
		fontWeight: "800",
		letterSpacing: 1.2,
	},
	pendingText: { color: "#C9DAD4", fontSize: 14, lineHeight: 20 },
	pendingActions: { flexDirection: "row", gap: 12 },
	inlineBusy: {
		alignItems: "center",
		flexDirection: "row",
		gap: 8,
		minHeight: 44,
	},
	inlineBusyText: { color: "#A9BDB6", fontSize: 13 },
	textButton: {
		alignItems: "center",
		alignSelf: "flex-start",
		justifyContent: "center",
		minHeight: 44,
		minWidth: 44,
		paddingHorizontal: 4,
	},
	textButtonLabel: { color: ACCENT, fontSize: 14, fontWeight: "800" },
	textButtonMuted: { color: "#A9BDB6", fontSize: 14, fontWeight: "700" },
	textButtonDanger: { color: "#F3A27A", fontSize: 14, fontWeight: "800" },
	footer: {
		backgroundColor: "#0D1210",
		borderTopColor: "#1D2A26",
		borderTopWidth: 1,
		gap: 8,
		paddingHorizontal: 16,
		paddingTop: 10,
	},
	question: {
		alignItems: "center",
		backgroundColor: "#1A2614",
		borderRadius: 12,
		flexDirection: "row",
		gap: 8,
		paddingLeft: 12,
		paddingRight: 8,
	},
	questionText: {
		color: "#EDF5EA",
		flex: 1,
		fontSize: 14,
		fontWeight: "700",
		lineHeight: 20,
		paddingVertical: 8,
	},
	undoBar: {
		alignItems: "center",
		flexDirection: "row",
		justifyContent: "space-between",
		paddingLeft: 4,
	},
	undoText: { color: "#A9BDB6", flexShrink: 1, fontSize: 13 },
	recordingLine: {
		alignItems: "center",
		flexDirection: "row",
		gap: 12,
		justifyContent: "center",
	},
	recordingClock: {
		color: "#F6B8A8",
		fontSize: 13,
		fontVariant: ["tabular-nums"],
		fontWeight: "700",
	},
	meter: { alignItems: "center", flexDirection: "row", gap: 3, height: 26 },
	meterBar: { backgroundColor: "#F6B8A8", borderRadius: 2, width: 4 },
	input: {
		backgroundColor: "#151D1B",
		borderColor: "#2A3A36",
		borderRadius: 16,
		borderWidth: 1,
		color: "#EDF5EA",
		fontSize: 15,
		lineHeight: 21,
		maxHeight: 132,
		minHeight: 48,
		paddingHorizontal: 14,
		paddingVertical: 12,
	},
	composerRow: { alignItems: "center", flexDirection: "row", gap: 10 },
	micButton: {
		alignItems: "center",
		backgroundColor: ACCENT,
		borderRadius: 26,
		height: 52,
		justifyContent: "center",
		width: 52,
	},
	micButtonRecording: { backgroundColor: "#F6B8A8" },
	micGlyph: { color: INK, fontSize: 20, fontWeight: "800" },
	primaryButton: {
		alignItems: "center",
		backgroundColor: ACCENT,
		borderRadius: 14,
		justifyContent: "center",
		minHeight: 52,
		paddingHorizontal: 16,
	},
	primaryText: { color: INK, fontSize: 15, fontWeight: "800" },
	secondaryButton: {
		alignItems: "center",
		borderColor: "#2A3A36",
		borderRadius: 14,
		borderWidth: 1,
		justifyContent: "center",
		minHeight: 52,
		paddingHorizontal: 18,
	},
	secondaryText: { color: "#BFD9D3", fontSize: 15, fontWeight: "700" },
	buttonOff: { backgroundColor: "#1F2B28" },
	buttonOffText: { color: "#6F8574" },
	sheetScreen: { flex: 1, justifyContent: "flex-end" },
	backdrop: { backgroundColor: "rgba(0, 0, 0, 0.55)" },
	sheet: {
		backgroundColor: "#111816",
		borderColor: "#1F2C28",
		borderTopLeftRadius: 22,
		borderTopRightRadius: 22,
		borderWidth: 1,
		gap: 12,
		paddingHorizontal: 18,
		paddingTop: 18,
	},
	detailSheet: { maxHeight: "88%" },
	detailContent: { gap: 12, paddingBottom: 8 },
	detailActions: { flexDirection: "row", gap: 10 },
	eyebrow: {
		color: ACCENT,
		fontSize: 10,
		fontWeight: "800",
		letterSpacing: 1.4,
	},
	sheetHeadline: {
		color: "#EDF5EA",
		fontSize: 16,
		fontWeight: "700",
		lineHeight: 22,
	},
	modelRow: {
		borderTopColor: "#1D2926",
		borderTopWidth: StyleSheet.hairlineWidth,
		paddingTop: 10,
	},
	modelPurpose: {
		color: "#8CA39D",
		fontSize: 10,
		fontWeight: "800",
		letterSpacing: 1,
		textTransform: "uppercase",
	},
	modelLabel: {
		color: "#E3EEEA",
		fontSize: 14,
		fontWeight: "700",
		marginTop: 3,
	},
	modelMeta: { color: "#A9BDB6", fontSize: 12, marginTop: 2 },
	deviceLine: { color: "#8CA39D", fontSize: 12, lineHeight: 17 },
	sheetHint: {
		color: "#8CA39D",
		fontSize: 12,
		marginTop: -4,
		textAlign: "center",
	},
	sheetClose: { alignItems: "center", justifyContent: "center", minHeight: 44 },
	sheetCloseText: { color: "#BFD9D3", fontSize: 14, fontWeight: "700" },
	factors: {
		backgroundColor: "#0D1412",
		borderRadius: 10,
		gap: 3,
		padding: 10,
	},
	factorsTitle: { color: "#E3EEEA", fontSize: 13, fontWeight: "700" },
	factorsText: { color: "#A9BDB6", fontSize: 12, lineHeight: 17 },
	field: { gap: 4 },
	fieldLabel: { color: "#8CA39D", fontSize: 12, fontWeight: "700" },
	fieldValue: { color: "#E3EEEA", fontSize: 14, lineHeight: 20 },
	unverifiedText: {
		color: TONE_COLOR.estimated,
		fontSize: 12,
		fontWeight: "600",
	},
	fieldInput: {
		backgroundColor: "#151D1B",
		borderColor: "#2A3A36",
		borderRadius: 12,
		borderWidth: 1,
		color: "#EDF5EA",
		fontSize: 15,
		minHeight: 44,
		paddingHorizontal: 12,
	},
	fieldInputFlag: { borderColor: "#7A6230" },
	options: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
	option: {
		alignItems: "center",
		borderColor: "#2A3A36",
		borderRadius: 12,
		borderWidth: 1,
		justifyContent: "center",
		minHeight: 44,
		paddingHorizontal: 12,
	},
	optionOn: { backgroundColor: "#26361A", borderColor: ACCENT },
	optionText: { color: "#BFD9D3", fontSize: 13, fontWeight: "600" },
	optionTextOn: { color: ACCENT },
	pressedSoft: { opacity: 0.6 },
	pressedStrong: { opacity: 0.82 },
	pressedRow: { opacity: 0.7 },
});
