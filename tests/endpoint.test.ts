import { expect, it } from "vitest";
import { checkedEndpoint } from "../src/endpoint.js";

it("refuses insecure non-loopback endpoints and credentials in URLs", () => {
  expect(() => checkedEndpoint("http://localhost.evil.example/token")).toThrow();
  expect(() => checkedEndpoint("https://user:password@example.com/token")).toThrow();
  expect(() => checkedEndpoint("https://example.com/token#private")).toThrow();
  expect(() => checkedEndpoint("file:///tmp/token")).toThrow();
  expect(checkedEndpoint("http://127.0.0.1:123/token")).toContain("127.0.0.1");
  expect(checkedEndpoint("http://[::1]:123/token")).toContain("[::1]");
});
