import { ensureRegistered } from "../install.js";
import { loadConfig } from "../config.js";
import { startDeviceCode, pollLinkStatus, unlink } from "../link.js";

export type AuthStatus = {
  install_id: string;
  linked: boolean;
  user_id?: string;
};

export const authStatus = async (): Promise<AuthStatus> => {
  const cfg = loadConfig();
  if (!cfg) {
    const fresh = await ensureRegistered({ ideName: "unknown-ide" });
    return { install_id: fresh.install_id, linked: false };
  }
  try {
    const status = await pollLinkStatus(cfg);
    if (status.status === "approved") {
      return { install_id: cfg.install_id, linked: true, user_id: status.user_id };
    }
  } catch {
    // network failure — fall through to unlinked
  }
  return { install_id: cfg.install_id, linked: false };
};

export type LinkResult =
  | { status: "approved"; user_id: string }
  | {
      status: "pending";
      user_code: string;
      verification_url: string;
      expires_in: number;
      interval: number;
    };

export const zmLink = async (opts: { ideName: string }): Promise<LinkResult> => {
  const cfg = await ensureRegistered({ ideName: opts.ideName });
  const s = await pollLinkStatus(cfg);
  if (s.status === "approved") return { status: "approved", user_id: s.user_id };
  const code = await startDeviceCode(cfg);
  return { status: "pending", ...code };
};

export const zmLinkPoll = async (): Promise<
  { status: "approved"; user_id: string } | { status: "pending" }
> => {
  const cfg = loadConfig();
  if (!cfg) return { status: "pending" };
  return pollLinkStatus(cfg);
};

export const zmUnlink = async (): Promise<{ ok: true }> => {
  const cfg = loadConfig();
  if (cfg) await unlink(cfg);
  return { ok: true };
};
