// Wrapping of a raw engine tool result into an MCP tool-call result.
//
// The trusted bridge hands back the engine's `McpToolResult` content verbatim
// as the `rpc.response` result (see zero `src/lua/trusted/bridge/init.luau`).
// Most tools return a JSON value we forward as a text block. The image-
// returning tools are special: `capture` (always) and `read_file` (for PNGs)
// return an image block. We MUST deliver that as an MCP `image` content block
// — otherwise the client renders the base64 as a giant text blob, which
// overflows the result limit and gets dumped to disk as plain text instead of
// a viewable image (OrigoZero/zero#3840, OrigoZero/zero#3844).
//
// Casing note: a current engine normalizes the block to the canonical MCP
// shape `{ type: "image", data, mimeType }` over the bridge, but older engines
// sent snake_case `{ ..., mime_type }`. Read both so the plugin works across
// engine versions.

type ImageContent = { type: "image"; data: string; mimeType: string };
type TextContent = { type: "text"; text: string };

export type ToolContent = {
  content: Array<ImageContent | TextContent>;
};

/** True when a raw tool result is shaped like an MCP image block. */
function asImageResult(
  result: unknown,
): { data: string; mimeType: string } | null {
  if (typeof result !== "object" || result === null) return null;
  const r = result as {
    type?: unknown;
    data?: unknown;
    mimeType?: unknown;
    mime_type?: unknown;
  };
  if (r.type !== "image" || typeof r.data !== "string") return null;
  const mimeType =
    typeof r.mimeType === "string"
      ? r.mimeType
      : typeof r.mime_type === "string"
        ? r.mime_type
        : "image/png";
  return { data: r.data, mimeType };
}

/**
 * Convert a raw engine tool result into an MCP tool-call result. Image-shaped
 * results become an `image` content block (viewable); everything else becomes
 * a JSON text block — the shape every non-image tool already returned.
 */
export function toToolContent(result: unknown): ToolContent {
  const image = asImageResult(result);
  if (image) {
    return {
      content: [{ type: "image", data: image.data, mimeType: image.mimeType }],
    };
  }
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}
