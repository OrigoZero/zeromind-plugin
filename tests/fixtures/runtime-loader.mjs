import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A private ELF dependency models a runtime library absent before provisioning. */
export function runtimeLoaderFixture() {
  const root = mkdtempSync(join(tmpdir(), "zero-runtime-loader-"));
  const compile = (args) => {
    const result = spawnSync("cc", args, { encoding: "utf8", timeout: 20000 });
    if (result.status !== 0) throw new Error(result.stderr || String(result.error));
    return result.stdout.trim();
  };
  const dispose = () => rmSync(root, { recursive: true, force: true });
  try {
    for (const name of ["build", "base", "runtime"]) mkdirSync(join(root, name));
    writeFileSync(join(root, "runtime.c"), "int zero_fixture_runtime(void) { return 1; }\n");
    writeFileSync(
      join(root, "native.c"),
      `
#include <stdio.h>
#include <string.h>
extern int zero_fixture_runtime(void);
int main(int argc, char **argv) {
  if (zero_fixture_runtime() != 1) return 5;
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--help") == 0) {
      puts("--software-rendering --check-renderer");
      return 0;
    }
  }
  puts("{\\\"headless\\\":true,\\\"kind\\\":\\\"cpu\\\",\\\"adapter\\\":\\\"loader fixture\\\",\\\"driver\\\":\\\"fixture\\\",\\\"width\\\":640,\\\"height\\\":360}");
  return 0;
}
`,
    );
    const library = join(root, "build", "libasound.so.2");
    compile([
      "-shared",
      "-fPIC",
      "-Wl,-soname,libasound.so.2",
      join(root, "runtime.c"),
      "-o",
      library,
    ]);
    const binary = join(root, "native");
    compile([
      join(root, "native.c"),
      "-L" + join(root, "build"),
      "-Wl,-l:libasound.so.2",
      "-Wl,-rpath,$ORIGIN/base:$ORIGIN/runtime",
      "-Wl,-z,nodefaultlib",
      "-o",
      binary,
    ]);
    copyFileSync(compile(["-print-file-name=libc.so.6"]), join(root, "base", "libc.so.6"));
    return {
      binary,
      installRuntime: () => copyFileSync(library, join(root, "runtime", "libasound.so.2")),
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
