/// <reference types="bun-types" />

const commands: string[][] = [
	["bunx", "biome", "check", "."],
	["bunx", "tsc", "--noEmit"],
	[
		"bunx",
		"expo",
		"export",
		"--platform",
		"android",
		"--output-dir",
		"/tmp/qvac-demo-android-export",
	],
];

for (const command of commands) {
	const result = Bun.spawnSync(command, {
		cwd: process.cwd(),
		stderr: "inherit",
		stdout: "inherit",
	});
	if (result.exitCode !== 0) {
		throw new Error(`${command.join(" ")} exited with ${result.exitCode}`);
	}
}
