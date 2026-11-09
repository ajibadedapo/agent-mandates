import { createHash } from "node:crypto";
import type { Clock, RecordEntry, RecordEvent } from "./types.ts";

export const GENESIS_HASH = "0".repeat(64);

export type VerifyProblem = "sequence_gap" | "broken_link" | "hash_mismatch" | "head_mismatch";

export type VerifyResult =
  | { readonly ok: true; readonly length: number; readonly head: string }
  | { readonly ok: false; readonly seq: number; readonly problem: VerifyProblem };

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const fields = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashEntry(body: Omit<RecordEntry, "hash">): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

export class AuditRecord {
  readonly #entries: RecordEntry[] = [];
  readonly #clock: Clock;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  append(event: RecordEvent): RecordEntry {
    const body = {
      ...structuredClone(event),
      seq: this.#entries.length,
      at: this.#clock(),
      prevHash: this.head(),
    };
    const entry = Object.freeze({ ...body, hash: hashEntry(body) });
    this.#entries.push(entry);
    return structuredClone(entry);
  }

  head(): string {
    return this.#entries.at(-1)?.hash ?? GENESIS_HASH;
  }

  entries(): RecordEntry[] {
    return this.#entries.map((entry) => structuredClone(entry));
  }
}

export function verifyRecord(
  entries: readonly RecordEntry[],
  anchor: { readonly head?: string } = {},
): VerifyResult {
  let previous = GENESIS_HASH;
  for (const [index, entry] of entries.entries()) {
    if (entry.seq !== index) {
      return { ok: false, seq: index, problem: "sequence_gap" };
    }
    if (entry.prevHash !== previous) {
      return { ok: false, seq: index, problem: "broken_link" };
    }
    const { hash, ...body } = entry;
    if (hashEntry(body) !== hash) {
      return { ok: false, seq: index, problem: "hash_mismatch" };
    }
    previous = hash;
  }
  if (anchor.head !== undefined && anchor.head !== previous) {
    return { ok: false, seq: entries.length, problem: "head_mismatch" };
  }
  return { ok: true, length: entries.length, head: previous };
}
