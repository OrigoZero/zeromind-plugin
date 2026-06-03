import {
  createLinkCode,
  getLinkStatus,
  postUnlink,
  type LinkCodeResponse,
  type LinkStatusResponse,
} from "./zeromind-client.js";
import { deleteConfig, type InstallConfig } from "./config.js";

export const startDeviceCode = async (
  cfg: InstallConfig,
  suggestedUsername?: string,
): Promise<LinkCodeResponse> => createLinkCode(cfg, suggestedUsername);

export const pollLinkStatus = async (cfg: InstallConfig): Promise<LinkStatusResponse> =>
  getLinkStatus(cfg);

export const unlink = async (cfg: InstallConfig): Promise<void> => {
  await postUnlink(cfg);
  deleteConfig();
};
