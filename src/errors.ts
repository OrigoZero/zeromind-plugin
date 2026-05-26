export class LinkRequiredError extends Error {
  readonly code = "link_required";
  constructor(
    public readonly user_code: string,
    public readonly verification_url: string,
    public readonly expires_in: number,
  ) {
    super(`Link required. Open ${verification_url} and enter ${user_code}.`);
  }
}

export class BridgeError extends Error {
  constructor(
    public readonly mcpCode: string,
    message: string,
  ) {
    super(message);
  }
}

export class NotConnectedError extends Error {
  constructor() {
    super("Not connected to a world session. Call world.connect first.");
  }
}
