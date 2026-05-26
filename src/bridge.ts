import WebSocket from "ws";
import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import type { InstallConfig } from "./config.js";
import { BridgeError } from "./errors.js";
import type {
  BridgeFrame,
  RpcCall,
  RpcError,
  RpcResponse,
  SessionClosed,
  SessionOpened,
} from "./types.js";

const bridgeUrl = (): string => {
  if (process.env.ZEROMIND_BRIDGE_URL) return process.env.ZEROMIND_BRIDGE_URL;
  const issuer = (process.env.ZEROMIND_ISSUER ?? "https://zeromind.origoclaw.com").replace(
    /\/+$/,
    "",
  );
  return issuer.replace(/^http/, "ws");
};

type Pending = {
  resolve: (result: unknown) => void;
  reject: (e: Error) => void;
};

export interface BridgeEvents {
  "session.opened": (e: SessionOpened) => void;
  "session.closed": (e: SessionClosed) => void;
  disconnect: (reason: string) => void;
  reconnect: () => void;
}

export class Bridge extends EventEmitter {
  private ws?: WebSocket;
  private opened = false;
  private pending = new Map<string, Pending>();
  private nextId = 1;
  private reconnectAttempt = 0;
  private shouldReconnect = true;

  constructor(private cfg: InstallConfig) {
    super();
  }

  on<K extends keyof BridgeEvents>(event: K, listener: BridgeEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  emit<K extends keyof BridgeEvents>(
    event: K,
    ...args: Parameters<BridgeEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  async connect(): Promise<void> {
    const url = `${bridgeUrl()}/v1/bridge?role=ide`;
    this.ws = new WebSocket(url, {
      headers: { authorization: `Bearer ${this.cfg.install_secret}` },
    });
    await new Promise<void>((resolve, reject) => {
      this.ws!.once("open", () => {
        this.opened = true;
        resolve();
      });
      this.ws!.once("error", (e) => reject(e));
      this.ws!.once("close", (code) => {
        if (!this.opened) reject(new Error(`bridge connect closed: ${code}`));
      });
    });
    this.ws.on("message", (raw) => this.handleFrame(raw.toString()));
    this.ws.on("close", (code) => this.handleClose(code));
  }

  isConnected(): boolean {
    return this.opened && this.ws?.readyState === WebSocket.OPEN;
  }

  async close(): Promise<void> {
    this.shouldReconnect = false;
    this.opened = false;
    for (const p of this.pending.values()) p.reject(new Error("bridge closed"));
    this.pending.clear();
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.close();
      await new Promise<void>((r) => this.ws!.once("close", () => r()));
    }
  }

  async call(params: {
    target_session: string;
    method: string;
    params?: unknown;
  }): Promise<unknown> {
    if (!this.isConnected()) throw new Error("bridge not connected");
    const id = `r${this.nextId++}_${randomBytes(4).toString("hex")}`;
    const frame: RpcCall = {
      type: "rpc.call",
      id,
      target_session: params.target_session,
      method: params.method,
      params: params.params,
    };
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify(frame));
    });
  }

  private handleFrame(raw: string): void {
    let frame: BridgeFrame;
    try {
      frame = JSON.parse(raw) as BridgeFrame;
    } catch {
      return;
    }
    if (frame.type === "rpc.response") this.handleResponse(frame);
    else if (frame.type === "rpc.error") this.handleRpcError(frame);
    else if (frame.type === "session.opened") this.emit("session.opened", frame);
    else if (frame.type === "session.closed") this.emit("session.closed", frame);
  }

  private handleResponse(frame: RpcResponse): void {
    const p = this.pending.get(frame.id);
    if (!p) return;
    this.pending.delete(frame.id);
    p.resolve(frame.result);
  }

  private handleRpcError(frame: RpcError): void {
    const p = this.pending.get(frame.id);
    if (!p) return;
    this.pending.delete(frame.id);
    p.reject(new BridgeError(frame.code, frame.message));
  }

  private handleClose(code: number): void {
    this.opened = false;
    for (const p of this.pending.values()) p.reject(new Error(`bridge disconnected (${code})`));
    this.pending.clear();
    this.emit("disconnect", `code ${code}`);
    if (this.shouldReconnect) void this.reconnect();
  }

  private async reconnect(): Promise<void> {
    if (!this.shouldReconnect) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 30_000);
    this.reconnectAttempt++;
    await new Promise((r) => setTimeout(r, delay));
    try {
      await this.connect();
      this.reconnectAttempt = 0;
      this.emit("reconnect");
    } catch {
      void this.reconnect();
    }
  }
}
