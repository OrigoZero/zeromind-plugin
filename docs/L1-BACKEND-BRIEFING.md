# Briefing — L1 ZeroMind Backend Endpoints for the IDE Plugin

Paste everything below this line into a fresh Claude/Cursor/Codex session that has access to the **ZeroMind backend repo**. It's a self-contained spec — the agent shouldn't need to read anything else to implement it.

---

You are implementing the L1 backend endpoints that the `@origozero/zeromind` IDE plugin depends on. The plugin lives in `OrigoZero/zeromind-plugin`. Its design and implementation plan are at:

- Design: `OrigoZero/zero` `docs/plans/2026-05-26-zeromind-ide-plugin.md` (branch `docs/zeromind-plugin-design`, also at https://github.com/OrigoZero/zero/pull/3504)
- Implementation plan (for the plugin side, not your side): same branch, `docs/plans/2026-05-26-zeromind-plugin-l3-implementation.md`

Your scope is the **ZeroMind backend repo only**. The plugin is being built in parallel. You do not need to touch the plugin repo. The plugin will work against your implementation as soon as it lands.

## Goal

Add a new principal type — **install** — distinct from the existing user-session model, and the endpoints to register, link, and use it. Plus a WSS bridge endpoint that brokers RPC between IDE plugins and browser-running engines.

## Data model

A new `installs` table (or equivalent in whatever the backend's storage layer uses):

```
install_id           text  primary key  (format: "inst_<16hex>")
install_secret_hash  text  (argon2id or bcrypt hash of the secret — NEVER store plaintext)
install_name        text  ("claude-code @ <hostname>" supplied by client at registration)
public_key          text  (ed25519 PEM, supplied by client, reserved for future signing — not used yet)
linked              boolean  default false
user_id             text   nullable  (the linked user, NULL until approved)
linked_at           timestamptz nullable
pending_code        text   nullable  (the active user_code: "XXXX-XXXX")
pending_code_expires_at  timestamptz nullable
created_at          timestamptz default now()
last_seen_at        timestamptz nullable
```

Index on `pending_code` for fast lookup during approval.

## Endpoints

### 1. `POST /v1/installs/register`

**Auth:** none. Open to anyone. Rate-limit by IP (suggest 10/hr/IP).

**Request body:**

```json
{ "install_name": "claude-code @ desktop-deata", "public_key": "<ed25519-PEM>" }
```

**Response 200:**

```json
{ "install_id": "inst_a1b2c3d4e5f6g7h8", "install_secret": "ins_sec_<32hex>" }
```

Notes:
- `install_secret` is generated server-side, returned plaintext ONCE here, stored hashed.
- `public_key` is stored verbatim for now (not used; reserved for signed-request upgrade later).
- Idempotency: no dedupe — every call mints a new install. Stale installs are revoked by the user.

### 2. `POST /v1/installs/{install_id}/link-codes`

**Auth:** `Authorization: Bearer <install_secret>`. The `{install_id}` in the path must match the install authenticated by the secret (defense-in-depth — both signal the same thing).

**Request body:** `{}` (empty object).

**Response 200:**

```json
{
  "user_code": "WXYZ-1234",
  "verification_url": "https://zeromind.origoclaw.com/link",
  "expires_in": 600,
  "interval": 5
}
```

- `user_code` is a 4+4 hex pair, uppercase. Unique across all live pending codes (collision-check).
- `expires_in` is 10 minutes from issuance.
- `interval` is the suggested polling interval in seconds (the plugin honors it).
- Issuing a new code overwrites any prior pending code for this install.

### 3. `GET /v1/installs/{install_id}/link-status`

**Auth:** install_secret (same install must own the request).

**Response 200, two shapes:**

```json
{ "status": "pending" }
```

or

```json
{ "status": "approved", "user_id": "usr_..." }
```

If the install was previously approved but then unlinked, return `"status": "pending"` (the link is severed; the plugin treats it like a fresh install). The plugin will start a new device-code flow.

Update `last_seen_at = now()` on each call.

### 4. `POST /v1/installs/{install_id}/unlink`

**Auth:** install_secret.

Sets `linked = false`, clears `user_id`, `linked_at`, `pending_code`. Does NOT delete the install row (so the user-facing audit log at `/me/installs` can still show "Cursor on work-laptop — unlinked 2 days ago" if you want).

**Response 200:** `{ "ok": true }`.

### 5. `GET /v1/me/worlds`

**Auth:** install_secret OR user JWT. Existing user-JWT auth path is unchanged. When auth comes via install_secret, resolve to the linked user (require `linked = true`).

**Response 200:**

```json
{ "worlds": [
  { "guid": "wld_...", "name": "snowboard", "is_public": false,
    "owner_user_id": "usr_...", "created_by_install_id": "inst_..." }
] }
```

Only worlds the resolved user owns. (Sharing-with-others is a v2 concern.)

### 6. `POST /v1/worlds`

**Auth:** install_secret OR user JWT.

**Request body:**

```json
{ "name": "snowboard", "template": "empty", "public": false }
```

- `template` is optional. v1 backend supports only `"empty"`; reject other values with 400 for now.
- `public` defaults to `false`.

**Response 200:**

```json
{ "world": {
  "guid": "wld_<16hex>", "name": "snowboard", "is_public": false,
  "owner_user_id": "usr_...", "created_by_install_id": "inst_..."
} }
```

- `owner_user_id` is the resolved user (whether auth came via install_secret or user JWT).
- `created_by_install_id` is set when auth is via install_secret; null/undefined when via user JWT (web UI).

### 7. `GET /v1/me/installs` (user-facing UI surface)

**Auth:** user JWT.

**Response 200:**

```json
{ "installs": [
  { "install_id": "inst_...", "install_name": "claude-code @ desktop-deata",
    "linked_at": "2026-04-12T...", "last_seen_at": "2026-05-26T...", "linked": true }
] }
```

Used by the `/me/installs` web page that lists "your linked IDEs". Out of scope for the plugin functionality, but the user needs this to revoke installs.

### 8. `POST /v1/me/installs/{install_id}/revoke`

**Auth:** user JWT. The targeted install must currently be linked to the authenticated user.

Same effect as `/v1/installs/{id}/unlink` but initiated by the user (not the install). Use this from the `/me/installs` UI.

**Response 200:** `{ "ok": true }`.

### 9. `GET /link` (user-facing UI)

A web page where the user enters the `user_code` from their IDE. Sign-in gate first (existing ZeroMind login flow). After sign-in, show:

> "An IDE on **\<install_name\>** is asking to act on your account. Approve?"
>
> [Approve] [Reject]

Approve flips `linked = true, user_id = <authenticated user>, linked_at = now(), pending_code = NULL`.
Reject just clears `pending_code` so the IDE's next poll says pending and the device-code session naturally expires.

### 10. `POST /v1/link/approve` (web AJAX endpoint backing the above page)

**Auth:** user JWT.

**Body:** `{ "user_code": "WXYZ-1234" }`.

Look up the install by `pending_code`. Reject if code expired or doesn't exist. Otherwise approve as above. Response: `{ "ok": true, "install_name": "..." }` so the page can show "Approved Cursor on work-laptop".

### 11. `WSS /v1/bridge`

This is the new transport layer for the plugin ↔ browser engine RPC. Both ends connect to this same endpoint.

**Plugin-side connection:**

```
GET wss://zeromind.origoclaw.com/v1/bridge?role=ide
Authorization: Bearer <install_secret>
```

Reject with WSS close code `4401` if install_secret invalid or `linked = false`.

**Browser-engine-side connection:** (this lands when the engine team ships the L2 trusted-Luau bridge module — not your code, but you need the endpoint to accept it):

```
GET wss://zeromind.origoclaw.com/v1/bridge?role=browser&world_guid=<guid>&session_id=<random>
Authorization: Bearer <user-jwt>
```

Reject with `4401` if JWT invalid or expired. Record `(user_id, world_guid, session_id)` in an active-sessions map. Same map is used for routing.

**Routing rules** (the actual brokering):

When a plugin sends:

```json
{ "type": "rpc.call", "id": "<id>", "target_session": "<session_id>",
  "method": "<m>", "params": <p> }
```

Backend validates **all four** of the following before forwarding:

1. The plugin's WSS is authenticated (install_secret valid, install linked).
2. `target_session` is currently connected (no `session.closed` since).
3. The session's `world_guid` is owned by the plugin's linked user.
4. The session's `user_id` matches the plugin's linked user.

If all four pass, forward verbatim (minus `target_session`) to the matching browser WSS:

```json
{ "type": "rpc.call", "id": "<id>", "method": "<m>", "params": <p> }
```

If any fail, send back to the plugin (don't reach the browser):

```json
{ "type": "rpc.error", "id": "<id>", "code": "forbidden", "message": "<reason>" }
```

When the browser sends:

```json
{ "type": "rpc.response", "id": "<id>", "result": <r> }
```

or

```json
{ "type": "rpc.error", "id": "<id>", "code": "<c>", "message": "<m>" }
```

Backend looks up which plugin's WSS sent the original `rpc.call` with that `id` (track an in-memory pending map: `rpc_id → plugin_install_id`), forwards verbatim.

**Session lifecycle events** (server-pushed, no `id`):

When a browser opens its WSS, immediately broadcast to ANY ide WSS belonging to the same `user_id`:

```json
{ "type": "session.opened", "world_guid": "...", "session_id": "...", "user_id": "..." }
```

When a browser disconnects, broadcast to the same set:

```json
{ "type": "session.closed", "session_id": "...", "reason": "tab_closed" | "disconnect" | "kicked" }
```

**Heartbeat:** server-initiated ping every 30s; close on missed pongs.

**ZeroMind is transparent transport, not storage.** Log only metadata for RPC frames (call id, method, payload size, timing). NEVER persist payload bodies. Bytes pass through; engine VFS writes ultimately land in the engine + sync via the existing spacetime path on `zm.push`.

## Cross-cutting

- All endpoints return errors as `{ "error": "<code>", "message": "<human>" }` with appropriate HTTP status (400 / 401 / 403 / 404 / 429 / 500).
- Rate-limit `register` (10/hr/IP) and `link-codes` (5/min/install).
- Logging: install_id and user_id are safe to log; install_secret NEVER logged or returned after registration.
- CORS: not required for the plugin (it's a Node process, not a browser), but required for the `/me/installs` and `/link` web pages.

## Mock you can test against

The plugin repo at `OrigoZero/zeromind-plugin` includes a Node mock at `tools/mock-zeromind/` that implements every endpoint above. Run `npm test` in that repo to see the contract exercised. If your backend behaves the same way the mock does, the plugin will Just Work against your backend without changes.

## Test plan (you write these in the ZeroMind backend repo)

For each endpoint above:
1. Happy path (auth correct, response shape correct).
2. Auth failure (no header, wrong secret, expired/wrong JWT).
3. Cross-install isolation (install A cannot read install B's state).
4. The `target_session` ACL: install X's plugin cannot RPC into install Y's user's session.
5. Rate-limit threshold behavior.
6. Bridge: plugin-only WSS gets no traffic from another user's browser sessions.

## Out of scope (don't build yet)

- WebRTC upgrade (signaling only; the bridge is JSON-WSS for v1).
- Fine-grained scopes (`engine:read-only` etc.) — v1 grants a single implicit `engine:full` on approval.
- Shared worlds — only the owner's plugins can drive sessions on the owner's worlds.
- Storage of in-flight RPC payloads — transparent transport, log metadata only.

## When you're done

Reply in the plugin's PR (https://github.com/OrigoZero/zeromind-plugin) with a comment naming the ZeroMind backend version/commit that lands these endpoints, so we can flip the plugin's E2E test from the mock to a staging deployment.
