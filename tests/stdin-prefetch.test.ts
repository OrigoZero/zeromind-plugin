import { expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { watchStdin } from "../src/stdin-prefetch.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

it("reports an ended stdin with everything it carried", async () => {
  const input = new PassThrough();
  const watch = watchStdin(input);
  input.end("piped\n");
  await tick();
  const seen = watch.snapshot();
  expect(seen.data.toString()).toBe("piped\n");
  expect(seen.ended).toBe(true);
});

it("reports an open stdin without waiting for it, and leaves later bytes in the stream", async () => {
  const input = new PassThrough();
  const watch = watchStdin(input);
  input.write("first");
  await tick();
  const seen = watch.snapshot();
  expect(seen.data.toString()).toBe("first");
  expect(seen.ended).toBe(false);
  input.end("second");
  const rest: Buffer[] = [];
  for await (const chunk of input) rest.push(chunk as Buffer);
  expect(Buffer.concat(rest).toString()).toBe("second");
});

it("reads no more than its limit and keeps the rest readable", async () => {
  const input = new PassThrough();
  const watch = watchStdin(input, 10);
  input.end("0123456789abcdef");
  await tick();
  const seen = watch.snapshot();
  expect(seen.data.toString()).toBe("0123456789");
  expect(seen.ended).toBe(false);
  const rest: Buffer[] = [];
  for await (const chunk of input) rest.push(chunk as Buffer);
  expect(Buffer.concat(rest).toString()).toBe("abcdef");
});

it("sees a stdin that had already ended", async () => {
  const input = new PassThrough();
  input.end();
  for await (const chunk of input) void chunk;
  expect(watchStdin(input).snapshot()).toEqual({ data: Buffer.alloc(0), ended: true });
});
