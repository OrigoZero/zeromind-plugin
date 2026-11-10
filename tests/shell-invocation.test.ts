import { expect, it } from "vitest";
import { shellInvocation, shellWord } from "../src/shell-invocation.js";

it("preserves empty and shell-sensitive argument boundaries", () => {
  expect(shellWord("a'b $(pwd)\n")).toBe("'a'\\''b $(pwd)\n'");
  expect(shellInvocation(["-c", 'printf "%s" "$1"', "named shell", "", "a'b"], () => "")).toBe(
    `bash -c 'printf "%s" "$1"' 'named shell' '' 'a'\\''b'`,
  );
});

it("reads host script text only for stdin mode and keeps engine script paths literal", () => {
  const unexpectedRead = () => {
    throw new Error("stdin is command input");
  };
  expect(shellInvocation(["-c", "cat"], unexpectedRead)).toBe("cat");
  expect(shellInvocation(["/zero/source/a b.sh", "$(touch injected)"], unexpectedRead)).toBe(
    "bash -- '/zero/source/a b.sh' '$(touch injected)'",
  );
  expect(shellInvocation(["-s", "one two", ""], () => 'echo "$@"')).toBe(
    `bash -c 'echo "$@"' zero-shell 'one two' ''`,
  );
  expect(() => shellInvocation(["-c"], unexpectedRead)).toThrow("Usage:");
});
