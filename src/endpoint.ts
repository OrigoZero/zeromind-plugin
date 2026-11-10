/** Service endpoints use HTTPS, with HTTP available for loopback development. */
export function checkedEndpoint(value: string): string {
  const u = new URL(value);
  if (
    u.username ||
    u.password ||
    u.hash ||
    (u.protocol !== "https:" &&
      !(u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
  ) {
    throw new Error("Endpoint must use HTTPS or HTTP loopback");
  }
  return u.href;
}
