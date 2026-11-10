import { afterEach, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bashEnvPath } from "../src/bash-env.js";

const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function invoke(args: string[], input = "") {
  const root = mkdtempSync(join(tmpdir(), "zero bash bridge "));
  roots.push(root);
  mkdirSync(join(root, "templates"));
  mkdirSync(join(root, "dist"));
  copyFileSync(bashEnvPath(), join(root, "templates", "bash-env.sh"));
  writeFileSync(
    join(root, "dist", "shell.js"),
    `let input=''; process.stdin.on('data', c => input += c); process.stdin.on('end', () => {
      process.stdout.write(JSON.stringify({args:process.argv.slice(2), input, hook:process.env.BASH_ENV ?? null}));
      process.stderr.write('remote-stderr'); process.exitCode=23;
    });`,
  );
  const result = spawnSync(bash, ["--noprofile", "--norc", ...args], {
    input,
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, BASH_ENV: join(root, "templates", "bash-env.sh").replaceAll("\\", "/") },
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(23);
  expect(result.stderr).toBe("remote-stderr");
  return JSON.parse(result.stdout);
}

it.skipIf(!existsSync(bash))(
  "routes Bash commands with literal positional arguments and separate status/streams",
  () => {
    const command = "printf '%s' \"$1\"; exit 99";
    expect(invoke(["-c", command, "named shell", "", "a b", "/zero/source/a b", "$(pwd)"])).toEqual(
      {
        args: ["-c", command, "named shell", "", "a b", "/zero/source/a b", "$(pwd)"],
        input: "",
        hook: null,
      },
    );
    expect(invoke(["--login", "-c", "", "zero"])).toEqual({
      args: ["-c", "", "zero"],
      input: "",
      hook: null,
    });
  },
);

it.skipIf(!existsSync(bash))(
  "routes stdin scripts and engine script paths before host execution",
  () => {
    expect(invoke(["-s", "--", "one two", ""], "printf script")).toEqual({
      args: ["-s", "one two", ""],
      input: "printf script",
      hook: null,
    });
    expect(invoke(["/zero/source/only in engine.sh", "", "a b"])).toEqual({
      args: ["/zero/source/only in engine.sh", "", "a b"],
      input: "",
      hook: null,
    });
  },
);
