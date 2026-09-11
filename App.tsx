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
import { createDemoEngine, demoVisits, EXAMPLE } from "./src/demo";
import { createQvacEngine } from "./src/engine";
import {
	appendAnswer,
	type ClientBase,
	confidenceFactors,
	type ExtractedUnit,
	type FleetSummary,
	fleetSummary,
	installedBase,
	type Modality,
	nextQuestion,
	type Status,
	toCsv,
	type Unit,
	type Visit,
} from "./src/installed-base";
import { MODEL_ROLES, MODELS, type ModelRole } from "./src/models";
import { DEVICE, hasPerfLog, perfLogFile } from "./src/perf-log";
import { openStore } from "./src/store";

type Target =
	| { kind: "new" }
	| { kind: "answer"; visitId: string; question: string };

type ErrorScope =
	| { kind: "models" }
	| { kind: "capture" }
	| { kind: "extract"; visitId: string };

type Phase =
	| { kind: "booting" }
	| { kind: "loading"; role: ModelRole; progress: number }
	| { kind: "ready" }
	| { kind: "starting"; target: Target }
	| { kind: "recording"; target: Target }
	| { kind: "transcribing"; target: Target }
	| { kind: "extracting"; visitId: string }
	| { kind: "error"; message: string; scope: ErrorScope };

type Undo =
	| { kind: "delete" }
	| { kind: "restore"; visit: Visit; question: string }
	| { kind: "none" };

type Focus = { visitId: string; undo: Undo };

type StatusView = {
	title: string;
	caption: string | null;
	tone: "busy" | "live" | "error";
	progress: number | null;
};

const uiOnly = process.env.EXPO_PUBLIC_UI_ONLY === "true";
const engine = uiOnly ? createDemoEngine() : createQvacEngine();
const store = openStore(uiOnly ? "demo-visits" : "visits");

const ACCENT = "#7FE3D4";
const DAY_MS = 86_400_000;
const METER_BARS = 9;

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

const MODALITY_NOUN: Record<
	Modality,
	{ label: string; one: string; many: string }
> = {
	"Resonancia magnética": {
		label: "Resonador",
		one: "resonador",
		many: "resonadores",
	},
	Tomografía: { label: "Tomógrafo", one: "tomógrafo", many: "tomógrafos" },
	Ultrasonido: { label: "Ecógrafo", one: "ecógrafo", many: "ecógrafos" },
	"Rayos X": {
		label: "Rayos X",
		one: "equipo de rayos X",
		many: "equipos de rayos X",
	},
	Mamografía: { label: "Mamógrafo", one: "mamógrafo", many: "mamógrafos" },
	Angiografía: { label: "Angiógrafo", one: "angiógrafo", many: "angiógrafos" },
	"Medicina nuclear": {
		label: "Gammacámara",
		one: "gammacámara",
		many: "gammacámaras",
	},
	Otro: { label: "Otro equipo", one: "otro equipo", many: "otros equipos" },
};

const STATUS_TONE: Record<Status, { color: string; backgroundColor: string }> =
	{
		Confirmado: {
			color: "#A6E08A",
			backgroundColor: "rgba(166, 224, 138, 0.13)",
		},
		Reportado: {
			color: "#93BDFF",
			backgroundColor: "rgba(147, 189, 255, 0.13)",
		},
		Estimado: {
			color: "#F2C46D",
			backgroundColor: "rgba(242, 196, 109, 0.13)",
		},
		Desconocido: {
			color: "#A7B0AA",
			backgroundColor: "rgba(167, 176, 170, 0.13)",
		},
	};

const ERROR_TITLE: Record<ErrorScope["kind"], string> = {
	models: "No se pudieron cargar los modelos",
	capture: "No pude usar esa captura",
	extract: "No pude ordenar la visita",
};

const EXAMPLE_CLIENT: ClientBase | undefined = installedBase(
	[
		{
			id: "ejemplo",
			at: 0,
			said: EXAMPLE.said,
			extraction: EXAMPLE.extraction,
		},
	],
	0,
)[0];

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
const questionKey = (visitId: string, question: string) =>
	`${visitId}\n${question}`;
const isIdle = (phase: Phase) =>
	phase.kind === "ready" ||
	(phase.kind === "error" && phase.scope.kind !== "models");

const formatClock = (totalSeconds: number) => {
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const count = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;

const relativeDay = (at: number, now: number) => {
	const days = Math.floor((now - at) / DAY_MS);
	if (days < 1) return "hoy";
	if (days < 2) return "ayer";
	if (days < 30) return `hace ${days} días`;
	if (days < 365) return `hace ${count(Math.floor(days / 30), "mes", "meses")}`;
	return `hace ${count(Math.floor(days / 365), "año", "años")}`;
};

const placeOf = (city: string | null, country: string | null) =>
	[city, country].filter(Boolean).join(", ");

const unitTitle = (modality: Modality, quantity: number | null) =>
	`${MODALITY_NOUN[modality].label}${quantity !== null && quantity > 1 ? ` ×${quantity}` : ""}`;

const unitDetail = (
	brand: string | null,
	model: string | null,
	ageYears: number | null,
) => {
	const name =
		brand === null
			? [model, "Marca sin confirmar"].filter(Boolean).join(" · ")
			: [brand, model].filter(Boolean).join(" ");
	if (ageYears === null) return name;
	const age =
		ageYears < 1
			? "menos de 1 año"
			: count(Math.round(ageYears), "año", "años");
	return `${name} · ${age}`;
};

const busy = (title: string): StatusView => ({
	title,
	caption: null,
	tone: "busy",
	progress: null,
});

const statusFor = (phase: Phase): StatusView | null => {
	switch (phase.kind) {
		case "ready":
			return null;
		case "booting":
			return busy("Preparando");
		case "loading": {
			const spec = MODELS[phase.role];
			return {
				title: `Cargando ${spec.label}`,
				caption: `Modelo ${MODEL_ROLES.indexOf(phase.role) + 1} de ${MODEL_ROLES.length} · ${spec.approxSize} · se descarga una sola vez`,
				tone: "busy",
				progress: phase.progress,
			};
		}
		case "starting":
			return busy("Preparando el micrófono");
		case "recording":
			return {
				title: "Te escucho",
				caption:
					phase.target.kind === "answer"
						? phase.target.question
						: "Toca de nuevo cuando termines",
				tone: "live",
				progress: null,
			};
		case "transcribing":
			return busy("Transcribiendo");
		case "extracting":
			return busy("Ordenando la visita");
		case "error":
			return {
				title: ERROR_TITLE[phase.scope.kind],
				caption: phase.message,
				tone: "error",
				progress: null,
			};
	}
};

const hintFor = (phase: Phase, target: Target) => {
	if (phase.kind === "booting" || phase.kind === "loading")
		return "Preparando los modelos";
	if (phase.kind === "error" && phase.scope.kind === "models")
		return "Los modelos no están listos";
	if (phase.kind === "starting") return "Preparando el micrófono";
	if (phase.kind === "transcribing") return "Transcribiendo";
	if (phase.kind === "extracting") return "Ordenando la visita";
	return target.kind === "answer"
		? "Toca para responder"
		: "Toca y cuenta qué equipos viste";
};

const bootVisits = (): { visits: readonly Visit[]; quarantined: boolean } => {
	const read = store.load();
	if (read.kind === "ok") return { visits: read.visits, quarantined: false };
	if (read.kind === "quarantined") return { visits: [], quarantined: true };
	if (!uiOnly) return { visits: [], quarantined: false };
	const seeded = demoVisits(Date.now());
	try {
		store.save(seeded);
		return { visits: seeded, quarantined: false };
	} catch {
		return { visits: [], quarantined: false };
	}
};

const shareFile = async (file: File, mimeType: string, UTI: string) => {
	try {
		if (!(await Sharing.isAvailableAsync())) throw new Error("unavailable");
		await Sharing.shareAsync(file.uri, {
			dialogTitle: file.name,
			mimeType,
			UTI,
		});
	} catch {
		try {
			await Share.share({ message: file.textSync(), title: file.name });
		} catch {}
	}
};

const deviceLine = () =>
	[
		DEVICE.modelName ?? "Teléfono desconocido",
		DEVICE.osVersion ? `versión ${DEVICE.osVersion}` : null,
		DEVICE.totalMemory
			? `${(DEVICE.totalMemory / 1024 ** 3).toFixed(1)} GB de RAM`
			: null,
	]
		.filter(Boolean)
		.join(" · ");

/**
 * NativeWind drops the styles of a Pressable that uses the `style={({ pressed }) => ...}`
 * callback form, which left buttons unstyled on Android. Tracking the press in state keeps
 * the visual feedback while passing a plain style array.
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

function StatusChip({ status }: { status: Status }) {
	const tone = STATUS_TONE[status];
	return (
		<View style={[styles.chip, { backgroundColor: tone.backgroundColor }]}>
			<Text style={[styles.chipText, { color: tone.color }]}>{status}</Text>
		</View>
	);
}

function UnitLine({
	modality,
	quantity,
	brand,
	model,
	ageYears,
	status,
}: {
	modality: Modality;
	quantity: number | null;
	brand: string | null;
	model: string | null;
	ageYears: number | null;
	status: Status;
}) {
	return (
		<View style={styles.unitLine}>
			<View style={styles.flexCopy}>
				<Text style={styles.unitTitle}>{unitTitle(modality, quantity)}</Text>
				<Text style={styles.unitDetail}>
					{unitDetail(brand, model, ageYears)}
				</Text>
			</View>
			<StatusChip status={status} />
		</View>
	);
}

function UnitRow({
	unit,
	located,
	expanded,
	onToggle,
}: {
	unit: Unit;
	located: boolean;
	expanded: boolean;
	onToggle: (() => void) | null;
}) {
	const body = (
		<>
			<UnitLine
				ageYears={unit.ageYears}
				brand={unit.brand}
				modality={unit.modality}
				model={unit.model}
				quantity={unit.quantity}
				status={unit.status}
			/>
			{unit.renewal || unit.stale ? (
				<View style={styles.tags}>
					{unit.renewal ? (
						<View style={[styles.tag, styles.tagRenewal]}>
							<Text style={[styles.tagText, styles.tagRenewalText]}>
								Renovar
							</Text>
						</View>
					) : null}
					{unit.stale ? (
						<View style={[styles.tag, styles.tagStale]}>
							<Text style={styles.tagText}>Sin verificar</Text>
						</View>
					) : null}
				</View>
			) : null}
			{expanded ? (
				<View style={styles.factors}>
					<Text style={styles.factorsTitle}>Confianza {unit.confidence}</Text>
					<Text style={styles.factorsText}>
						{confidenceFactors({ ...unit, located })
							.map(
								(factor) =>
									`${factor.label} ${factor.points > 0 ? "+" : ""}${factor.points}`,
							)
							.join(" · ")}
					</Text>
					<Text style={styles.factorsText}>
						Visto en {count(unit.confirmations, "visita", "visitas")}
					</Text>
				</View>
			) : null}
		</>
	);
	if (!onToggle) return <View style={styles.unitRow}>{body}</View>;
	return (
		<PressableBox
			accessibilityHint="Muestra la confianza del dato"
			accessibilityState={{ expanded }}
			onPress={onToggle}
			pressedStyle={styles.pressedRow}
			style={styles.unitRow}
		>
			{body}
		</PressableBox>
	);
}

function ClientCard({
	client,
	now,
	expandedUnit,
	onToggleUnit,
}: {
	client: ClientBase;
	now: number | null;
	expandedUnit: string | null;
	onToggleUnit: ((key: string) => void) | null;
}) {
	const example = now === null;
	const located = client.city !== null || client.country !== null;
	const meta = [
		placeOf(client.city, client.country),
		now === null ? null : relativeDay(client.lastVisitAt, now),
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<View style={[styles.card, example && styles.cardExample]}>
			<View style={styles.clientHead}>
				<View style={styles.flexCopy}>
					<Text style={styles.clientName}>{client.name}</Text>
					{meta ? <Text style={styles.clientMeta}>{meta}</Text> : null}
				</View>
				{example ? (
					<View style={styles.exampleTag}>
						<Text style={styles.exampleTagText}>EJEMPLO</Text>
					</View>
				) : null}
			</View>
			{client.units.length === 0 ? (
				<Text style={styles.muted}>Sin equipos todavía.</Text>
			) : (
				client.units.map((unit) => (
					<UnitRow
						expanded={expandedUnit === unit.key}
						key={unit.key}
						located={located}
						onToggle={onToggleUnit ? () => onToggleUnit(unit.key) : null}
						unit={unit}
					/>
				))
			)}
		</View>
	);
}

function FleetBar({
	summary,
	onShare,
}: {
	summary: FleetSummary;
	onShare: () => void;
}) {
	const line = [
		count(summary.clients, "cliente", "clientes"),
		count(summary.units, "equipo", "equipos"),
		summary.renewals > 0 ? `${summary.renewals} por renovar` : null,
		summary.stale > 0 ? `${summary.stale} sin verificar` : null,
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<View style={styles.fleet}>
			<View style={styles.fleetHead}>
				<Text style={styles.fleetLine}>{line}</Text>
				<PressableBox
					accessibilityLabel="Compartir la base instalada como CSV"
					onPress={onShare}
					pressedStyle={styles.pressedStrong}
					style={styles.csvButton}
				>
					<Text style={styles.csvButtonText}>CSV ↗</Text>
				</PressableBox>
			</View>
			<View style={styles.modalities}>
				{summary.byModality.map(({ modality, units }) => (
					<View key={modality} style={styles.modalityChip}>
						<Text style={styles.modalityText}>
							{count(
								units,
								MODALITY_NOUN[modality].one,
								MODALITY_NOUN[modality].many,
							)}
						</Text>
					</View>
				))}
			</View>
		</View>
	);
}

function ExtractedLines({ units }: { units: readonly ExtractedUnit[] }) {
	return units.map((unit, index) => (
		<UnitLine
			ageYears={unit.antiguedad_anios}
			brand={unit.marca}
			// biome-ignore lint/suspicious/noArrayIndexKey: extracted units have no identity until merged.
			key={index}
			modality={unit.modalidad}
			model={unit.modelo}
			quantity={unit.cantidad}
			status={unit.estado}
		/>
	));
}

function CaptureCard({
	visit,
	extracting,
	question,
	canAct,
	onUndo,
	onRetry,
	onSkip,
}: {
	visit: Visit;
	extracting: boolean;
	question: string | null;
	canAct: boolean;
	onUndo: (() => void) | null;
	onRetry: () => void;
	onSkip: () => void;
}) {
	const [open, setOpen] = useState(false);
	const { extraction } = visit;
	const place = extraction ? placeOf(extraction.ciudad, extraction.pais) : "";
	return (
		<View style={[styles.card, styles.captureCard]}>
			<View style={styles.cardHead}>
				<Text style={styles.cardLabel}>
					{onUndo ? "RECIÉN CAPTURADO" : "COMPLETA LA VISITA"}
				</Text>
				{onUndo ? (
					<PressableBox
						accessibilityLabel="Deshacer la última captura"
						disabled={!canAct}
						onPress={onUndo}
						pressedStyle={styles.pressedSoft}
						style={styles.textButton}
					>
						<Text
							style={[styles.textButtonLabel, !canAct && styles.disabledText]}
						>
							Deshacer
						</Text>
					</PressableBox>
				) : null}
			</View>
			<PressableBox
				accessibilityHint={
					open ? "Muestra menos" : "Muestra todo lo que escuché"
				}
				onPress={() => setOpen((value) => !value)}
				pressedStyle={styles.pressedSoft}
			>
				<Text numberOfLines={open ? undefined : 2} style={styles.heard}>
					<Text style={styles.heardLabel}>Escuché: </Text>
					{visit.said}
				</Text>
			</PressableBox>
			{extracting ? (
				<View style={styles.inlineBusy}>
					<ActivityIndicator color={ACCENT} size="small" />
					<Text style={styles.inlineBusyText}>Ordenando la visita</Text>
				</View>
			) : extraction ? (
				<View style={styles.captureResult}>
					<Text style={styles.clientName}>
						{extraction.cliente ?? "Falta el hospital"}
					</Text>
					{place ? <Text style={styles.clientMeta}>{place}</Text> : null}
					<ExtractedLines units={extraction.equipos} />
				</View>
			) : (
				<View style={styles.unsorted}>
					<Text style={styles.muted}>Todavía sin ordenar.</Text>
					<PressableBox
						accessibilityLabel="Ordenar esta visita de nuevo"
						disabled={!canAct}
						onPress={onRetry}
						pressedStyle={styles.pressedSoft}
						style={styles.textButton}
					>
						<Text
							style={[styles.textButtonLabel, !canAct && styles.disabledText]}
						>
							Ordenar de nuevo
						</Text>
					</PressableBox>
				</View>
			)}
			{question && !extracting ? (
				<View style={styles.question}>
					<Text style={styles.questionText}>{question}</Text>
					<View style={styles.questionFoot}>
						<Text style={styles.questionHint}>
							Responde con el micrófono o el teclado
						</Text>
						<PressableBox
							accessibilityLabel="Omitir la pregunta"
							disabled={!canAct}
							onPress={onSkip}
							pressedStyle={styles.pressedSoft}
							style={styles.textButton}
						>
							<Text
								style={[styles.textButtonMuted, !canAct && styles.disabledText]}
							>
								Omitir
							</Text>
						</PressableBox>
					</View>
				</View>
			) : null}
		</View>
	);
}

function PendingCard({
	visit,
	now,
	extracting,
	canAct,
	onRetry,
	onComplete,
}: {
	visit: Visit;
	now: number;
	extracting: boolean;
	canAct: boolean;
	onRetry: () => void;
	onComplete: () => void;
}) {
	const unsorted = visit.extraction === null;
	return (
		<View style={[styles.card, styles.pendingCard]}>
			<Text style={styles.cardLabel}>
				{unsorted ? "SIN ORDENAR" : "FALTA EL HOSPITAL"} ·{" "}
				{relativeDay(visit.at, now).toUpperCase()}
			</Text>
			<Text numberOfLines={3} style={styles.pendingSaid}>
				{visit.said}
			</Text>
			<PressableBox
				accessibilityLabel={
					unsorted ? "Ordenar esta visita de nuevo" : "Completar esta visita"
				}
				disabled={!canAct}
				onPress={unsorted ? onRetry : onComplete}
				pressedStyle={styles.pressedSoft}
				style={styles.pendingAction}
			>
				{extracting ? (
					<ActivityIndicator color={ACCENT} size="small" />
				) : (
					<Text
						style={[styles.pendingActionText, !canAct && styles.disabledText]}
					>
						{unsorted ? "Ordenar de nuevo" : "Completar"}
					</Text>
				)}
			</PressableBox>
		</View>
	);
}

function EmptyState() {
	return (
		<View style={styles.empty}>
			<Text style={styles.emptyTitle}>
				Después de una visita, cuenta qué equipos viste
			</Text>
			<View style={styles.exampleQuote}>
				<Text style={styles.exampleQuoteText}>"{EXAMPLE.said}"</Text>
			</View>
			<Text style={styles.emptyArrow}>se convierte en</Text>
			{EXAMPLE_CLIENT ? (
				<ClientCard
					client={EXAMPLE_CLIENT}
					expandedUnit={null}
					now={null}
					onToggleUnit={null}
				/>
			) : null}
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
					<Text style={styles.sheetTitle}>
						Nada sale del teléfono. Sin internet después de la descarga.
					</Text>
					{MODEL_ROLES.map((role) => {
						const spec = MODELS[role];
						const state = uiOnly
							? "modo demo, sin cargar"
							: loaded.includes(role)
								? "cargado"
								: "sin cargar";
						return (
							<View key={role} style={styles.modelRow}>
								<Text style={styles.modelPurpose}>{spec.purpose}</Text>
								<Text style={styles.modelLabel}>{spec.label}</Text>
								<Text style={styles.modelMeta}>
									{spec.quantization} · {spec.approxSize} · {state}
								</Text>
							</View>
						);
					})}
					<Text style={styles.deviceLine}>{deviceLine()}</Text>
					<PressableBox
						disabled={!canShare}
						onPress={() =>
							void shareFile(perfLogFile(), "text/plain", "public.plain-text")
						}
						pressedStyle={styles.pressedStrong}
						style={[
							styles.sheetButton,
							!canShare && styles.sheetButtonDisabled,
						]}
					>
						<Text
							style={[
								styles.sheetButtonText,
								!canShare && styles.sheetButtonTextDisabled,
							]}
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

function Assistant() {
	const recorder = useAudioRecorder(RECORDING_OPTIONS);
	const insets = useSafeAreaInsets();
	const [boot] = useState(bootVisits);
	const [visits, setVisits] = useState(boot.visits);
	const [phase, setPhase] = useState<Phase>({ kind: "booting" });
	const [focus, setFocus] = useState<Focus | null>(null);
	const [closedQuestions, setClosedQuestions] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [expandedUnit, setExpandedUnit] = useState<string | null>(null);
	const [sheetOpen, setSheetOpen] = useState(false);
	const [draft, setDraft] = useState<string | null>(null);
	const [recordingSeconds, setRecordingSeconds] = useState(0);
	const [level, setLevel] = useState(0);
	const visitsRef = useRef(boot.visits);
	// Handlers read the phase from here: two taps in one frame both see the stale render value.
	const phaseRef = useRef<Phase>(phase);
	const alive = useRef(true);
	const scrollRef = useRef<ScrollView>(null);
	const pulse = useRef(new Animated.Value(1)).current;

	const now = Date.now();
	const bases = useMemo(() => installedBase(visits, Date.now()), [visits]);
	const summary = useMemo(() => fleetSummary(bases), [bases]);
	const focused = focus
		? (visits.find((visit) => visit.id === focus.visitId) ?? null)
		: null;
	const asked = focused?.extraction ? nextQuestion(focused.extraction) : null;
	const question =
		focused && asked && !closedQuestions.has(questionKey(focused.id, asked))
			? asked
			: null;
	const target: Target =
		focused && question
			? { kind: "answer", visitId: focused.id, question }
			: { kind: "new" };
	const pending = visits
		.filter((visit) => !visit.extraction?.cliente && visit.id !== focused?.id)
		.sort((a, b) => b.at - a.at);
	const idle = isIdle(phase);
	const isRecording = phase.kind === "recording";
	const extractingId = phase.kind === "extracting" ? phase.visitId : null;
	const status = statusFor(phase);

	const go = useCallback((next: Phase) => {
		phaseRef.current = next;
		setPhase(next);
	}, []);

	const loadModels = useCallback(async () => {
		try {
			await engine.load((role, progress) => {
				if (alive.current) go({ kind: "loading", role, progress });
			});
			if (alive.current) go({ kind: "ready" });
		} catch (error) {
			if (alive.current)
				go({
					kind: "error",
					message: errorMessage(error),
					scope: { kind: "models" },
				});
		}
	}, [go]);

	useEffect(() => {
		alive.current = true;
		void loadModels();
		return () => {
			alive.current = false;
			void engine.unload();
		};
	}, [loadModels]);

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
			const recorderStatus = recorder.getStatus();
			setRecordingSeconds(
				typeof recorderStatus.durationMillis === "number"
					? Math.floor(recorderStatus.durationMillis / 1000)
					: Math.floor(elapsed / 1000),
			);
			const metering = recorderStatus.metering;
			if (typeof metering === "number")
				setLevel(Math.max(0, Math.min(1, (metering + 60) / 60)));
		}, 100);
		return () => clearInterval(interval);
	}, [isRecording, recorder]);

	useEffect(() => {
		if (!focus) return;
		scrollRef.current?.scrollTo({ animated: true, y: 0 });
	}, [focus]);

	const commit = (change: (current: readonly Visit[]) => readonly Visit[]) => {
		const next = change(visitsRef.current);
		// Disk first, so a failed save never leaves the screen showing a visit the file lacks.
		store.save(next);
		visitsRef.current = next;
		setVisits(next);
	};

	const extractVisit = async (visit: Visit) => {
		go({ kind: "extracting", visitId: visit.id });
		try {
			const extraction = await engine.extract(visit.said);
			if (!alive.current) return;
			if (!extraction) {
				go({
					kind: "error",
					message: visit.extraction
						? "Guardé tu respuesta, pero no pude ordenarla."
						: "Guardé tus palabras, pero no pude ordenarlas.",
					scope: { kind: "extract", visitId: visit.id },
				});
				return;
			}
			commit((current) =>
				current.map((found) =>
					found.id === visit.id ? { ...found, extraction } : found,
				),
			);
			go({ kind: "ready" });
		} catch (error) {
			go({
				kind: "error",
				message: errorMessage(error),
				scope: { kind: "extract", visitId: visit.id },
			});
		}
	};

	const capture = async (to: Target, said: string) => {
		try {
			const answered =
				to.kind === "answer"
					? visitsRef.current.find((found) => found.id === to.visitId)
					: undefined;
			if (to.kind === "answer" && answered) {
				const visit = {
					...answered,
					said: appendAnswer(answered.said, to.question, said),
				};
				commit((current) =>
					current.map((found) => (found.id === visit.id ? visit : found)),
				);
				// An answer that fills nothing would otherwise bring the same question straight back.
				setClosedQuestions((current) =>
					new Set(current).add(questionKey(visit.id, to.question)),
				);
				setFocus({
					visitId: visit.id,
					undo: { kind: "restore", visit: answered, question: to.question },
				});
				await extractVisit(visit);
				return;
			}
			const visit: Visit = {
				id: makeId(),
				at: Date.now(),
				said,
				extraction: null,
			};
			commit((current) => [...current, visit]);
			setFocus({ visitId: visit.id, undo: { kind: "delete" } });
			await extractVisit(visit);
		} catch (error) {
			go({
				kind: "error",
				message: errorMessage(error),
				scope: { kind: "capture" },
			});
		}
	};

	const retryExtraction = (visitId: string) => {
		if (!isIdle(phaseRef.current)) return;
		const visit = visitsRef.current.find((found) => found.id === visitId);
		if (visit) void extractVisit(visit);
	};

	const startRecording = async () => {
		if (!isIdle(phaseRef.current)) return;
		const to = target;
		go({ kind: "starting", target: to });
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
			setRecordingSeconds(0);
			go({ kind: "recording", target: to });
		} catch (error) {
			go({
				kind: "error",
				message: errorMessage(error),
				scope: { kind: "capture" },
			});
		}
	};

	const stopRecording = async () => {
		const current = phaseRef.current;
		if (current.kind !== "recording") return;
		const to = current.target;
		go({ kind: "transcribing", target: to });
		try {
			let audioPath: string | null = null;
			if (!uiOnly) {
				await recorder.stop();
				audioPath = recorder.uri ? toLocalPath(recorder.uri) : null;
			}
			const said = await engine.transcribe(
				audioPath,
				to.kind === "answer" ? to.question : null,
			);
			if (!isMeaningfulTranscript(said)) {
				go({
					kind: "error",
					message: "No escuché voz. Acerca el teléfono e inténtalo otra vez.",
					scope: { kind: "capture" },
				});
				return;
			}
			await capture(to, said);
		} catch (error) {
			go({
				kind: "error",
				message: errorMessage(error),
				scope: { kind: "capture" },
			});
		}
	};

	const submitDraft = () => {
		const said = draft?.trim();
		if (!said || !isIdle(phaseRef.current)) return;
		setDraft(null);
		void capture(target, said);
	};

	const undo = () => {
		if (!focus || !isIdle(phaseRef.current)) return;
		const { visitId, undo: step } = focus;
		if (step.kind === "none") return;
		try {
			commit((current) =>
				step.kind === "restore"
					? current.map((found) => (found.id === visitId ? step.visit : found))
					: current.filter((found) => found.id !== visitId),
			);
			if (step.kind === "restore") {
				setClosedQuestions((current) => {
					const next = new Set(current);
					next.delete(questionKey(visitId, step.question));
					return next;
				});
				setFocus({ visitId, undo: { kind: "none" } });
			} else {
				setFocus(null);
			}
			go({ kind: "ready" });
		} catch (error) {
			go({
				kind: "error",
				message: errorMessage(error),
				scope: { kind: "capture" },
			});
		}
	};

	const skip = () => {
		if (!focused || !question) return;
		const key = questionKey(focused.id, question);
		setClosedQuestions((current) => new Set(current).add(key));
	};

	const shareCsv = async () => {
		const file = new File(Paths.cache, "base-instalada.csv");
		try {
			if (file.exists) file.delete();
			file.create();
			file.write(toCsv(bases));
		} catch {
			return;
		}
		await shareFile(file, "text/csv", "public.comma-separated-values-text");
	};

	const errorAction =
		phase.kind !== "error"
			? null
			: phase.scope.kind === "models"
				? { label: "Reintentar", run: () => void loadModels() }
				: phase.scope.kind === "extract"
					? {
							label: "Ordenar de nuevo",
							run: (
								(visitId: string) => () =>
									retryExtraction(visitId)
							)(phase.scope.visitId),
						}
					: null;

	return (
		<KeyboardAvoidingView behavior="padding" style={styles.screen}>
			<StatusBar style="light" />
			<ScrollView
				contentContainerStyle={[
					styles.content,
					{ paddingTop: insets.top + 12 },
				]}
				keyboardShouldPersistTaps="handled"
				ref={scrollRef}
				showsVerticalScrollIndicator={false}
			>
				<View style={styles.header}>
					<View style={styles.flexCopy}>
						<Text style={styles.eyebrow}>BASE INSTALADA</Text>
						<Text style={styles.title}>Equipos por cliente</Text>
					</View>
					<PressableBox
						accessibilityLabel="Ver los modelos que corren en el dispositivo"
						hitSlop={8}
						onPress={() => setSheetOpen(true)}
						pressedStyle={styles.pressedSoft}
						style={styles.localBadge}
					>
						<View style={styles.localDot} />
						<Text style={styles.localText}>En el dispositivo</Text>
					</PressableBox>
				</View>

				{status ? (
					<View
						style={[
							styles.status,
							status.tone === "error" && styles.statusError,
						]}
					>
						<View style={styles.statusRow}>
							{status.tone === "busy" ? (
								<ActivityIndicator color={ACCENT} size="small" />
							) : (
								<View
									style={[
										styles.statusDot,
										status.tone === "error"
											? styles.statusDotError
											: styles.statusDotLive,
									]}
								/>
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
				) : null}

				{boot.quarantined ? (
					<View style={styles.notice}>
						<Text style={styles.noticeText}>
							No pude leer lo que había guardado. Aparté ese archivo sin
							borrarlo y empecé de cero.
						</Text>
					</View>
				) : null}

				{bases.length > 0 ? (
					<FleetBar onShare={() => void shareCsv()} summary={summary} />
				) : null}

				{focused && focus ? (
					<CaptureCard
						canAct={idle}
						extracting={extractingId === focused.id}
						key={focused.id}
						onRetry={() => retryExtraction(focused.id)}
						onSkip={skip}
						onUndo={focus.undo.kind === "none" ? null : undo}
						question={question}
						visit={focused}
					/>
				) : null}

				{pending.map((visit) => (
					<PendingCard
						canAct={idle}
						extracting={extractingId === visit.id}
						key={visit.id}
						now={now}
						onComplete={() =>
							setFocus({ visitId: visit.id, undo: { kind: "none" } })
						}
						onRetry={() => retryExtraction(visit.id)}
						visit={visit}
					/>
				))}

				{bases.map((client) => (
					<ClientCard
						client={client}
						expandedUnit={expandedUnit}
						key={client.key}
						now={now}
						onToggleUnit={(key) =>
							setExpandedUnit((current) => (current === key ? null : key))
						}
					/>
				))}

				{visits.length === 0 ? <EmptyState /> : null}
			</ScrollView>

			<View
				style={[
					styles.footer,
					{ paddingBottom: Math.max(insets.bottom, 10) + 10 },
				]}
			>
				{draft !== null ? (
					<>
						<Text numberOfLines={2} style={styles.footerHint}>
							{target.kind === "answer"
								? target.question
								: "Escribe qué equipos viste"}
						</Text>
						<View style={styles.composer}>
							<TextInput
								accessibilityLabel="Texto de la visita"
								autoFocus
								onChangeText={setDraft}
								onSubmitEditing={submitDraft}
								placeholder={
									target.kind === "answer"
										? "Tu respuesta"
										: "Hospital, equipos, marcas"
								}
								placeholderTextColor="#6F8574"
								returnKeyType="send"
								style={styles.input}
								value={draft}
							/>
							<PressableBox
								accessibilityLabel="Enviar"
								disabled={!draft.trim() || !idle}
								onPress={submitDraft}
								pressedStyle={styles.pressedStrong}
								style={[
									styles.sendButton,
									(!draft.trim() || !idle) && styles.buttonDisabled,
								]}
							>
								<Text style={styles.sendGlyph}>↑</Text>
							</PressableBox>
							<PressableBox
								accessibilityLabel="Volver al micrófono"
								onPress={() => setDraft(null)}
								pressedStyle={styles.pressedSoft}
								style={styles.ghostButton}
							>
								<Text style={styles.ghostGlyph}>×</Text>
							</PressableBox>
						</View>
					</>
				) : (
					<>
						{isRecording ? (
							<View style={styles.footerStatus}>
								<LevelMeter level={level} />
								<Text style={styles.footerTimer}>
									{formatClock(recordingSeconds)}
								</Text>
							</View>
						) : (
							<Text style={styles.footerHint}>{hintFor(phase, target)}</Text>
						)}
						<View style={styles.footerRow}>
							<View style={styles.footerSide} />
							<Animated.View style={{ transform: [{ scale: pulse }] }}>
								<PressableBox
									accessibilityLabel={
										isRecording
											? "Detener grabación"
											: target.kind === "answer"
												? "Responder con voz"
												: "Grabar una visita"
									}
									disabled={!idle && !isRecording}
									onPress={() =>
										isRecording ? void stopRecording() : void startRecording()
									}
									pressedStyle={styles.pressedStrong}
									style={[
										styles.micButton,
										isRecording && styles.micButtonRecording,
										!idle && !isRecording && styles.micButtonDisabled,
									]}
								>
									<Text
										style={[
											styles.micGlyph,
											!idle && !isRecording && styles.micGlyphDisabled,
										]}
									>
										{isRecording ? "■" : "●"}
									</Text>
								</PressableBox>
							</Animated.View>
							<View style={styles.footerSide}>
								<PressableBox
									accessibilityLabel="Escribir en vez de hablar"
									disabled={!idle}
									onPress={() => setDraft("")}
									pressedStyle={styles.pressedSoft}
									style={[styles.ghostButton, !idle && styles.buttonDisabled]}
								>
									<Text style={styles.ghostText}>Aa</Text>
								</PressableBox>
							</View>
						</View>
					</>
				)}
			</View>

			<DeviceSheet
				bottomInset={insets.bottom}
				onClose={() => setSheetOpen(false)}
				visible={sheetOpen}
			/>
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
	content: { gap: 12, paddingBottom: 24, paddingHorizontal: 18 },
	flexCopy: { flex: 1, minWidth: 0 },
	header: {
		alignItems: "center",
		flexDirection: "row",
		gap: 10,
		paddingBottom: 8,
	},
	eyebrow: {
		color: ACCENT,
		fontSize: 10,
		fontWeight: "800",
		letterSpacing: 1.4,
	},
	title: {
		color: "#F1F7EE",
		fontSize: 25,
		fontWeight: "700",
		letterSpacing: -0.6,
		marginTop: 4,
	},
	localBadge: {
		alignItems: "center",
		backgroundColor: "#132020",
		borderColor: "#27443F",
		borderRadius: 20,
		borderWidth: 1,
		flexDirection: "row",
		minHeight: 36,
		paddingHorizontal: 11,
	},
	localDot: {
		backgroundColor: ACCENT,
		borderRadius: 4,
		height: 7,
		marginRight: 6,
		width: 7,
	},
	localText: { color: "#BFD9D3", fontSize: 11, fontWeight: "700" },
	status: {
		backgroundColor: "#111816",
		borderColor: "#1F2C28",
		borderRadius: 16,
		borderWidth: 1,
		paddingHorizontal: 14,
		paddingVertical: 12,
	},
	statusError: { borderColor: "#6A4A32" },
	statusRow: { alignItems: "center", flexDirection: "row" },
	statusDot: { borderRadius: 5, height: 10, width: 10 },
	statusDotLive: { backgroundColor: "#F6B8A8" },
	statusDotError: { backgroundColor: "#F0B37A" },
	statusCopy: { flex: 1, marginLeft: 12 },
	statusTitle: { color: "#EDF5EA", fontSize: 14, fontWeight: "700" },
	statusCaption: {
		color: "#9CB3A0",
		fontSize: 12,
		lineHeight: 17,
		marginTop: 2,
	},
	statusCaptionError: { color: "#F0B37A" },
	progressBlock: { alignItems: "center", flexDirection: "row", marginTop: 10 },
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
		alignSelf: "flex-start",
		backgroundColor: "#2E2117",
		borderRadius: 12,
		justifyContent: "center",
		marginTop: 10,
		minHeight: 44,
		paddingHorizontal: 16,
	},
	retryText: { color: "#F0B37A", fontSize: 13, fontWeight: "700" },
	notice: {
		backgroundColor: "#1B2419",
		borderColor: "#3C4A2E",
		borderRadius: 14,
		borderWidth: 1,
		padding: 13,
	},
	noticeText: { color: "#D9CB9C", fontSize: 12, lineHeight: 18 },
	fleet: { gap: 8, paddingTop: 4 },
	fleetHead: { alignItems: "center", flexDirection: "row", gap: 10 },
	fleetLine: {
		color: "#EDF5EA",
		flex: 1,
		fontSize: 14,
		fontWeight: "700",
		lineHeight: 20,
	},
	csvButton: {
		alignItems: "center",
		backgroundColor: ACCENT,
		borderRadius: 12,
		justifyContent: "center",
		minHeight: 44,
		paddingHorizontal: 14,
	},
	csvButtonText: { color: "#0A211D", fontSize: 13, fontWeight: "800" },
	modalities: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
	modalityChip: {
		backgroundColor: "#151D1B",
		borderRadius: 10,
		paddingHorizontal: 9,
		paddingVertical: 5,
	},
	modalityText: { color: "#A9BDB6", fontSize: 12, fontWeight: "600" },
	card: {
		backgroundColor: "#111816",
		borderColor: "#1F2C28",
		borderRadius: 18,
		borderWidth: 1,
		paddingHorizontal: 14,
		paddingVertical: 12,
	},
	cardExample: { borderStyle: "dashed", opacity: 0.8 },
	captureCard: { backgroundColor: "#0F1C1A", borderColor: "#2A4A44" },
	pendingCard: { borderStyle: "dashed", gap: 6 },
	cardHead: {
		alignItems: "center",
		flexDirection: "row",
		justifyContent: "space-between",
		minHeight: 44,
	},
	cardLabel: {
		color: "#8CA39D",
		flexShrink: 1,
		fontSize: 10,
		fontWeight: "800",
		letterSpacing: 1.3,
	},
	textButton: {
		alignItems: "center",
		justifyContent: "center",
		minHeight: 44,
		minWidth: 44,
		paddingHorizontal: 6,
	},
	textButtonLabel: { color: ACCENT, fontSize: 13, fontWeight: "800" },
	textButtonMuted: { color: "#A9BDB6", fontSize: 13, fontWeight: "700" },
	disabledText: { opacity: 0.4 },
	heard: { color: "#C9DAD4", fontSize: 13, lineHeight: 19 },
	heardLabel: { color: "#8CA39D", fontWeight: "700" },
	inlineBusy: {
		alignItems: "center",
		flexDirection: "row",
		gap: 8,
		paddingVertical: 10,
	},
	inlineBusyText: { color: "#A9BDB6", fontSize: 13 },
	captureResult: { marginTop: 10 },
	unsorted: {
		alignItems: "center",
		flexDirection: "row",
		justifyContent: "space-between",
		marginTop: 4,
	},
	question: {
		backgroundColor: "#132A26",
		borderRadius: 14,
		marginTop: 12,
		paddingHorizontal: 12,
		paddingTop: 10,
	},
	questionText: {
		color: "#EDF5EA",
		fontSize: 15,
		fontWeight: "700",
		lineHeight: 21,
	},
	questionFoot: {
		alignItems: "center",
		flexDirection: "row",
		justifyContent: "space-between",
	},
	questionHint: { color: "#8CA39D", flexShrink: 1, fontSize: 12 },
	muted: { color: "#8CA39D", fontSize: 13, paddingVertical: 6 },
	clientHead: { alignItems: "flex-start", flexDirection: "row", gap: 8 },
	clientName: {
		color: "#F1F7EE",
		fontSize: 16,
		fontWeight: "700",
		lineHeight: 22,
	},
	clientMeta: { color: "#8CA39D", fontSize: 12, lineHeight: 17, marginTop: 1 },
	exampleTag: {
		borderColor: "#3A5550",
		borderRadius: 8,
		borderWidth: 1,
		paddingHorizontal: 7,
		paddingVertical: 3,
	},
	exampleTagText: {
		color: "#8CA39D",
		fontSize: 9,
		fontWeight: "800",
		letterSpacing: 1,
	},
	unitRow: {
		borderTopColor: "#1D2926",
		borderTopWidth: StyleSheet.hairlineWidth,
		justifyContent: "center",
		marginTop: 8,
		minHeight: 44,
		paddingTop: 8,
	},
	unitLine: {
		alignItems: "center",
		flexDirection: "row",
		gap: 10,
		minHeight: 36,
		paddingVertical: 2,
	},
	unitTitle: { color: "#E3EEEA", fontSize: 14, fontWeight: "700" },
	unitDetail: { color: "#A9BDB6", fontSize: 12, lineHeight: 17, marginTop: 1 },
	chip: { borderRadius: 9, paddingHorizontal: 8, paddingVertical: 4 },
	chipText: { fontSize: 11, fontWeight: "700" },
	tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
	tag: {
		borderColor: "#3A4744",
		borderRadius: 7,
		borderWidth: 1,
		paddingHorizontal: 6,
		paddingVertical: 2,
	},
	tagText: { color: "#A7B0AA", fontSize: 10, fontWeight: "700" },
	tagRenewal: {
		backgroundColor: "rgba(243, 162, 122, 0.12)",
		borderColor: "#6B4535",
	},
	tagRenewalText: { color: "#F3A27A" },
	tagStale: { borderStyle: "dashed" },
	factors: {
		backgroundColor: "#0D1412",
		borderRadius: 10,
		gap: 3,
		marginTop: 8,
		padding: 10,
	},
	factorsTitle: { color: "#E3EEEA", fontSize: 13, fontWeight: "700" },
	factorsText: { color: "#A9BDB6", fontSize: 12, lineHeight: 17 },
	pendingSaid: { color: "#C9DAD4", fontSize: 13, lineHeight: 19 },
	pendingAction: {
		alignItems: "center",
		alignSelf: "flex-start",
		justifyContent: "center",
		minHeight: 44,
		minWidth: 44,
	},
	pendingActionText: { color: ACCENT, fontSize: 13, fontWeight: "800" },
	empty: { gap: 10, paddingTop: 8 },
	emptyTitle: {
		color: "#EDF5EA",
		fontSize: 17,
		fontWeight: "700",
		lineHeight: 23,
	},
	exampleQuote: {
		backgroundColor: "#132A26",
		borderRadius: 16,
		borderTopLeftRadius: 4,
		padding: 13,
	},
	exampleQuoteText: { color: "#D5E6E0", fontSize: 14, lineHeight: 21 },
	emptyArrow: {
		color: "#8CA39D",
		fontSize: 12,
		fontWeight: "700",
		textAlign: "center",
	},
	footer: {
		backgroundColor: "#0D1210",
		borderTopColor: "#1D2A26",
		borderTopWidth: 1,
		paddingHorizontal: 18,
		paddingTop: 10,
	},
	footerHint: {
		color: "#9CB3A0",
		fontSize: 12,
		marginBottom: 8,
		textAlign: "center",
	},
	footerStatus: {
		alignItems: "center",
		flexDirection: "row",
		justifyContent: "center",
		marginBottom: 8,
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
		gap: 28,
		justifyContent: "center",
	},
	footerSide: { alignItems: "center", width: 48 },
	micButton: {
		alignItems: "center",
		backgroundColor: ACCENT,
		borderRadius: 32,
		elevation: 6,
		height: 64,
		justifyContent: "center",
		shadowColor: ACCENT,
		shadowOffset: { height: 6, width: 0 },
		shadowOpacity: 0.2,
		shadowRadius: 14,
		width: 64,
	},
	micButtonRecording: { backgroundColor: "#F6B8A8", shadowColor: "#F6B8A8" },
	micButtonDisabled: {
		backgroundColor: "#1F2B28",
		elevation: 0,
		shadowOpacity: 0,
	},
	micGlyph: { color: "#0A211D", fontSize: 22, fontWeight: "800" },
	micGlyphDisabled: { color: "#6F8574" },
	ghostButton: {
		alignItems: "center",
		borderColor: "#2A3A36",
		borderRadius: 22,
		borderWidth: 1,
		height: 44,
		justifyContent: "center",
		width: 44,
	},
	ghostText: { color: "#BFD9D3", fontSize: 14, fontWeight: "700" },
	ghostGlyph: { color: "#BFD9D3", fontSize: 22, lineHeight: 24 },
	buttonDisabled: { opacity: 0.4 },
	composer: { alignItems: "center", flexDirection: "row", gap: 8 },
	input: {
		backgroundColor: "#151D1B",
		borderColor: "#2A3A36",
		borderRadius: 22,
		borderWidth: 1,
		color: "#EDF5EA",
		flex: 1,
		fontSize: 15,
		minHeight: 44,
		paddingHorizontal: 16,
	},
	sendButton: {
		alignItems: "center",
		backgroundColor: ACCENT,
		borderRadius: 22,
		height: 44,
		justifyContent: "center",
		width: 44,
	},
	sendGlyph: { color: "#0A211D", fontSize: 20, fontWeight: "800" },
	sheetScreen: { flex: 1, justifyContent: "flex-end" },
	backdrop: { backgroundColor: "rgba(0, 0, 0, 0.55)" },
	sheet: {
		backgroundColor: "#111816",
		borderColor: "#1F2C28",
		borderTopLeftRadius: 22,
		borderTopRightRadius: 22,
		borderWidth: 1,
		gap: 12,
		paddingHorizontal: 20,
		paddingTop: 20,
	},
	sheetTitle: {
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
	sheetButton: {
		alignItems: "center",
		backgroundColor: ACCENT,
		borderRadius: 14,
		justifyContent: "center",
		minHeight: 48,
	},
	sheetButtonDisabled: { backgroundColor: "#1F2B28" },
	sheetButtonText: { color: "#0A211D", fontSize: 14, fontWeight: "800" },
	sheetButtonTextDisabled: { color: "#6F8574" },
	sheetHint: {
		color: "#8CA39D",
		fontSize: 12,
		marginTop: -4,
		textAlign: "center",
	},
	sheetClose: { alignItems: "center", justifyContent: "center", minHeight: 44 },
	sheetCloseText: { color: "#BFD9D3", fontSize: 14, fontWeight: "700" },
	pressedSoft: { opacity: 0.6 },
	pressedStrong: { opacity: 0.82 },
	pressedRow: { opacity: 0.7 },
});
