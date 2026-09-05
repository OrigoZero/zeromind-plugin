import { issuer as resolvedIssuer } from "./zeromind-client.js";

export const SECRET_ENV = "ZEROMIND_INSTALL_SECRET";
export const ISSUER_ENV = "ZEROMIND_ISSUER";
export const SERVER_KEY = "zeromind";

export type RemoteServer = { type: "http"; url: string; headers: Record<string, string> };

/** The entry a harness config holds. `bearer` is the literal secret, or an expansion the harness performs. */
export const remoteServer = (harness: string, bearer: string, issuer?: string): RemoteServer => ({
  type: "http",
  url: `${(issuer ?? resolvedIssuer()).replace(/\/+$/, "")}/mcp`,
  headers: { Authorization: `Bearer ${bearer}`, "X-ZM-Harness": harness },
});
