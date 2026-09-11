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
	Image,
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
import { HARNESS, newSheetJob, updateSheetJob } from "./src/harness";
import { ALL_MODELS, type ModelSpec } from "./src/models";
import { DEVICE, hasPerfLog, perfLogFile } from "./src/perf-log";
import {
	appendRows,
	byRecent,
	cellText,
	createSheet,
	csvFileName,
	EMPTY_LIBRARY,
	editCell,
	type Library,
	MODE_IDS,
	type ModeId,
	type Pending,
	type Row,
	relativeTime,
	removeRow,
	renameSheet,
	type Sheet,
	sheetSummary,
	type Target,
	toCsv,
} from "./src/spreadsheet";
import { openLibraryStore, openTextStore } from "./src/store";

type ErrorScope =
	| { kind: "models" }
	| { kind: "capture" }
	| { kind: "generate"; pendingId: string };

type Capture =
	| { kind: "booting" }
	| { kind: "loading"; model: ModelSpec; progress: number }
	| { kind: "ready" }
	| { kind: "starting" }
	| { kind: "recording" }
	| { kind: "transcribing" }
	| { kind: "generating"; pendingId: string; target: Target }
	| { kind: "error"; message: string; scope: ErrorScope };

type Screen = { kind: "library" } | { kind: "sheet"; sheetId: string };

type Libraries = Record<ModeId, Library>;

type Undo = {
	mode: ModeId;
	before: Library;
	label: string;
	text: string | null;
};

type Editing = { rowId: string; column: number };

type Option = { label: string; danger?: boolean; run: () => void };

type StatusView = {
	title: string;
	caption: string | null;
	tone: "busy" | "error";
	progress: number | null;
};

const BRAND_MARK = require("./assets/brand/v2s-mark-192.png");

const uiOnly = process.env.EXPO_PUBLIC_UI_ONLY === "true";
const engine = uiOnly ? createDemoEngine() : createQvacEngine();
const filePrefix = uiOnly ? "demo-" : "";

const byMode = <T,>(make: (id: ModeId) => T): Record<ModeId, T> => ({
	finanzas: make("finanzas"),
	salud: make("salud"),
});

const libraryStores = byMode((id) =>
	openLibraryStore(`${filePrefix}library-${id}`),
);
const composerStores = byMode((id) =>
	openTextStore(`${filePrefix}composer-${id}`),
);

const ACCENT = "#B8F56F";
const INK = "#122014";
const METER_BARS = 9;
const MAX_RECORDING_SECONDS = 600;
const MIN_COLUMN = 96;
const MAX_COLUMN = 220;

const LOCKED_PHASES: ReadonlySet<Capture["kind"]> = new Set([
	"starting",
	"recording",
	"transcribing",
	"generating",
]);

const ERROR_TITLE: Record<ErrorScope["kind"], string> = {
	models: "No se pudo cargar el modelo",
	capture: "No pude usar esa captura",
	generate: "No pude generar la hoja",
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
const isIdle = (phase: Capture) =>
	phase.kind === "ready" ||
	(phase.kind === "error" && phase.scope.kind !== "models");
const count = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;
const formatNumber = (value: number) => String(Math.round(value * 100) / 100);
const findSheet = (library: Library, sheetId: string) =>
	library.sheets.find((sheet) => sheet.id === sheetId) ?? null;

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
		case "generating":
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
		case "error":
			return phase.scope.kind === "generate"
				? null
				: {
						title: ERROR_TITLE[phase.scope.kind],
						caption: phase.message,
						tone: "error",
						progress: null,
					};
	}
};

const bootLibraries = (): { libraries: Libraries; quarantined: boolean } => {
	let quarantined = false;
	const libraries = byMode((id) => {
		const read = libraryStores[id].load();
		if (read.kind === "ok") return read.library;
		if (read.kind === "quarantined") quarantined = true;
		return EMPTY_LIBRARY;
	});
	return { libraries, quarantined };
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

const columnWidths = (sheet: Sheet) =>
	sheet.columns.map((column, index) => {
		const longest = sheet.rows.reduce(
			(max, row) => Math.max(max, cellText(row.cells[index]).length),
			column.length,
		);
		return Math.min(MAX_COLUMN, Math.max(MIN_COLUMN, longest * 7.5 + 28));
	});

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
				accessibilityLabel="Cerrar el menú de modos"
				onPress={onClose}
				style={StyleSheet.absoluteFill}
			/>
			<View style={[styles.menu, { top }]}>
				{MODE_IDS.map((id) => {
					const option = HARNESS[id];
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
						Termina la captura para cambiar de modo.
					</Text>
				) : null}
			</View>
		</View>
	);
}

function BottomSheet({
	visible,
	bottomInset,
	onClose,
	children,
}: {
	visible: boolean;
	bottomInset: number;
	onClose: () => void;
	children: ReactNode;
}) {
	return (
		<Modal
			animationType="fade"
			navigationBarTranslucent
			onRequestClose={onClose}
			statusBarTranslucent
			transparent
			visible={visible}
		>
			<KeyboardAvoidingView behavior="padding" style={styles.sheetScreen}>
				<Pressable
					accessibilityLabel="Cerrar"
					onPress={onClose}
					style={[StyleSheet.absoluteFill, styles.backdrop]}
				/>
				<View style={[styles.sheet, { paddingBottom: bottomInset + 18 }]}>
					{children}
				</View>
			</KeyboardAvoidingView>
		</Modal>
	);
}

function OptionsSheet({
	title,
	options,
	bottomInset,
	onClose,
}: {
	title: string;
	options: readonly Option[];
	bottomInset: number;
	onClose: () => void;
}) {
	return (
		<BottomSheet bottomInset={bottomInset} onClose={onClose} visible>
			<Text numberOfLines={2} style={styles.sheetTitle}>
				{title}
			</Text>
			<ScrollView style={styles.optionList}>
				{options.map((option) => (
					<PressableBox
						key={option.label}
						onPress={() => {
							onClose();
							option.run();
						}}
						pressedStyle={styles.pressedRow}
						style={styles.optionRow}
					>
						<Text
							numberOfLines={2}
							style={[styles.optionText, option.danger && styles.dangerText]}
						>
							{option.label}
						</Text>
					</PressableBox>
				))}
			</ScrollView>
			<PressableBox
				onPress={onClose}
				pressedStyle={styles.pressedSoft}
				style={styles.sheetClose}
			>
				<Text style={styles.sheetCloseText}>Cancelar</Text>
			</PressableBox>
		</BottomSheet>
	);
}

function RenameSheet({
	name,
	bottomInset,
	onClose,
	onSave,
}: {
	name: string;
	bottomInset: number;
	onClose: () => void;
	onSave: (name: string) => void;
}) {
	const [value, setValue] = useState(name);
	const canSave = value.trim() !== "" && value.trim() !== name;
	return (
		<BottomSheet bottomInset={bottomInset} onClose={onClose} visible>
			<Text style={styles.sheetTitle}>Renombrar hoja</Text>
			<TextInput
				accessibilityLabel="Nombre de la hoja"
				autoFocus
				onChangeText={setValue}
				onSubmitEditing={() => canSave && onSave(value.trim())}
				placeholder="Nombre"
				placeholderTextColor="#6F8574"
				returnKeyType="done"
				style={styles.fieldInput}
				value={value}
			/>
			<View style={styles.detailActions}>
				<PressableBox
					onPress={onClose}
					pressedStyle={styles.pressedSoft}
					style={styles.secondaryButton}
				>
					<Text style={styles.secondaryText}>Cancelar</Text>
				</PressableBox>
				<PressableBox
					disabled={!canSave}
					onPress={() => onSave(value.trim())}
					pressedStyle={styles.pressedStrong}
					style={[
						styles.primaryButton,
						styles.flexCopy,
						!canSave && styles.buttonOff,
					]}
				>
					<Text style={[styles.primaryText, !canSave && styles.buttonOffText]}>
						Guardar
					</Text>
				</PressableBox>
			</View>
		</BottomSheet>
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
		<BottomSheet bottomInset={bottomInset} onClose={onClose} visible={visible}>
			<View style={styles.brandRow}>
				<Image source={BRAND_MARK} style={styles.brandLarge} />
				<View style={styles.flexCopy}>
					<Text style={styles.brandName}>V2S</Text>
					<Text style={styles.eyebrow}>EN EL DISPOSITIVO</Text>
				</View>
			</View>
			<Text style={styles.sheetHeadline}>
				Nada sale del teléfono. Los modelos corren aquí, sin internet después de
				la descarga.
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
				<Text style={[styles.primaryText, !canShare && styles.buttonOffText]}>
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
		</BottomSheet>
	);
}

function PendingBand({
	pending,
	generating,
	error,
	canAct,
	onRetry,
	onDiscard,
}: {
	pending: Pending;
	generating: boolean;
	error: string | null;
	canAct: boolean;
	onRetry: () => void;
	onDiscard: () => void;
}) {
	return (
		<View style={[styles.pendingBand, error !== null && styles.pendingError]}>
			<Text style={styles.cardLabel}>
				{generating
					? pending.target === "new"
						? "CREANDO LA HOJA"
						: "AGREGANDO FILAS"
					: "GUARDADO, SIN PROCESAR"}
			</Text>
			<Text numberOfLines={4} style={styles.pendingText}>
				{pending.text}
			</Text>
			{error ? <Text style={styles.pendingErrorText}>{error}</Text> : null}
			{generating ? (
				<View style={styles.inlineBusy}>
					<ActivityIndicator color={ACCENT} size="small" />
					<Text style={styles.inlineBusyText}>El modelo está leyendo</Text>
				</View>
			) : (
				<View style={styles.pendingActions}>
					<PressableBox
						accessibilityLabel="Intentar otra vez"
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
						onPress={onDiscard}
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

function LibraryScreen({
	sheets,
	now,
	onOpen,
	onMenu,
	children,
}: {
	sheets: readonly Sheet[];
	now: number;
	onOpen: (sheet: Sheet) => void;
	onMenu: (sheet: Sheet) => void;
	children: ReactNode;
}) {
	return (
		<ScrollView
			contentContainerStyle={styles.content}
			keyboardShouldPersistTaps="handled"
			showsVerticalScrollIndicator={false}
		>
			<Text style={styles.screenTitle}>Mis hojas</Text>
			{children}
			{sheets.length === 0 ? (
				<Text style={styles.emptyLine}>
					Graba o escribe algo. V2S crea la hoja.
				</Text>
			) : (
				sheets.map((sheet) => (
					<PressableBox
						accessibilityHint="Abre la hoja"
						delayLongPress={350}
						key={sheet.id}
						onLongPress={() => onMenu(sheet)}
						onPress={() => onOpen(sheet)}
						pressedStyle={styles.pressedRow}
						style={styles.libraryRow}
					>
						<View style={styles.flexCopy}>
							<Text style={styles.libraryName}>{sheet.name}</Text>
							<Text style={styles.libraryMeta}>
								{count(sheet.rows.length, "fila", "filas")} ·{" "}
								{count(sheet.columns.length, "columna", "columnas")} ·{" "}
								{relativeTime(sheet.updatedAt, now)}
							</Text>
						</View>
						<PressableBox
							accessibilityLabel={`Opciones de ${sheet.name}`}
							hitSlop={8}
							onPress={() => onMenu(sheet)}
							pressedStyle={styles.pressedSoft}
							style={styles.moreButton}
						>
							<Text style={styles.moreGlyph}>⋯</Text>
						</PressableBox>
					</PressableBox>
				))
			)}
		</ScrollView>
	);
}

function CellEditor({
	value,
	width,
	numeric,
	onDone,
}: {
	value: string;
	width: number;
	numeric: boolean;
	onDone: (value: string) => void;
}) {
	const [text, setText] = useState(value);
	const finished = useRef(false);
	const finish = () => {
		if (finished.current) return;
		finished.current = true;
		onDone(text);
	};
	return (
		<TextInput
			accessibilityLabel="Editar celda"
			autoFocus
			blurOnSubmit
			keyboardType={numeric ? "decimal-pad" : "default"}
			onBlur={finish}
			onChangeText={setText}
			onSubmitEditing={finish}
			returnKeyType="done"
			selectTextOnFocus
			style={[styles.cellInput, { width }]}
			value={text}
		/>
	);
}

function Table({
	sheet,
	editing,
	onEditStart,
	onEditDone,
	onRowMenu,
}: {
	sheet: Sheet;
	editing: Editing | null;
	onEditStart: (edit: Editing) => void;
	onEditDone: (edit: Editing, value: string) => void;
	onRowMenu: (row: Row) => void;
}) {
	const widths = useMemo(() => columnWidths(sheet), [sheet]);
	const summary = useMemo(() => sheetSummary(sheet), [sheet]);
	const flagged = sheet.rows.filter((row) => row.unverified.length > 0).length;
	return (
		<View style={styles.tableFrame}>
			<ScrollView
				horizontal
				keyboardShouldPersistTaps="handled"
				showsHorizontalScrollIndicator
			>
				<View>
					<View style={styles.tableHead}>
						{sheet.columns.map((column, index) => (
							<Text
								// biome-ignore lint/suspicious/noArrayIndexKey: a column is its position; two columns may share a name.
								key={`${index}-${column}`}
								numberOfLines={1}
								style={[styles.th, { width: widths[index] }]}
							>
								{column}
							</Text>
						))}
					</View>
					<ScrollView
						keyboardShouldPersistTaps="handled"
						nestedScrollEnabled
						showsVerticalScrollIndicator={false}
					>
						{sheet.rows.map((row, rowIndex) => (
							<Pressable
								accessibilityHint="Mantén presionado para ver opciones"
								delayLongPress={350}
								key={row.id}
								onLongPress={() => onRowMenu(row)}
								style={[styles.tr, rowIndex % 2 === 1 && styles.trZebra]}
							>
								{row.cells.map((cell, column) => {
									const active =
										editing?.rowId === row.id && editing.column === column;
									const unverified = row.unverified.includes(column);
									return active ? (
										<CellEditor
											// biome-ignore lint/suspicious/noArrayIndexKey: a cell is its column position.
											key={`${row.id}-${column}`}
											numeric={typeof cell === "number"}
											onDone={(value) =>
												onEditDone({ rowId: row.id, column }, value)
											}
											value={cellText(cell)}
											width={widths[column]}
										/>
									) : (
										<Pressable
											accessibilityLabel={`${sheet.columns[column]}: ${cellText(cell) || "vacío"}`}
											delayLongPress={350}
											// biome-ignore lint/suspicious/noArrayIndexKey: a cell is its column position.
											key={`${row.id}-${column}`}
											onLongPress={() => onRowMenu(row)}
											onPress={() => onEditStart({ rowId: row.id, column })}
											style={[styles.td, { width: widths[column] }]}
										>
											<Text
												numberOfLines={2}
												style={[
													styles.tdText,
													typeof cell === "number" && styles.tdNumber,
													unverified && styles.tdFlagged,
												]}
											>
												{cellText(cell)}
											</Text>
											{unverified ? <View style={styles.flagDot} /> : null}
										</Pressable>
									);
								})}
							</Pressable>
						))}
					</ScrollView>
					<View style={styles.tableFoot}>
						{sheet.columns.map((column, index) => (
							<Text
								// biome-ignore lint/suspicious/noArrayIndexKey: a column is its position; two columns may share a name.
								key={`${index}-${column}`}
								numberOfLines={1}
								style={[
									styles.tf,
									{ width: widths[index] },
									summary.totals[index] !== null && styles.tdNumber,
								]}
							>
								{index === 0
									? count(summary.rows, "fila", "filas")
									: summary.totals[index] !== null
										? formatNumber(summary.totals[index])
										: ""}
							</Text>
						))}
					</View>
				</View>
			</ScrollView>
			{flagged > 0 ? (
				<View style={styles.legend}>
					<View style={styles.flagDotLegend} />
					<Text style={styles.legendText}>
						Revisar: {count(flagged, "fila tiene", "filas tienen")} un número
						que no aparece en el texto. Toca la celda para corregirla.
					</Text>
				</View>
			) : null}
		</View>
	);
}

function SheetScreen({
	sheet,
	editing,
	onBack,
	onRename,
	onExport,
	onEditStart,
	onEditDone,
	onRowMenu,
	children,
}: {
	sheet: Sheet;
	editing: Editing | null;
	onBack: () => void;
	onRename: () => void;
	onExport: () => void;
	onEditStart: (edit: Editing) => void;
	onEditDone: (edit: Editing, value: string) => void;
	onRowMenu: (row: Row) => void;
	children: ReactNode;
}) {
	return (
		<View style={styles.sheetScreenBody}>
			<View style={styles.sheetHead}>
				<PressableBox
					accessibilityLabel="Volver a mis hojas"
					onPress={onBack}
					pressedStyle={styles.pressedSoft}
					style={styles.backButton}
				>
					<View style={styles.backChevron} />
				</PressableBox>
				<PressableBox
					accessibilityHint="Cambia el nombre de la hoja"
					onPress={onRename}
					pressedStyle={styles.pressedSoft}
					style={styles.flexCopy}
				>
					<Text numberOfLines={2} style={styles.sheetName}>
						{sheet.name}
					</Text>
				</PressableBox>
				<PressableBox
					accessibilityLabel="Exportar a Google Sheets"
					disabled={sheet.rows.length === 0}
					onPress={onExport}
					pressedStyle={styles.pressedStrong}
					style={[
						styles.exportButton,
						sheet.rows.length === 0 && styles.buttonOff,
					]}
				>
					<Text
						style={[
							styles.exportText,
							sheet.rows.length === 0 && styles.buttonOffText,
						]}
					>
						Exportar
					</Text>
				</PressableBox>
			</View>
			{children}
			<Table
				editing={editing}
				onEditDone={onEditDone}
				onEditStart={onEditStart}
				onRowMenu={onRowMenu}
				sheet={sheet}
			/>
		</View>
	);
}

function Assistant() {
	const recorder = useAudioRecorder(RECORDING_OPTIONS);
	const insets = useSafeAreaInsets();
	const [boot] = useState(bootLibraries);
	const [libraries, setLibraries] = useState<Libraries>(boot.libraries);
	const librariesRef = useRef<Libraries>(boot.libraries);
	const [modeId, setModeId] = useState<ModeId>(MODE_IDS[0]);
	const [screen, setScreen] = useState<Screen>({ kind: "library" });
	const [target, setTarget] = useState<Target>("new");
	const [drafts, setDrafts] = useState<Record<ModeId, string>>(() =>
		byMode((id) => composerStores[id].load()),
	);
	const savedDrafts = useRef(drafts);
	const [phase, setPhase] = useState<Capture>({ kind: "booting" });
	// Handlers read the phase from here: two taps in one frame both see the stale render value.
	const phaseRef = useRef<Capture>(phase);
	const [undo, setUndo] = useState<Undo | null>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const [menuTop, setMenuTop] = useState(0);
	const [deviceOpen, setDeviceOpen] = useState(false);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [sheetMenu, setSheetMenu] = useState<Sheet | null>(null);
	const [rowMenu, setRowMenu] = useState<Row | null>(null);
	const [renaming, setRenaming] = useState<Sheet | null>(null);
	const [editing, setEditing] = useState<Editing | null>(null);
	const [seconds, setSeconds] = useState(0);
	const [level, setLevel] = useState(0);
	const alive = useRef(true);
	const attempt = useRef(0);
	const stopRef = useRef<() => void>(() => {});
	const pulse = useRef(new Animated.Value(1)).current;

	const harness = HARNESS[modeId];
	const library = libraries[modeId];
	const draft = drafts[modeId];
	const sheets = useMemo(() => byRecent(library.sheets), [library]);
	const openSheet =
		screen.kind === "sheet" ? findSheet(library, screen.sheetId) : null;
	const targetSheet =
		target === "new" ? null : findSheet(library, target.sheetId);
	const effectiveTarget: Target = targetSheet ? target : "new";
	const idle = isIdle(phase);
	const recording = phase.kind === "recording";
	const locked = LOCKED_PHASES.has(phase.kind);
	const status = statusFor(phase);
	const canSubmit = idle && draft.trim() !== "";
	const generatingId = phase.kind === "generating" ? phase.pendingId : null;
	const generateError =
		phase.kind === "error" && phase.scope.kind === "generate"
			? { pendingId: phase.scope.pendingId, message: phase.message }
			: null;
	const pendingFor = (where: Screen) =>
		library.pending.filter((entry) =>
			where.kind === "sheet"
				? entry.target !== "new" && entry.target.sheetId === where.sheetId
				: entry.target === "new" ||
					findSheet(library, entry.target.sheetId) === null,
		);

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

	// Disk first, so a failed save never leaves the screen showing a sheet the file lacks.
	const commit = (id: ModeId, change: (library: Library) => Library) => {
		const next = change(librariesRef.current[id]);
		libraryStores[id].save(next);
		const all = { ...librariesRef.current, [id]: next };
		librariesRef.current = all;
		setLibraries(all);
	};

	const show = (sheetId: string) => {
		setScreen({ kind: "sheet", sheetId });
		setTarget({ sheetId });
		setEditing(null);
	};

	const showLibrary = () => {
		setScreen({ kind: "library" });
		setTarget("new");
		setEditing(null);
	};

	const generate = async (id: ModeId, pending: Pending) => {
		const now = new Date();
		const existing =
			pending.target === "new"
				? null
				: findSheet(librariesRef.current[id], pending.target.sheetId);
		const wanted: Target = existing ? pending.target : "new";
		go({ kind: "generating", pendingId: pending.id, target: wanted });
		try {
			const job = existing
				? updateSheetJob(id, pending.text, existing, now)
				: newSheetJob(id, pending.text, now);
			const generated = await engine.generate(id, job);
			if (!alive.current) return;
			if (generated === null) {
				go({
					kind: "error",
					message:
						"Guardé tu texto, pero el modelo no devolvió filas. Reintenta o elimínalo.",
					scope: { kind: "generate", pendingId: pending.id },
				});
				return;
			}
			const source = { id: pending.id, at: pending.at, text: pending.text };
			const at = Date.now();
			let opened: string | null = null;
			commit(id, (current) => {
				const rest = current.pending.filter((entry) => entry.id !== pending.id);
				const live = existing ? findSheet(current, existing.id) : null;
				if (live) {
					opened = live.id;
					return {
						pending: rest,
						sheets: current.sheets.map((sheet) =>
							sheet.id === live.id
								? appendRows(sheet, generated.rows, source, at)
								: sheet,
						),
					};
				}
				const created = createSheet(
					id,
					generated.title ?? "Hoja sin nombre",
					generated.columns,
					generated.rows,
					source,
					at,
				);
				opened = created.id;
				return { pending: rest, sheets: [...current.sheets, created] };
			});
			if (opened && id === modeId) show(opened);
			go({ kind: "ready" });
		} catch (error) {
			if (alive.current)
				fail(error, { kind: "generate", pendingId: pending.id });
		}
	};

	const submit = () => {
		const text = draft.trim();
		if (!text || !isIdle(phaseRef.current)) return;
		const id = modeId;
		const before = librariesRef.current[id];
		const pending: Pending = {
			id: makeId(),
			at: Date.now(),
			text,
			target: effectiveTarget,
		};
		try {
			commit(id, (current) => ({
				...current,
				pending: [...current.pending, pending],
			}));
			setUndo({
				mode: id,
				before,
				label: effectiveTarget === "new" ? "Hoja creada" : "Filas agregadas",
				text,
			});
			setDraft(id, () => "");
			void generate(id, pending);
		} catch (error) {
			fail(error, { kind: "capture" });
		}
	};

	const runUndo = () => {
		if (!undo || !isIdle(phaseRef.current)) return;
		try {
			commit(undo.mode, () => undo.before);
			if (undo.text !== null)
				setDraft(undo.mode, (current) =>
					current.trim() ? current : (undo.text ?? ""),
				);
			if (
				screen.kind === "sheet" &&
				findSheet(undo.before, screen.sheetId) === null
			)
				showLibrary();
			setUndo(null);
			go({ kind: "ready" });
		} catch (error) {
			fail(error, { kind: "capture" });
		}
	};

	const retry = (pendingId: string) => {
		if (!isIdle(phaseRef.current)) return;
		const pending = librariesRef.current[modeId].pending.find(
			(entry) => entry.id === pendingId,
		);
		if (pending) void generate(modeId, pending);
	};

	const change = (label: string, edit: (library: Library) => Library) => {
		const id = modeId;
		const before = librariesRef.current[id];
		try {
			commit(id, edit);
			setUndo({ mode: id, before, label, text: null });
			if (phaseRef.current.kind === "error") go({ kind: "ready" });
		} catch (error) {
			fail(error, { kind: "capture" });
		}
	};

	const editSheet = (
		sheetId: string,
		label: string | null,
		edit: (sheet: Sheet, now: number) => Sheet,
	) => {
		const apply = (current: Library): Library => ({
			...current,
			sheets: current.sheets.map((sheet) =>
				sheet.id === sheetId ? edit(sheet, Date.now()) : sheet,
			),
		});
		if (label) change(label, apply);
		else
			try {
				commit(modeId, apply);
				setUndo(null);
			} catch (error) {
				fail(error, { kind: "capture" });
			}
	};

	const discardPending = (pending: Pending) =>
		Alert.alert("¿Eliminar este texto?", "Se borra del teléfono.", [
			{ text: "Cancelar", style: "cancel" },
			{
				text: "Eliminar",
				style: "destructive",
				onPress: () =>
					change("Texto eliminado", (current) => ({
						...current,
						pending: current.pending.filter((entry) => entry.id !== pending.id),
					})),
			},
		]);

	const confirmDeleteSheet = (sheet: Sheet) =>
		Alert.alert(`¿Eliminar "${sheet.name}"?`, "Se borra del teléfono.", [
			{ text: "Cancelar", style: "cancel" },
			{
				text: "Eliminar",
				style: "destructive",
				onPress: () => {
					change("Hoja eliminada", (current) => ({
						...current,
						sheets: current.sheets.filter((found) => found.id !== sheet.id),
					}));
					if (screen.kind === "sheet" && screen.sheetId === sheet.id)
						showLibrary();
				},
			},
		]);

	const confirmDeleteRow = (sheet: Sheet, row: Row) =>
		Alert.alert("¿Eliminar esta fila?", "Se quita de la hoja.", [
			{ text: "Cancelar", style: "cancel" },
			{
				text: "Eliminar",
				style: "destructive",
				onPress: () =>
					editSheet(sheet.id, "Fila eliminada", (found, now) =>
						removeRow(found, row.id, now),
					),
			},
		]);

	const showSource = (sheet: Sheet, row: Row) => {
		const source = sheet.sources.find((found) => found.id === row.sourceId);
		Alert.alert(
			"Texto original",
			source
				? `${source.text}\n\n${relativeTime(source.at, Date.now())}`
				: "Esta fila no tiene texto guardado.",
		);
	};

	const pickMode = (id: ModeId) => {
		setMenuOpen(false);
		if (id === modeId || LOCKED_PHASES.has(phaseRef.current.kind)) return;
		setModeId(id);
		showLibrary();
		setUndo(null);
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

	const exportSheet = async (sheet: Sheet) => {
		try {
			const file = new File(Paths.cache, csvFileName(sheet));
			if (file.exists) file.delete();
			file.create();
			file.write(toCsv(sheet));
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

	const errorAction =
		phase.kind === "error" && phase.scope.kind === "models"
			? { label: "Reintentar", run: () => void prepare(modeId) }
			: null;

	const pendingBands = (where: Screen) =>
		pendingFor(where).map((entry) => (
			<PendingBand
				canAct={idle}
				error={
					generateError?.pendingId === entry.id ? generateError.message : null
				}
				generating={generatingId === entry.id}
				key={entry.id}
				onDiscard={() => discardPending(entry)}
				onRetry={() => retry(entry.id)}
				pending={entry}
			/>
		));

	const targetLabel =
		effectiveTarget === "new" ? "Nueva hoja" : (targetSheet?.name ?? "");
	const submitLabel =
		effectiveTarget === "new" ? "Crear hoja" : `Agregar a ${targetLabel}`;

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
					accessibilityLabel={`Modo ${harness.label}`}
					accessibilityState={{ expanded: menuOpen }}
					onPress={() => setMenuOpen((open) => !open)}
					pressedStyle={styles.pressedSoft}
					style={styles.switcher}
				>
					<Image source={BRAND_MARK} style={styles.brandSmall} />
					<Text numberOfLines={1} style={styles.title}>
						{harness.label}
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

			{openSheet ? (
				<SheetScreen
					editing={editing}
					onBack={showLibrary}
					onEditDone={(edit, value) => {
						setEditing(null);
						editSheet(openSheet.id, null, (sheet, now) =>
							editCell(sheet, edit.rowId, edit.column, value, now),
						);
					}}
					onEditStart={setEditing}
					onExport={() => void exportSheet(openSheet)}
					onRename={() => setRenaming(openSheet)}
					onRowMenu={setRowMenu}
					sheet={openSheet}
				>
					{pendingBands(screen)}
				</SheetScreen>
			) : (
				<LibraryScreen
					now={Date.now()}
					onMenu={setSheetMenu}
					onOpen={(sheet) => show(sheet.id)}
					sheets={sheets}
				>
					{boot.quarantined ? (
						<View style={styles.notice}>
							<Text style={styles.noticeText}>
								No pude leer la biblioteca guardada. Aparté ese archivo sin
								borrarlo y empecé de cero.
							</Text>
						</View>
					) : null}
					{pendingBands({ kind: "library" })}
				</LibraryScreen>
			)}

			<View
				style={[
					styles.footer,
					{ paddingBottom: Math.max(insets.bottom, 8) + 8 },
				]}
			>
				<View style={styles.composerTop}>
					<PressableBox
						accessibilityHint="Elige si el texto crea una hoja nueva o llena una existente"
						accessibilityLabel={`Destino: ${targetLabel}`}
						disabled={!idle}
						onPress={() => setPickerOpen(true)}
						pressedStyle={styles.pressedSoft}
						style={styles.targetChip}
					>
						<Text style={styles.targetLabel}>Destino</Text>
						<Text numberOfLines={1} style={styles.targetName}>
							{targetLabel}
						</Text>
						<View style={styles.chipChevron} />
					</PressableBox>
					{undo && undo.mode === modeId ? (
						<View style={styles.undoBar}>
							<Text numberOfLines={1} style={styles.undoText}>
								{undo.label}
							</Text>
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
				</View>
				{recording ? (
					<View style={styles.recordingLine}>
						<LevelMeter level={level} />
						<Text style={styles.recordingClock}>
							{formatClock(seconds)} / {formatClock(MAX_RECORDING_SECONDS)}
						</Text>
					</View>
				) : null}
				<TextInput
					accessibilityLabel="Escribe o dicta lo que quieras registrar"
					multiline
					onChangeText={(text) => setDraft(modeId, () => text)}
					placeholder="Escribe o dicta lo que quieras registrar"
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
						disabled={!canSubmit}
						onPress={submit}
						pressedStyle={styles.pressedStrong}
						style={[
							styles.primaryButton,
							styles.flexCopy,
							!canSubmit && styles.buttonOff,
						]}
					>
						<Text
							numberOfLines={1}
							style={[styles.primaryText, !canSubmit && styles.buttonOffText]}
						>
							{submitLabel}
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

			{pickerOpen ? (
				<OptionsSheet
					bottomInset={insets.bottom}
					onClose={() => setPickerOpen(false)}
					options={[
						{ label: "Nueva hoja", run: () => setTarget("new") },
						...sheets.map((sheet) => ({
							label: sheet.name,
							run: () => setTarget({ sheetId: sheet.id }),
						})),
					]}
					title="¿A dónde va el texto?"
				/>
			) : null}

			{sheetMenu ? (
				<OptionsSheet
					bottomInset={insets.bottom}
					onClose={() => setSheetMenu(null)}
					options={[
						{ label: "Renombrar", run: () => setRenaming(sheetMenu) },
						{ label: "Exportar", run: () => void exportSheet(sheetMenu) },
						{
							label: "Eliminar",
							danger: true,
							run: () => confirmDeleteSheet(sheetMenu),
						},
					]}
					title={sheetMenu.name}
				/>
			) : null}

			{rowMenu && openSheet ? (
				<OptionsSheet
					bottomInset={insets.bottom}
					onClose={() => setRowMenu(null)}
					options={[
						{
							label: "Ver texto original",
							run: () => showSource(openSheet, rowMenu),
						},
						{
							label: "Eliminar fila",
							danger: true,
							run: () => confirmDeleteRow(openSheet, rowMenu),
						},
					]}
					title={rowMenu.cells.map(cellText).filter(Boolean).join(" · ")}
				/>
			) : null}

			{renaming ? (
				<RenameSheet
					bottomInset={insets.bottom}
					key={renaming.id}
					name={renaming.name}
					onClose={() => setRenaming(null)}
					onSave={(name) => {
						setRenaming(null);
						editSheet(renaming.id, null, (sheet, now) =>
							renameSheet(sheet, name, now),
						);
					}}
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
	content: { gap: 10, paddingBottom: 20, paddingHorizontal: 16, paddingTop: 4 },
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
		gap: 8,
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
	brandSmall: { borderRadius: 8, height: 28, width: 28 },
	brandLarge: { borderRadius: 10, height: 40, width: 40 },
	brandRow: { alignItems: "center", flexDirection: "row", gap: 12 },
	brandName: {
		color: "#F1F7EE",
		fontSize: 18,
		fontWeight: "800",
		letterSpacing: -0.3,
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
		width: 300,
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
	screenTitle: {
		color: "#8CA39D",
		fontSize: 12,
		fontWeight: "800",
		letterSpacing: 1.2,
		marginBottom: 2,
		textTransform: "uppercase",
	},
	emptyLine: {
		color: "#A9BDB6",
		fontSize: 15,
		lineHeight: 22,
		paddingVertical: 8,
	},
	libraryRow: {
		alignItems: "center",
		backgroundColor: "#0F1614",
		borderColor: "#22312D",
		borderRadius: 16,
		borderWidth: 1,
		flexDirection: "row",
		gap: 8,
		minHeight: 64,
		paddingLeft: 14,
		paddingRight: 6,
		paddingVertical: 10,
	},
	libraryName: {
		color: "#F1F7EE",
		fontSize: 16,
		fontWeight: "700",
		lineHeight: 22,
	},
	libraryMeta: { color: "#8CA39D", fontSize: 12, marginTop: 2 },
	moreButton: {
		alignItems: "center",
		justifyContent: "center",
		minHeight: 44,
		minWidth: 44,
	},
	moreGlyph: { color: "#BFD9D3", fontSize: 22, fontWeight: "800" },
	sheetScreenBody: { flex: 1, paddingHorizontal: 16 },
	sheetHead: {
		alignItems: "center",
		flexDirection: "row",
		gap: 8,
		marginBottom: 8,
	},
	backButton: {
		alignItems: "center",
		justifyContent: "center",
		marginLeft: -8,
		minHeight: 44,
		minWidth: 44,
	},
	backChevron: {
		borderBottomWidth: 2,
		borderColor: "#BFD9D3",
		borderLeftWidth: 2,
		height: 12,
		marginLeft: 4,
		transform: [{ rotate: "45deg" }],
		width: 12,
	},
	sheetName: {
		color: "#F1F7EE",
		fontSize: 18,
		fontWeight: "700",
		lineHeight: 23,
		paddingVertical: 4,
	},
	exportButton: {
		alignItems: "center",
		backgroundColor: ACCENT,
		borderRadius: 12,
		justifyContent: "center",
		minHeight: 44,
		paddingHorizontal: 14,
	},
	exportText: { color: INK, fontSize: 14, fontWeight: "800" },
	tableFrame: {
		backgroundColor: "#0F1614",
		borderColor: "#22312D",
		borderRadius: 16,
		borderWidth: 1,
		flex: 1,
		marginBottom: 8,
		overflow: "hidden",
	},
	tableHead: {
		backgroundColor: "#141C1A",
		borderBottomColor: "#22312D",
		borderBottomWidth: 1,
		flexDirection: "row",
	},
	th: {
		color: "#8CA39D",
		fontSize: 11,
		fontWeight: "800",
		letterSpacing: 0.6,
		paddingHorizontal: 10,
		paddingVertical: 10,
		textTransform: "uppercase",
	},
	tr: {
		borderBottomColor: "#1A2522",
		borderBottomWidth: StyleSheet.hairlineWidth,
		flexDirection: "row",
	},
	trZebra: { backgroundColor: "#111816" },
	td: { justifyContent: "center", minHeight: 44, paddingHorizontal: 10 },
	tdText: { color: "#E3EEEA", fontSize: 14, lineHeight: 19 },
	tdNumber: { fontVariant: ["tabular-nums"], textAlign: "right" },
	tdFlagged: { color: "#F2C46D" },
	flagDot: {
		backgroundColor: ACCENT,
		borderRadius: 3,
		height: 6,
		position: "absolute",
		right: 4,
		top: 4,
		width: 6,
	},
	cellInput: {
		backgroundColor: "#1A2614",
		borderColor: ACCENT,
		borderWidth: 1,
		color: "#EDF5EA",
		fontSize: 14,
		minHeight: 44,
		paddingHorizontal: 9,
	},
	tableFoot: {
		backgroundColor: "#141C1A",
		borderTopColor: "#22312D",
		borderTopWidth: 1,
		flexDirection: "row",
	},
	tf: {
		color: "#BFD9D3",
		fontSize: 12,
		fontWeight: "700",
		paddingHorizontal: 10,
		paddingVertical: 9,
	},
	legend: {
		alignItems: "center",
		borderTopColor: "#22312D",
		borderTopWidth: 1,
		flexDirection: "row",
		gap: 8,
		paddingHorizontal: 10,
		paddingVertical: 8,
	},
	flagDotLegend: {
		backgroundColor: ACCENT,
		borderRadius: 3,
		height: 6,
		width: 6,
	},
	legendText: { color: "#A9BDB6", flex: 1, fontSize: 12, lineHeight: 17 },
	pendingBand: {
		backgroundColor: "#111816",
		borderColor: "#3D5230",
		borderRadius: 14,
		borderStyle: "dashed",
		borderWidth: 1,
		gap: 6,
		marginBottom: 8,
		paddingHorizontal: 12,
		paddingVertical: 10,
	},
	pendingError: { borderColor: "#6A4A32", borderStyle: "solid" },
	pendingErrorText: { color: "#F0B37A", fontSize: 12, lineHeight: 17 },
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
	textButtonDanger: { color: "#F3A27A", fontSize: 14, fontWeight: "800" },
	footer: {
		backgroundColor: "#0D1210",
		borderTopColor: "#1D2A26",
		borderTopWidth: 1,
		gap: 8,
		paddingHorizontal: 16,
		paddingTop: 8,
	},
	composerTop: {
		alignItems: "center",
		flexDirection: "row",
		gap: 10,
		justifyContent: "space-between",
	},
	targetChip: {
		alignItems: "center",
		backgroundColor: "#161F12",
		borderColor: "#34482A",
		borderRadius: 22,
		borderWidth: 1,
		flexDirection: "row",
		flexShrink: 1,
		gap: 6,
		minHeight: 44,
		paddingHorizontal: 12,
	},
	targetLabel: { color: "#8CA39D", fontSize: 12, fontWeight: "700" },
	targetName: {
		color: "#EDF5EA",
		flexShrink: 1,
		fontSize: 13,
		fontWeight: "800",
	},
	chipChevron: {
		borderBottomWidth: 2,
		borderColor: "#8CA39D",
		borderRightWidth: 2,
		height: 7,
		marginLeft: 2,
		marginTop: -4,
		transform: [{ rotate: "45deg" }],
		width: 7,
	},
	undoBar: {
		alignItems: "center",
		flexDirection: "row",
		flexShrink: 1,
		gap: 6,
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
		maxHeight: "80%",
		paddingHorizontal: 18,
		paddingTop: 18,
	},
	sheetTitle: { color: "#EDF5EA", fontSize: 16, fontWeight: "700" },
	optionList: { flexGrow: 0 },
	optionRow: {
		borderTopColor: "#1D2926",
		borderTopWidth: StyleSheet.hairlineWidth,
		justifyContent: "center",
		minHeight: 52,
	},
	optionText: { color: "#E3EEEA", fontSize: 15, fontWeight: "600" },
	dangerText: { color: "#F3A27A" },
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
	fieldInput: {
		backgroundColor: "#151D1B",
		borderColor: "#2A3A36",
		borderRadius: 12,
		borderWidth: 1,
		color: "#EDF5EA",
		fontSize: 15,
		minHeight: 48,
		paddingHorizontal: 12,
	},
	pressedSoft: { opacity: 0.6 },
	pressedStrong: { opacity: 0.82 },
	pressedRow: { opacity: 0.7 },
});
