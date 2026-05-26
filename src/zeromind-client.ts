import { fetch } from "undici";

export const issuer = (): string =>
  (process.env.ZEROMIND_ISSUER ?? "https://zeromind.origoclaw.com").replace(/\/+$/, "");

export type RegisterResponse = { install_id: string; install_secret: string };

export const registerInstall = async (params: {
  install_name: string;
  public_key: string;
}): Promise<RegisterResponse> => {
  const res = await fetch(`${issuer()}/v1/installs/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as RegisterResponse;
};
