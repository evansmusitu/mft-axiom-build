import { createHash } from "node:crypto";
import type { JsonValue } from "./types.ts";

function encode(value: JsonValue, active = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON cannot contain non-finite numbers");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object") throw new TypeError("Canonical JSON accepts only JSON values");
  if (active.has(value)) throw new TypeError("Canonical JSON cannot contain cycles");
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError("Canonical JSON cannot contain symbol keys");
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError("Canonical JSON requires plain records");
  }
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) throw new TypeError("Canonical JSON cannot contain sparse arrays");
        items.push(encode(value[index], active));
      }
      return `[${items.join(",")}]`;
    }
    return `{${Object.keys(value).sort().map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!Object.hasOwn(descriptor, "value")) throw new TypeError("Canonical JSON cannot contain accessors");
      return `${JSON.stringify(key)}:${encode(descriptor.value, active)}`;
    }).join(",")}}`;
  } finally { active.delete(value); }
}

export function canonicalize(value: JsonValue): string {
  return encode(value);
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
