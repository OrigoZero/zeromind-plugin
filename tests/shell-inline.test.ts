import { expect, it } from "vitest";
import { PassThrough, Writable } from "node:stream";
import { inlineStartCode, streamShell } from "../src/shell-stream.js";

const answer = (result: unknown) => ({ text: JSON.stringify({ result }), isError: false });
const b64 = (text: string) => Buffer.from(text).toString("base64");
const sink = () => {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(Buffer.from(chunk));
      done();
    },
  });
  return { stream, text: () => Buffer.concat(chunks).toString() };
};
const none = { data: Buffer.alloc(0), ended: true };

it("runs a short command in one call and returns its exit status and separate streams", async () => {
  const calls: string[] = [];
  const out = sink(),
    err = sink();
  const client = {
    callTool: async (name: string, args: Record<string, unknown>) => {
      calls.push(`${name}:${String(args.code)}`);
      return answer({
        handle: "done",
        wrote: true,
        stdout: [b64("he"), b64("llo\n")],
        stderr: [b64("oops\n")],
        exitCode: 3,
      });
    },
  };
  const input = new PassThrough();
  const code = await streamShell(client, "echo hello", input, out.stream, err.stream, false, {
    windowMs: 10_000,
    stdin: none,
  });
  expect(code).toBe(3);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain('rawget(shell, "start")');
  expect(calls[0]).toContain("echo hello");
  expect(calls[0]).toContain('shell.write(handle, "", true)');
  expect(out.text()).toBe("hello\n");
  expect(err.text()).toBe("oops\n");
  expect(input.destroyed).toBe(true);
});

it("carries piped stdin and its end in the same call", async () => {
  const calls: string[] = [];
  const client = {
    callTool: async (_name: string, args: Record<string, unknown>) => {
      calls.push(String(args.code));
      return answer({ handle: "h", wrote: true, stdout: [b64("xyz\n")], stderr: [], exitCode: 0 });
    },
  };
  const out = sink();
  const code = await streamShell(
    client,
    "cat",
    new PassThrough(),
    out.stream,
    sink().stream,
    false,
    { windowMs: 10_000, stdin: { data: Buffer.from("xyz\n"), ended: true } },
  );
  expect(code).toBe(0);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain(b64("xyz\n"));
  expect(calls[0]).toMatch(/shell\.write\(handle, bytes, true\)/);
  expect(out.text()).toBe("xyz\n");
});

it("continues a command that outlives the inline window with streaming reads", async () => {
  const calls: string[] = [];
  let reads = 0;
  const out = sink();
  const client = {
    callTool: async (_name: string, args: Record<string, unknown>) => {
      const code = String(args.code);
      calls.push(code);
      if (code.includes("rawget"))
        return answer({ handle: "slow", wrote: true, stdout: [b64("one\n")], stderr: [] });
      if (code.includes("shell.read")) {
        reads++;
        return answer(
          reads < 3
            ? { stdoutBase64: "", stderrBase64: "", exitCode: null }
            : { stdoutBase64: b64("two\n"), stderrBase64: "", exitCode: 0 },
        );
      }
      return answer(true);
    },
  };
  const code = await streamShell(
    client,
    "sleep 15",
    new PassThrough(),
    out.stream,
    sink().stream,
    false,
    {
      windowMs: 10_000,
      stdin: none,
    },
  );
  expect(code).toBe(0);
  expect(out.text()).toBe("one\ntwo\n");
  expect(calls.filter((c) => c.includes("rawget"))).toHaveLength(1);
  const readCalls = calls.filter((c) => c.includes("shell.read") && !c.includes("rawget"));
  expect(readCalls).toHaveLength(3);
  // Each read waits inside the engine rather than being polled on a host timer.
  expect(readCalls.every((c) => c.includes("task.wait"))).toBe(true);
  const later = calls.filter((c) => !c.includes("rawget"));
  expect(later.filter((c) => c.includes("shell.close"))).toHaveLength(1);
  // The starting call already sent the end of stdin; none is sent again.
  expect(later.filter((c) => c.includes("shell.write"))).toHaveLength(0);
});

it("forwards stdin the starting call could not deliver, then its end", async () => {
  const writes: string[] = [];
  let eof = false;
  const client = {
    callTool: async (_name: string, args: Record<string, unknown>) => {
      const code = String(args.code);
      if (code.includes("rawget"))
        return answer({ handle: "full", wrote: false, stdout: [], stderr: [] });
      if (code.includes("shell.write")) {
        writes.push(code);
        if (code.includes(", true)")) eof = true;
        return answer(true);
      }
      if (code.includes("shell.read"))
        return answer({ stdoutBase64: "", stderrBase64: "", exitCode: eof ? 0 : null });
      return answer(true);
    },
  };
  const code = await streamShell(
    client,
    "cat",
    new PassThrough(),
    sink().stream,
    sink().stream,
    false,
    {
      windowMs: 10_000,
      stdin: { data: Buffer.from("abc"), ended: true },
    },
  );
  expect(code).toBe(0);
  expect(writes[0]).toContain(b64("abc"));
  expect(writes.some((w) => w.includes(", true)"))).toBe(true);
});

it("keeps forwarding an open stdin after the inline window and ends it at EOF", async () => {
  const input = new PassThrough();
  const sent: string[] = [];
  let eof = false;
  const out = sink();
  const client = {
    callTool: async (_name: string, args: Record<string, unknown>) => {
      const code = String(args.code);
      if (code.includes("rawget"))
        return answer({ handle: "open", wrote: true, stdout: [], stderr: [] });
      if (code.includes("shell.write")) {
        sent.push(code);
        if (code.includes(", true)")) eof = true;
        return answer(true);
      }
      if (code.includes("shell.read"))
        return answer({
          stdoutBase64: eof ? b64("done\n") : "",
          stderrBase64: "",
          exitCode: eof ? 0 : null,
        });
      return answer(true);
    },
  };
  const running = streamShell(client, "cat", input, out.stream, sink().stream, false, {
    windowMs: 2_000,
    stdin: { data: Buffer.alloc(0), ended: false },
  });
  input.end("late");
  expect(await running).toBe(0);
  expect(sent.some((c) => c.includes(b64("late")))).toBe(true);
  expect(out.text()).toBe("done\n");
});

it("reports a legacy engine after a single call", async () => {
  const calls: string[] = [];
  const client = {
    callTool: async (_name: string, args: Record<string, unknown>) => {
      calls.push(String(args.code));
      return answer({ legacy: true });
    },
  };
  const before = process.listenerCount("SIGINT");
  expect(
    await streamShell(client, "echo hi", new PassThrough(), sink().stream, sink().stream, false, {
      windowMs: 10_000,
      stdin: none,
    }),
  ).toBeUndefined();
  expect(calls).toHaveLength(1);
  expect(process.listenerCount("SIGINT")).toBe(before);
});

it("interrupts a command once its handle is known when a signal arrived during the inline call", async () => {
  const calls: string[] = [];
  let interrupted = false;
  const before = process.listenerCount("SIGINT");
  const client = {
    callTool: async (_name: string, args: Record<string, unknown>) => {
      const code = String(args.code);
      calls.push(code);
      if (code.includes("rawget")) {
        process.emit("SIGINT");
        return answer({ handle: "busy", wrote: true, stdout: [], stderr: [] });
      }
      if (code.includes("shell.interrupt")) {
        interrupted = true;
        return answer(true);
      }
      if (code.includes("shell.read"))
        return answer({ stdoutBase64: "", stderrBase64: "", exitCode: interrupted ? 130 : null });
      return answer(true);
    },
  };
  expect(
    await streamShell(client, "sleep 100", new PassThrough(), sink().stream, sink().stream, false, {
      windowMs: 10_000,
      stdin: none,
    }),
  ).toBe(130);
  expect(calls.some((c) => c.includes("shell.interrupt(") && c.includes(", 2)"))).toBe(true);
  expect(process.listenerCount("SIGINT")).toBe(before);
});

it("states the wait, the stdin end and the output bound in the starting call's code", () => {
  const code = inlineStartCode("echo 'a]]b'", { windowMs: 2500, stdin: none });
  expect(code).toContain("2.5");
  expect(code).toContain("task.wait");
  expect(code).toContain("echo 'a]]b'");
});
