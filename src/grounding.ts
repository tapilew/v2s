const SPOKEN_NUMBERS = new Map(
	Object.entries({
		cero: 0,
		uno: 1,
		dos: 2,
		tres: 3,
		cuatro: 4,
		cinco: 5,
		seis: 6,
		siete: 7,
		ocho: 8,
		nueve: 9,
		diez: 10,
		once: 11,
		doce: 12,
		trece: 13,
		catorce: 14,
		quince: 15,
		dieciseis: 16,
		diecisiete: 17,
		dieciocho: 18,
		diecinueve: 19,
		veinte: 20,
		veintiun: 21,
		veintiuno: 21,
		veintiuna: 21,
		veintidos: 22,
		veintitres: 23,
		veinticuatro: 24,
		veinticinco: 25,
		veintiseis: 26,
		veintisiete: 27,
		veintiocho: 28,
		veintinueve: 29,
		treinta: 30,
		cuarenta: 40,
		cincuenta: 50,
		sesenta: 60,
		setenta: 70,
		ochenta: 80,
		noventa: 90,
		cien: 100,
		ciento: 100,
		doscientos: 200,
		doscientas: 200,
		trescientos: 300,
		trescientas: 300,
		cuatrocientos: 400,
		cuatrocientas: 400,
		quinientos: 500,
		quinientas: 500,
		seiscientos: 600,
		seiscientas: 600,
		setecientos: 700,
		setecientas: 700,
		ochocientos: 800,
		ochocientas: 800,
		novecientos: 900,
		novecientas: 900,
	}),
);

const UNITS_AFTER_Y = new Map([
	["un", 1],
	["una", 1],
	["uno", 1],
	["dos", 2],
	["tres", 3],
	["cuatro", 4],
	["cinco", 5],
	["seis", 6],
	["siete", 7],
	["ocho", 8],
	["nueve", 9],
]);

const magnitude = (value: number) => (value >= 100 ? 3 : value >= 10 ? 2 : 1);

// Each word must be a smaller order than the one before, so "dos tres" stays two numbers and "por ciento" stays words.
const readSpoken = (words: readonly string[], start: number) => {
	let total = 0;
	let group = 0;
	let order = 4;
	let at = start;
	for (; at < words.length; at += 1) {
		const word = words[at];
		if (word === "mil") {
			total += (group || 1) * 1000;
			group = 0;
			order = 4;
			continue;
		}
		const value = SPOKEN_NUMBERS.get(word);
		if (value === undefined || magnitude(value) >= order) break;
		if (value === 100 && words[at - 1] === "por") break;
		group += value;
		order = magnitude(value);
		const unit = UNITS_AFTER_Y.get(words[at + 2]);
		if (value >= 30 && value < 100 && words[at + 1] === "y" && unit) {
			group += unit;
			order = 1;
			at += 2;
		}
	}
	return { value: total + group, end: at };
};

const withDigits = (words: readonly string[]) => {
	const tokens: string[] = [];
	let at = 0;
	while (at < words.length) {
		const whole = readSpoken(words, at);
		if (whole.end === at) {
			tokens.push(words[at]);
			at += 1;
			continue;
		}
		const decimal = ["coma", "punto"].includes(words[whole.end])
			? readSpoken(words, whole.end + 1)
			: null;
		if (decimal && decimal.end > whole.end + 1) {
			tokens.push(`${whole.value}.${decimal.value}`);
			at = decimal.end;
		} else {
			tokens.push(String(whole.value));
			at = whole.end;
		}
	}
	return tokens;
};

// Parakeet writes "treinta y ocho coma cinco" as "30 y 8,5". Only the decimal form is joined: "20 y 5" is two amounts.
export const normalizeNumbers = (text: string) =>
	text
		.replace(/\s+/g, " ")
		.trim()
		.replace(
			/\b([2-9]0) y ([1-9]),(\d+)\b/g,
			(_, tens: string, unit: string, decimals: string) =>
				`${Number(tens) + Number(unit)},${decimals}`,
		);

export const foldText = (text: string) =>
	text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// "1,200" is a thousands group and "38,50" a decimal comma; both become plain digits.
export const tokensOf = (text: string) =>
	withDigits(
		foldText(text)
			.replace(/(\d),(\d{3})(?!\d)/g, "$1$2")
			.replace(/(\d),(\d{1,2})(?!\d)/g, "$1.$2")
			.match(/\d+(?:\.\d+)?|\p{L}+/gu) ?? [],
	);

const isNumberToken = (token: string) => /^\d/.test(token);

export const numbersIn = (text: string) =>
	tokensOf(text).filter(isNumberToken).map(Number);

const CEDULA = /^[a-z]{0,2}-?\d+(?:-\d+)+$/i;

const digitsOf = (text: string) => text.replace(/\D/g, "");

export const groundedNumber = (value: number | string, source: string) => {
	const wanted = String(value).trim();
	if (CEDULA.test(wanted))
		return source
			.split(/\s+/)
			.some((token) => digitsOf(token) === digitsOf(wanted));
	const said = new Set(numbersIn(source));
	const numbers = numbersIn(wanted);
	return numbers.length > 0 && numbers.every((number) => said.has(number));
};

export const TEXT_RECALL = 0.7;

export const groundedText = (value: string, source: string) => {
	const said = tokensOf(source);
	const saidWords = new Set(said);
	const saidNumbers = new Set(said.filter(isNumberToken).map(Number));
	const tokens = tokensOf(value);
	const words = tokens.filter(
		(token) => !isNumberToken(token) && token.length > 2,
	);
	const numbers = tokens.filter(isNumberToken).map(Number);
	if (!numbers.every((number) => saidNumbers.has(number))) return false;
	if (words.length === 0) return numbers.length > 0;
	const found = words.filter((word) => saidWords.has(word)).length;
	return found / words.length >= TEXT_RECALL;
};
