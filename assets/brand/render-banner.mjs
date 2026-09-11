import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const HERE = import.meta.dirname;
const WIDTH = Number(process.argv[2] ?? 1920);
const HEIGHT = Number(process.argv[3] ?? 640);
const STEP = 64;
const CELL = 48;
const COLUMNS = Math.ceil(WIDTH / STEP);
const ROWS = Math.ceil(HEIGHT / STEP);
const TOP = (HEIGHT - ROWS * STEP) / 2 + (STEP - CELL) / 2;
const LEFT = (WIDTH - COLUMNS * STEP) / 2 + (STEP - CELL) / 2;
const BACKGROUND = "#0B0F0E";
const LIME = "#B8F56F";
const GRID = "#131B16";
const ACCENT = "#1A261D";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const amplitude = (column) =>
	clamp(
		0.55 +
			0.25 * Math.sin(column * 0.9) +
			0.15 * Math.sin(column * 2.3 + 1) +
			0.08 * Math.sin(column * 5.1 + 2),
		0.14,
		0.95,
	);
const noise = (column, row) => {
	const x = Math.sin(column * 12.9898 + row * 78.233) * 43758.5453;
	return x - Math.floor(x);
};

const shapes = [];
const rect = (x, y, width, height, radius, fill, opacity) =>
	shapes.push(
		`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" fill-opacity="${opacity.toFixed(3)}"/>`,
	);

for (let column = 0; column < COLUMNS; column++) {
	const t = column / (COLUMNS - 1);
	const x = LEFT + column * STEP;
	const lit = Math.max(2, 2 * Math.round((amplitude(column) * ROWS) / 2));
	const first = (ROWS - lit) / 2;

	if (t <= 0.4) {
		const height = Math.round(amplitude(column) * (HEIGHT - 2 * STEP) + CELL);
		rect(x, (HEIGHT - height) / 2, CELL, height, CELL / 2, LIME, 0.2 - t * 0.2);
		continue;
	}

	for (let row = 0; row < ROWS; row++) {
		const y = TOP + row * STEP;
		const inWave = row >= first && row < first + lit;
		if (t < 0.68) {
			const emerge = (t - 0.4) / 0.28;
			if (inWave) rect(x, y, CELL, CELL, 12, LIME, 0.12 - emerge * 0.06);
			else if (noise(column, row) < emerge) rect(x, y, CELL, CELL, 12, GRID, 1);
			continue;
		}
		rect(x, y, CELL, CELL, 12, noise(row, column) > 0.9 ? ACCENT : GRID, 1);
	}
}

const name = `v2s-background-${WIDTH}x${HEIGHT}`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><rect width="${WIDTH}" height="${HEIGHT}" fill="${BACKGROUND}"/>${shapes.join("")}</svg>`;
writeFileSync(`${HERE}/${name}.svg`, svg);
execFileSync("magick", ["-background", "none", `${HERE}/${name}.svg`, `${HERE}/${name}.png`]);
console.log(`${shapes.length} shapes → ${name}.png`);
