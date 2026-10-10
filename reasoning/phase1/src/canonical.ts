import { createHash } from "node:crypto";
import type { JsonValue } from "./types.ts";

function normalize(value: JsonValue): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON cannot contain non-finite numbers");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  const out: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort()) out[key] = normalize(value[key]);
  return out;
}

export function canonicalize(value: JsonValue): string {
  return JSON.stringify(normalize(value));
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashJson(value: JsonValue): string {
  return sha256Hex(canonicalize(value));
}

export function merkleRoot(hashes: string[]): string {
  if (hashes.length === 0) return sha256Hex("");
  let level = [...hashes];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? left;
      next.push(sha256Hex(left + right));
    }
    level = next;
  }
  return level[0];
}
