import {
  createLinkCode,
  getLinkStatus,
  postUnlink,
  type LinkCodeResponse,
  type LinkStatusResponse,
} from "./zeromind-client.js";
import { clearInstall, installSecret, type SessionCache } from "./config.js";

/** The credential shape the three link REST calls take, read off a SessionCache. */
const linkCreds = (cache: SessionCache): { install_id: string; install_secret: string } => ({
  install_id: cache.install_id!,
  install_secret: installSecret(cache)!,
});

export const startDeviceCode = async (
  cache: SessionCache,
  suggestedUsername?: string,
): Promise<LinkCodeResponse> => createLinkCode(linkCreds(cache), suggestedUsername);

export const pollLinkStatus = async (cache: SessionCache): Promise<LinkStatusResponse> =>
  getLinkStatus(linkCreds(cache));

/** What the revoke found upstream before the machine's link was cleared. */
export type UnlinkOutcome = "revoked" | "already-revoked";

/** A status meaning ZeroMind holds no such install: the local clear is then
 *  the whole job, and refusing to do it would strand the machine. */
const ALREADY_GONE = new Set([401, 403, 404]);

/**
 * Revoke this machine's install upstream, then clear it locally. A revoke
 * that cannot be made — the network is down, ZeroMind is failing — leaves the
 * cache exactly as it was, so the operator can run the command again.
 */
export const unlink = async (cache: SessionCache): Promise<UnlinkOutcome> => {
  let status: number;
  try {
    status = await postUnlink(linkCreds(cache));
  } catch (e) {
    throw new Error(
      `could not reach ZeroMind (${(e as Error).message}); this machine's link is untouched — run \`zeromind unlink\` again once ZeroMind is reachable`,
    );
  }
  if (status >= 300 && !ALREADY_GONE.has(status)) {
    throw new Error(
      `ZeroMind answered ${status}; this machine's link is untouched — run \`zeromind unlink\` again once ZeroMind is reachable`,
    );
  }
  clearInstall();
  return status < 300 ? "revoked" : "already-revoked";
};
