export type World = {
  guid: string;
  name: string;
  is_public: boolean;
  owner_user_id: string;
  created_by_install_id?: string;
};

export type Session = {
  session_id: string;
  world_guid: string;
  user_id: string;
};

export type RpcCall = {
  type: "rpc.call";
  id: string;
  target_session: string;
  method: string;
  params?: unknown;
};

export type RpcResponse = {
  type: "rpc.response";
  id: string;
  result: unknown;
};

export type RpcError = {
  type: "rpc.error";
  id: string;
  code: string;
  message: string;
};

export type SessionOpened = {
  type: "session.opened";
  world_guid: string;
  session_id: string;
  user_id: string;
};

export type SessionClosed = {
  type: "session.closed";
  session_id: string;
  reason: string;
};

export type BridgeFrame = RpcCall | RpcResponse | RpcError | SessionOpened | SessionClosed;
