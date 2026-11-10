import { expect, it } from "vitest";
import { PassThrough, Writable } from "node:stream";
import { streamShell } from "../src/shell-stream.js";

const answer = (result: unknown) => ({ text: JSON.stringify({ result }), isError: false });

it("follows queued stream operations without dispatching them twice", async () => {
  const input = new PassThrough();
  input.end();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const operations: string[] = [];
  const pending = new Map<number, ReturnType<typeof answer>>();
  let nextId = 0;
  const client = {
    callTool: async (name: string, args: Record<string, unknown>) => {
      if (name === "wait") {
        if (args.kickoffId !== undefined)
          return {
            text: JSON.stringify({ status: "running", taskId: Number(args.kickoffId) }),
            isError: false,
          };
        return pending.get(Number(args.taskId))!;
      }
      const code = String(args.code);
      operations.push(code);
      const result = code.includes("rawget")
        ? { handle: "owned" }
        : code.includes("shell.read")
          ? { stdoutBase64: "", stderrBase64: "", exitCode: 17 }
          : true;
      const id = ++nextId;
      pending.set(id, answer(result));
      return { text: JSON.stringify({ status: "running", kickoffId: String(id) }), isError: false };
    },
  };
  expect(await streamShell(client, "exit 17", input, stdout, stderr)).toBe(17);
  expect(operations.filter((code) => code.includes("rawget"))).toHaveLength(1);
  expect(operations.filter((code) => code.includes("shell.read"))).toHaveLength(1);
  expect(operations.filter((code) => code.includes("shell.close"))).toHaveLength(1);
});

it("drains a finished command when stdin arrives after the engine closes input", async () => {
  const input = new PassThrough();
  input.end("late input");
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let attempted = false;
  let closed = false;
  const client = {
    callTool: async (_name: string, args: Record<string, unknown>) => {
      const code = String(args.code);
      if (code.includes("rawget")) return answer({ handle: "finished" });
      if (code.includes("shell.write")) {
        attempted = true;
        return answer(false);
      }
      if (code.includes("shell.close")) {
        closed = true;
        return answer(true);
      }
      return answer({ stdoutBase64: "", stderrBase64: "", exitCode: attempted ? 7 : null });
    },
  };
  expect(await streamShell(client, "exit 7", input, stdout, stderr)).toBe(7);
  expect(closed).toBe(true);
});

it("delivers output before stdin EOF and carries binary input, stderr and exit status", async () => {
  const input = new PassThrough();
  let eof = false,
    closed = false,
    ready = false;
  let sent = "",
    out = "",
    err = "";
  const stdout = new Writable({
    write(chunk, _encoding, cb) {
      out += chunk.toString();
      if (!ready) {
        ready = true;
        input.end(Buffer.from([0, 255, 10]));
      }
      cb();
    },
  });
  const stderr = new Writable({
    write(chunk, _encoding, cb) {
      err += chunk.toString();
      cb();
    },
  });
  const client = {
    callTool: async (_name: string, args: Record<string, unknown>) => {
      const code = String(args.code);
      if (code.includes("rawget")) return answer({ handle: "owned" });
      if (code.includes("shell.write")) {
        if (code.includes(", true)")) eof = true;
        else sent += code;
        return answer(true);
      }
      if (code.includes("shell.close")) {
        closed = true;
        return answer(true);
      }
      if (!ready)
        return answer({
          stdoutBase64: Buffer.from("ready").toString("base64"),
          stderrBase64: "",
          exitCode: null,
        });
      return answer({
        stdoutBase64: "",
        stderrBase64: eof ? Buffer.from("error").toString("base64") : "",
        exitCode: eof ? 9 : null,
      });
    },
  };
  expect(await streamShell(client, "read x", input, stdout, stderr)).toBe(9);
  expect(out).toBe("ready");
  expect(err).toBe("error");
  expect(sent).toContain("AP8K");
  expect(closed).toBe(true);
});

it("propagates SIGINT to the engine and closes the owned handle", async () => {
  const input = new PassThrough(),
    stdout = new PassThrough(),
    stderr = new PassThrough();
  let interrupted = false,
    signalled = false,
    closed = false;
  const before = process.listenerCount("SIGINT");
  const client = {
    callTool: async (_name: string, args: Record<string, unknown>) => {
      const code = String(args.code);
      if (code.includes("rawget")) return answer({ handle: "owned" });
      if (code.includes("shell.interrupt")) {
        interrupted = true;
        return answer(true);
      }
      if (code.includes("shell.close")) {
        closed = true;
        return answer(true);
      }
      if (!signalled) {
        signalled = true;
        process.emit("SIGINT");
      }
      return answer({ stdoutBase64: "", stderrBase64: "", exitCode: interrupted ? 130 : null });
    },
  };
  expect(await streamShell(client, "read x", input, stdout, stderr)).toBe(130);
  expect(closed).toBe(true);
  expect(process.listenerCount("SIGINT")).toBe(before);
});
