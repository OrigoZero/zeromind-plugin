import {
  createLinkCode,
  getLinkStatus,
  postUnlink,
  type LinkCodeResponse,
  type LinkStatusResponse,
} from "./zeromind-client.js";
import { deleteCache, installSecret, type SessionCache } from "./config.js";

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

export const unlink = async (cache: SessionCache): Promise<void> => {
  await postUnlink(linkCreds(cache));
  deleteCache();
};
