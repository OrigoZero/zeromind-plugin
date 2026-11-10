// Run after login: node tools/validate-hosted-cli.mjs <unclaimed-engine-session>.
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const session = process.argv[2];
if (!session) throw new Error("Pass an unclaimed engine session from zero sessions");
const context = `cli-runtime-${process.pid}`;
const run = (...args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["dist/index.js", "--context", context, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
const call = async (tool, input = {}) => {
  const r = await run("call", tool, "--input", JSON.stringify(input));
  assert.equal(r.code, 0, r.stderr);
  const envelope = JSON.parse(r.stdout);
  return (
    envelope.structuredContent ?? JSON.parse(envelope.content.find((c) => c.type === "text").text)
  );
};
const connected = await run("connect", "--session", session);
assert.equal(connected.code, 0, connected.stderr);
try {
  await call("guides", { path: "readme" });
  for (let attempt = 0; attempt < 2; attempt++) {
    let r = await run("bash", "-c", "export ZERO_CLI_PROBE=retained; cd /zero/source; pwd");
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, "/zero/source\n");
    r = await run("bash", "-c", "pwd; printenv ZERO_CLI_PROBE; printf warning >&2; exit 7");
    assert.deepEqual(r, { code: 7, stdout: "/zero/source\nretained\n", stderr: "warning" });
    console.log(
      `PASS repeated invocation ${attempt + 1}: pin, cwd, environment, stdout, stderr, status`,
    );
  }
  const delayed = await run("bash", "-c", "sleep 22; printf promoted");
  assert.deepEqual(delayed, { code: 0, stdout: "promoted", stderr: "" });
  console.log("PASS promoted task completes through wait");
  const refused = await run(
    "connect",
    "--session",
    session,
    "--branch",
    "cli-validation-missing-branch",
  );
  assert.notEqual(refused.code, 0);
  const afterRefusal = await run("bash", "-c", "pwd");
  assert.equal(afterRefusal.stdout, "/zero/source\n");
  console.log("PASS branch mismatch is refused without changing the pin");
  const adapter = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["dist/shell.js", "-c", "pwd; printf adapter"], {
      env: { ...process.env, ZERO_CONTEXT: context },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
  assert.deepEqual(adapter, { code: 0, stdout: "/zero/source\nadapter", stderr: "" });
  console.log("PASS shell executable adapter uses the same selected engine and shell");
  if (process.argv[3]) {
    const captured = await run(
      "call",
      "capture",
      "--input",
      JSON.stringify({ width: 480, height: 270 }),
    );
    assert.equal(captured.code, 0, captured.stderr);
    const block = JSON.parse(captured.stdout).content.find((c) => c.type === "image");
    assert.ok(block?.data, "capture returns an MCP image block");
    writeFileSync(process.argv[3], Buffer.from(block.data, "base64"), { flag: "wx" });
    console.log("PASS capture image transfers through generic CLI calls");
  }
} finally {
  await run("bash", "-c", "unset ZERO_CLI_PROBE; cd /zero");
  await call("world.disconnect");
}
