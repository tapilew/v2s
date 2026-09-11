#!/usr/bin/env python3
"""Check an installed V2S APK on a real device. Does not clear app data.

Usage: ADB=/path/to/adb ANDROID_SERIAL=<device> python3 scripts/smoke-android-startup.py
Exit codes: 0 = startup passed, 1 = app closed, 2 = test setup failed.
App-scoped logs stay in a private temporary directory; review before sharing.
"""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time


def redact(text):
    text = re.sub(r"(?i)(Bearer\s+)\S+", r"\1<REDACTED>", text)
    return re.sub(
        r"(?i)((?:api[_-]?key|access[_-]?token|authorization)\s*[:=]\s*)\S+",
        r"\1<REDACTED>",
        text,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=int, default=8)
    args = parser.parse_args()
    if args.seconds < 1:
        parser.error("--seconds must be positive")
    os.umask(0o077)
    output = Path(tempfile.mkdtemp(prefix="v2s-startup-"))
    config = json.loads((Path(__file__).resolve().parents[1] / "app.json").read_text())
    package = config["expo"]["android"]["package"]
    if not re.fullmatch(r"[A-Za-z0-9_.]+", package):
        raise RuntimeError("Invalid application package")
    executable = os.environ.get("ADB", "adb")

    def adb(*arguments, check=True):
        result = subprocess.run(
            [executable, *arguments], capture_output=True, text=True, timeout=20
        )
        if check and result.returncode:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip())
        return (result.stdout + result.stderr).strip()

    if adb("get-state") != "device":
        raise RuntimeError("Select an authorized phone using ANDROID_SERIAL")
    packages = adb("shell", "cmd", "package", "list", "packages", "-U", package)
    uid = re.search(r"package:" + re.escape(package) + r"\s+uid:(\d+)", packages)
    if not uid:
        raise RuntimeError("V2S is not installed for the current user")
    activity = adb(
        "shell", "cmd", "package", "resolve-activity", "--brief", package
    ).splitlines()[-1]
    if not activity.startswith(package + "/"):
        raise RuntimeError("V2S launcher activity was not found")

    adb("shell", "am", "force-stop", package)
    since = adb("shell", "date '+%m-%d %H:%M:%S.000'")
    launch = adb("shell", "am", "start", "-W", "-n", activity)
    if "Status: ok" not in launch:
        raise RuntimeError("Launch request failed: " + launch)
    observations = []
    for _ in range(args.seconds):
        time.sleep(1)
        pid = adb("shell", "pidof", package, check=False)
        observations.append({"at": time.time(), "pid": pid})
        if not pid:
            break
    if adb("get-state") != "device":
        raise RuntimeError("Phone disconnected during the test")
    foreground = adb(
        "shell",
        "dumpsys activity activities | grep -E 'mResumedActivity|topResumedActivity' "
        f"| grep -F '{package}/'",
        check=False,
    )
    logs = redact(adb(
        "logcat", "-b", "main,system,crash", "--uid=" + uid.group(1),
        "-d", "-T", since, "-v", "threadtime",
    ))
    fatal = any(marker in logs for marker in ("Fatal signal", "FATAL EXCEPTION"))
    passed = bool(observations[-1]["pid"] and foreground and not fatal)
    result = {
        "verdict": "PASS" if passed else "FAIL",
        "package": package,
        "required_foreground_seconds": args.seconds,
        "observations": observations,
        "foreground": foreground,
        "fatal_log": fatal,
        "artifacts": str(output),
    }
    (output / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    (output / "launch.txt").write_text(redact(launch) + "\n")
    (output / "app-startup.log").write_text(logs + "\n")
    print(json.dumps(result, indent=2), flush=True)
    for line in logs.splitlines():
        if re.search(r"ReactNativeJS|FATAL|Fatal signal|couldn't find DSO", line):
            print(line)
    return 0 if passed else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, RuntimeError, subprocess.TimeoutExpired, ValueError, KeyError, IndexError) as error:
        print(f"INCONCLUSIVE: {redact(str(error))}", file=sys.stderr)
        sys.exit(2)
