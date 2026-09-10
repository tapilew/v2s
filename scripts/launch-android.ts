/// <reference types="bun-types" />

type Command = string[];

type SyncResult = {
	code: number;
	stdout: string;
	stderr: string;
};

const decoder = new TextDecoder();

const runSync = (command: Command): SyncResult => {
	const result = Bun.spawnSync(command);
	return {
		code: result.exitCode,
		stdout: decoder.decode(result.stdout).trim(),
		stderr: decoder.decode(result.stderr).trim(),
	};
};

const quote = (value: string): string =>
	`'${value.replaceAll("'", "'\"'\"'")}'`;

const repoRoot = process.cwd();
const port = process.env.EXPO_PORT || "8085";
const avd = process.env.ANDROID_AVD || "Pixel_10_Pro";
const windowsUser = runSync([
	"cmd.exe",
	"/d",
	"/c",
	"echo",
	"%USERNAME%",
]).stdout;

if (!windowsUser) {
	throw new Error("Could not determine the Windows username from WSL.");
}

const sdkRoot = `/mnt/c/Users/${windowsUser}/AppData/Local/Android/Sdk`;
const windowsSdkRoot = `C:\\Users\\${windowsUser}\\AppData\\Local\\Android\\Sdk`;
const adbPath = `${sdkRoot}/platform-tools/adb.exe`;
const emulatorPath = `${sdkRoot}/emulator/emulator.exe`;

for (const [label, path] of [
	["Android SDK ADB", adbPath],
	["Android Emulator", emulatorPath],
]) {
	if (!(await Bun.file(path).exists())) {
		throw new Error(`${label} was not found at ${path}`);
	}
}

const wrapperRoot = `${process.env.TMPDIR || "/tmp"}/qvac-demo-adb`;
const wrapperPath = `${wrapperRoot}/adb`;
const launchScript = `${wrapperRoot}/launch.sh`;
runSync(["mkdir", "-p", wrapperRoot]);
await Bun.write(
	wrapperPath,
	`#!/usr/bin/env bash\nexec ${quote(adbPath)} "$@"\n`,
);
runSync(["chmod", "+x", wrapperPath]);

const shellScript = `#!/usr/bin/env bash
set -e
echo "launcher started: $(date -Is)" >>/tmp/qvac-demo-launch.log
cd ${quote(repoRoot)}
export ANDROID_HOME=${quote(sdkRoot)}
export ANDROID_SDK_ROOT=${quote(sdkRoot)}
export WSL_HOST_IP="$(awk '/nameserver/ {print $2; exit}' /etc/resolv.conf)"
export ADB_SERVER_SOCKET="tcp:\${WSL_HOST_IP}:5037"
export PATH=${quote(wrapperRoot)}:"$PATH"
powershell.exe -NoProfile -NonInteractive -Command ${quote(
	`$adb = '${windowsSdkRoot}\\platform-tools\\adb.exe'; Start-Process -FilePath $adb -ArgumentList @('-a','-P','5037','nodaemon','server','start') -WindowStyle Hidden`,
)} >/tmp/qvac-demo-adb-server.log 2>&1
for attempt in $(seq 1 15); do
  if adb devices | grep -q 'emulator-[0-9].*device'; then
    break
  fi
  sleep 1
done
if ! adb devices | grep -q 'emulator-[0-9].*device'; then
  ${quote(emulatorPath)} -avd ${quote(avd)} >/tmp/qvac-demo-emulator.log 2>&1 &
fi
for attempt in $(seq 1 45); do
  if adb devices | grep -q 'emulator-[0-9].*device'; then
    break
  fi
  sleep 1
done
exec bunx expo start --android --port ${quote(port)}
`;
await Bun.write(launchScript, shellScript);
runSync(["chmod", "+x", launchScript]);

const child = Bun.spawn(["bash", launchScript], {
	cwd: repoRoot,
	stdout: "inherit",
	stderr: "inherit",
});

const exitCode = await child.exited;
if (exitCode !== 0) {
	throw new Error(`Expo launcher exited with code ${exitCode}.`);
}
