import { MEDPSY_EXTRACTOR, QWEN3_EXTRACTOR } from "../models";
import { defineMode, type Mode, type ModeId } from "../sheet";
import { finanzas } from "./finanzas";
import { salud } from "./salud";

export const MODES: Readonly<Record<ModeId, Mode>> = {
	finanzas: defineMode("finanzas", QWEN3_EXTRACTOR, finanzas),
	salud: defineMode("salud", MEDPSY_EXTRACTOR, salud),
};
