import { foldText } from "../grounding";

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const WEEKDAYS = [
	"domingo",
	"lunes",
	"martes",
	"miercoles",
	"jueves",
	"viernes",
	"sabado",
];

const MONTHS = [
	"enero",
	"febrero",
	"marzo",
	"abril",
	"mayo",
	"junio",
	"julio",
	"agosto",
	"septiembre",
	"octubre",
	"noviembre",
	"diciembre",
];

const pad = (value: number) => String(value).padStart(2, "0");

export const isoDate = (date: Date) =>
	`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const daysAgo = (now: Date, days: number) => {
	const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	date.setDate(date.getDate() - days);
	return date;
};

export const weekdayIndex = (word: string) => WEEKDAYS.indexOf(foldText(word));

export const isWeekday = (text: string) => weekdayIndex(text.trim()) !== -1;

// The most recent such day on or before today; "lunes" said on a Monday means today.
export const weekdayDate = (weekday: number, now: Date) =>
	daysAgo(now, (now.getDay() - weekday + 7) % 7);

export type DateSupport = { dates: string[]; hasYear: boolean };

// Every day the text names. "hoy" or no day word at all means today.
export const supportedDates = (text: string, now: Date): DateSupport => {
	const folded = foldText(text);
	const words = new Set(folded.match(/\p{L}+/gu) ?? []);
	const found = new Set<string>();
	if (words.has("hoy")) found.add(isoDate(now));
	if (words.has("ayer")) found.add(isoDate(daysAgo(now, 1)));
	if (words.has("anteayer") || words.has("antier"))
		found.add(isoDate(daysAgo(now, 2)));
	WEEKDAYS.forEach((name, index) => {
		if (words.has(name)) found.add(isoDate(weekdayDate(index, now)));
	});
	for (const match of folded.matchAll(/\b(\d{1,2}) de (\p{L}+)/gu)) {
		const month = MONTHS.indexOf(match[2]);
		if (month !== -1)
			found.add(isoDate(new Date(now.getFullYear(), month, Number(match[1]))));
	}
	for (const match of folded.matchAll(/\b(\d{1,2})\/(\d{1,2})\b/g)) {
		const month = Number(match[2]) - 1;
		if (month >= 0 && month < 12)
			found.add(isoDate(new Date(now.getFullYear(), month, Number(match[1]))));
	}
	if (found.size === 0) found.add(isoDate(now));
	return { dates: [...found], hasYear: /\b(19|20)\d{2}\b/.test(folded) };
};

export const groundDate = (cell: string, support: DateSupport, now: Date) => {
	if (support.hasYear || support.dates.includes(cell)) return cell;
	return support.dates.length === 1 ? support.dates[0] : isoDate(now);
};
