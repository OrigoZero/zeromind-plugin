import { type AddressInfo } from "node:net";
import { buildServer, MockState } from "./server.js";
import { setupBridge } from "./bridge.js";

export type MockServerHandle = {
  url: string;
  wsUrl: string;
  port: number;
  state: MockState;
  forceApprove: (installId: string, userId: string) => void;
  stop: () => Promise<void>;
};

export const startMockServer = async (
  opts: { port?: number; seed?: (state: MockState) => void } = {},
): Promise<MockServerHandle> => {
  const state = new MockState();
  if (opts.seed) opts.seed(state);
  const server = buildServer(state);
  setupBridge(server, state);
  await new Promise<void>((resolve) =>
    server.listen(opts.port ?? 0, "127.0.0.1", resolve),
  );
  const addr = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${addr.port}`,
    wsUrl: `ws://127.0.0.1:${addr.port}`,
    port: addr.port,
    state,
    forceApprove: (installId, userId) => {
      const row = state.installs.get(installId);
      if (!row) throw new Error(`unknown install ${installId}`);
      row.linked = true;
      row.user_id = userId;
      row.pending_code = undefined;
    },
    stop: () =>
      new Promise((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
};

export { MockState };
