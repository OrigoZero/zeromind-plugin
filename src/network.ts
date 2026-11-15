import { readFileSync } from "node:fs";
import { rootCertificates } from "node:tls";
import { Agent, EnvHttpProxyAgent, setGlobalDispatcher, type Dispatcher } from "undici";

/** The variables a proxy for this process's HTTP and HTTPS requests is named in. */
const PROXY_VARIABLES = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"];

/** Whether the environment names an HTTP proxy for this process's requests. */
export function proxyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return PROXY_VARIABLES.some((name) => Boolean(env[name]?.trim()));
}

/**
 * The certificate authorities a request trusts when the environment names a
 * bundle of its own: Node's built-in roots, the bundle in `SSL_CERT_FILE`, and
 * the one in `NODE_EXTRA_CA_CERTS`. `undefined` when neither is named, which
 * leaves Node's own trust (its roots and `NODE_EXTRA_CA_CERTS`) in place.
 * Verification stays on either way: a named bundle adds authorities.
 */
export function certificateAuthorities(env: NodeJS.ProcessEnv = process.env): string[] | undefined {
  const bundle = env.SSL_CERT_FILE?.trim();
  if (!bundle) return undefined;
  const authorities = [...rootCertificates, readFileSync(bundle, "utf8")];
  const extra = env.NODE_EXTRA_CA_CERTS?.trim();
  if (extra) authorities.push(readFileSync(extra, "utf8"));
  return authorities;
}

/**
 * A dispatcher for this process's requests: through the proxy the
 * environment names (`HTTPS_PROXY`, `HTTP_PROXY`, honouring `NO_PROXY`), or
 * direct, trusting the authorities [`certificateAuthorities`] names.
 */
export function newDispatcher(env: NodeJS.ProcessEnv = process.env): Dispatcher {
  const ca = certificateAuthorities(env);
  const tls = ca ? { ca } : undefined;
  if (proxyConfigured(env)) {
    const named = (...names: string[]) =>
      names.map((name) => env[name]?.trim()).find((value) => Boolean(value));
    const httpProxy = named("HTTP_PROXY", "http_proxy");
    const httpsProxy = named("HTTPS_PROXY", "https_proxy") ?? httpProxy;
    const noProxy = named("NO_PROXY", "no_proxy");
    return new EnvHttpProxyAgent({
      ...(httpProxy ? { httpProxy } : {}),
      ...(httpsProxy ? { httpsProxy } : {}),
      ...(noProxy ? { noProxy } : {}),
      ...(tls ? { connect: tls, requestTls: tls, proxyTls: tls } : {}),
    });
  }
  return new Agent(tls ? { connect: tls } : {});
}

/** Send every request this process makes without a dispatcher of its own through [`newDispatcher`]. */
export function useEnvironmentNetwork(): void {
  if (proxyConfigured() || certificateAuthorities()) setGlobalDispatcher(newDispatcher());
}
