import { describe, it, expect } from "vitest";
import { remoteServer, SECRET_ENV } from "../src/server-spec.js";

describe("server-spec", () => {
  it("points at /mcp with the bearer and the harness header", () => {
    expect(remoteServer("cursor", "ins_sec_x", "https://origozero.ai/")).toEqual({
      type: "http",
      url: "https://origozero.ai/mcp",
      headers: { Authorization: "Bearer ins_sec_x", "X-ZM-Harness": "cursor" },
    });
  });
  it("can carry an expansion instead of a literal", () => {
    const s = remoteServer("claude-code", `\${${SECRET_ENV}}`);
    expect(s.headers.Authorization).toBe("Bearer ${ZEROMIND_INSTALL_SECRET}");
    expect(s.url).toBe("https://origozero.ai/mcp");
  });
});
