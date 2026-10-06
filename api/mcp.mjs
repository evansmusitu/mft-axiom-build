import { get, put, BlobPreconditionFailedError } from "@vercel/blob";
import { gunzipSync, gzipSync } from "node:zlib";
import { timingSafeEqual } from "node:crypto";

const STATE_PATH = process.env.AXIOM_OPERATOR_STATE_PATH || "axiom-operator/state-v1.json.gz";
const MAX_REQUEST_BYTES = 1_000_000;
const MAX_STATE_JSON_BYTES = 3_000_000;

function safeBearer(header, expected) {
  if (!header || !expected || !header.startsWith("Bearer ")) return false;
  const got = Buffer.from(header.slice(7));
  const want = Buffer.from(expected);
  return got.length === want.length && timingSafeEqual(got, want);
}

async function readState() {
  const current = await get(STATE_PATH, { access: "private", useCache: false });
  if (!current) return { statePack: null, etag: null };
  if (current.statusCode !== 200 || !current.stream) {
    throw new Error("operator state unavailable");
  }
  const compressed = Buffer.from(await new Response(current.stream).arrayBuffer());
  const raw = gunzipSync(compressed);
  if (raw.length > MAX_STATE_JSON_BYTES) {
    throw new Error("operator state exceeds remote v1 limit");
  }
  return {
    statePack: JSON.parse(raw.toString("utf8")),
    etag: current.blob.etag
  };
}

async function commitState(statePack, etag) {
  const raw = Buffer.from(JSON.stringify(statePack));
  if (raw.length > MAX_STATE_JSON_BYTES) {
    throw new Error("operator state exceeds remote v1 limit");
  }
  const compressed = gzipSync(raw, { level: 9 });
  const options = {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/gzip",
    cacheControlMaxAge: 0
  };
  if (etag) {
    options.allowOverwrite = true;
    options.ifMatch = etag;
  }
  return await put(STATE_PATH, compressed, options);
}

function responseJson(body, status = 200, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...extraHeaders }
  });
}

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return responseJson({ error: "METHOD_NOT_ALLOWED" }, 405);
    }
    if (!safeBearer(request.headers.get("authorization"), process.env.AXIOM_OPERATOR_TOKEN)) {
      return responseJson({ error: "UNAUTHORIZED" }, 401);
    }
    const length = Number(request.headers.get("content-length") || "0");
    if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) {
      return responseJson({ error: "REQUEST_TOO_LARGE" }, 413);
    }

    let message;
    try {
      message = await request.json();
    } catch {
      return responseJson({ error: "INVALID_JSON" }, 400);
    }

    let current;
    try {
      current = await readState();
    } catch {
      return responseJson({ error: "STATE_READ_FAILED" }, 503);
    }

    const forwardedHeaders = {
      "MCP-Protocol-Version": request.headers.get("mcp-protocol-version") || "",
      "Mcp-Method": request.headers.get("mcp-method") || "",
    };
    const mcpName = request.headers.get("mcp-name");
    if (mcpName) forwardedHeaders["Mcp-Name"] = mcpName;

    const coreUrl = new URL("/api/operator_core.py", request.url);
    let coreResponse;
    try {
      coreResponse = await fetch(coreUrl, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${process.env.AXIOM_OPERATOR_INTERNAL_TOKEN}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          state_pack: current.statePack,
          headers: forwardedHeaders,
          message
        })
      });
    } catch {
      return responseJson({ error: "OPERATOR_CORE_UNREACHABLE" }, 503);
    }
    if (!coreResponse.ok) {
      return responseJson({ error: "OPERATOR_CORE_FAILED" }, 503);
    }

    let core;
    try {
      core = await coreResponse.json();
    } catch {
      return responseJson({ error: "OPERATOR_CORE_INVALID_RESPONSE" }, 503);
    }

    if (core.mutated && core.state_pack) {
      try {
        await commitState(core.state_pack, current.etag);
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) {
          return responseJson({
            error: "STATE_CONFLICT",
            message: "operator state changed concurrently; retry against the latest generation"
          }, 409);
        }
        return responseJson({ error: "STATE_COMMIT_FAILED" }, 503);
      }
    }

    const safeHeaders = {};
    for (const [key, value] of Object.entries(core.headers || {})) {
      const lower = key.toLowerCase();
      if (lower === "content-type" || lower === "cache-control" || lower === "mcp-protocol-version") {
        safeHeaders[key] = String(value);
      }
    }
    return responseJson(core.body || {}, Number(core.status || 500), safeHeaders);
  }
};
