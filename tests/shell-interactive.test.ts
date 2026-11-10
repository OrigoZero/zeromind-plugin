import { expect, it } from "vitest";
import { PassThrough, Writable } from "node:stream";
import { interactiveShell } from "../src/shell-interactive.js";

const answer = (result: unknown) => ({ text: JSON.stringify({ result }), isError: false });
const sink = () =>
  new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });

it("preserves multiline input and closes its attachment after EOF without destroying host stdin", async () => {
  // Keep the host stream after EOF so the test measures the adapter's cleanup.
  const input = new PassThrough({ autoDestroy: false });
  let sent = "",
    eof = false,
    closed = false;
  const client = {
    callTool: async (_name: string, args: Record<string, unknown>) => {
      const code = String(args.code);
      if (code.includes("rawget")) {
        expect(code).toContain(", true)");
        return answer({ handle: "terminal" });
      }
      if (code.includes("shell.write")) {
        const encoded = code.match(/base64.decode\(\[=\[\n([A-Za-z0-9+/=]*)\]=\]\)/)?.[1];
        expect(encoded).toBeDefined();
        sent += Buffer.from(encoded!, "base64").toString();
        if (code.includes(", true)")) eof = true;
        return answer(true);
      }
      if (code.includes("shell.close")) {
        closed = true;
        return answer(true);
      }
      return answer({ stdoutBase64: "", stderrBase64: "", exitCode: eof ? 5 : null });
    },
  };
  const running = interactiveShell(client, input, sink(), sink());
  input.end("for x in a b; do\r\nprintf '%s' \"$x\"\r\ndone\r\n");
  expect(await running).toBe(5);
  expect(sent).toBe("for x in a b; do\nprintf '%s' \"$x\"\ndone\n");
  expect(closed).toBe(true);
  expect(input.destroyed).toBe(false);
});

it("forwards repeated terminal Ctrl+C and restores local terminal mode", async () => {
  let raw = false;
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: (enabled: boolean) => {
      raw = enabled;
    },
  });
  const stdout = Object.assign(sink(), { isTTY: true, columns: 80 });
  let interrupts = 0,
    emitted = 0;
  const client = {
    callTool: async (_name: string, args: Record<string, unknown>) => {
      const code = String(args.code);
      if (code.includes("rawget")) return answer({ handle: "terminal" });
      if (code.includes("shell.interrupt")) {
        interrupts++;
        return answer(true);
      }
      if (code.includes("shell.close") || code.includes("shell.write")) return answer(true);
      if (emitted === interrupts && emitted < 2) {
        emitted++;
        input.write("partial\x03");
      }
      return answer({ stdoutBase64: "", stderrBase64: "", exitCode: interrupts === 2 ? 0 : null });
    },
  };
  expect(await interactiveShell(client, input, stdout, sink())).toBe(0);
  expect(interrupts).toBe(2);
  expect(raw).toBe(false);
  expect(input.destroyed).toBe(false);
});
