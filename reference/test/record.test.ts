import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GENESIS_HASH, hashEntry, verifyRecord } from "../src/index.ts";
import type { RecordEntry } from "../src/index.ts";
import { MINUTE, START, act, deployRequest, setup } from "./support.ts";

async function populatedRecord() {
  const { authority, clock } = setup();
  const grant = authority.issue(deployRequest());
  clock.advance(1_250);
  await authority.execute(act(grant, "deploy", "env:staging/api", "deploy-1"), () => "ok");
  await authority.execute(act(grant, "deploy", "env:production/api", "deploy-2"), () => "ok");
  clock.advance(MINUTE);
  authority.revoke(grant.mandate.id, "person:hammed", "Revocation drill");
  await authority.execute(act(grant, "deploy", "env:staging/api", "deploy-3"), () => "ok");
  return { authority, grant, entries: authority.record.entries() };
}

function rehashed(entries: RecordEntry[]): RecordEntry[] {
  let previous = GENESIS_HASH;
  return entries.map((entry, seq) => {
    const { hash: _discarded, ...rest } = entry;
    const body = { ...rest, seq, prevHash: previous };
    const hash = hashEntry(body);
    previous = hash;
    return { ...body, hash };
  });
}

describe("the record", () => {
  it("holds grants, allows, refusals and revocations, each linked to the mandate and grantor", async () => {
    const { entries, grant } = await populatedRecord();

    assert.deepEqual(
      entries.map((entry) => entry.type),
      ["grant", "allow", "complete", "refuse", "revoke", "refuse"],
    );
    assert.ok(entries.every((entry) => entry.mandateId === grant.mandate.id));
    const refusals = entries.filter((entry) => entry.type === "refuse").map((entry) => entry.type === "refuse" && entry.refusal);
    assert.deepEqual(refusals, ["resource_out_of_scope", "revoked"]);
  });

  it("timestamps entries from the injected clock", async () => {
    const { entries } = await populatedRecord();

    assert.deepEqual(
      entries.map((entry) => entry.at),
      [START, START + 1_250, START + 1_250, START + 1_250, START + 1_250 + MINUTE, START + 1_250 + MINUTE],
    );
  });

  it("verifies an untouched record and reports its head", async () => {
    const { authority, entries } = await populatedRecord();

    assert.deepEqual(verifyRecord(entries, { head: authority.record.head() }), {
      ok: true,
      length: 6,
      head: authority.record.head(),
    });
  });

  it("verifies an empty record against the genesis hash", () => {
    assert.deepEqual(verifyRecord([]), { ok: true, length: 0, head: GENESIS_HASH });
  });

  it("detects an edited field", async () => {
    const { entries } = await populatedRecord();
    const tampered = entries.map((entry) =>
      entry.type === "refuse" && entry.refusal === "resource_out_of_scope"
        ? { ...entry, resource: "env:staging/api" }
        : entry,
    );

    assert.deepEqual(verifyRecord(tampered), { ok: false, seq: 3, problem: "hash_mismatch" });
  });

  it("detects a changed timestamp", async () => {
    const { entries } = await populatedRecord();
    const tampered = entries.map((entry) => (entry.type === "revoke" ? { ...entry, at: entry.at + 1 } : entry));

    assert.deepEqual(verifyRecord(tampered), { ok: false, seq: 4, problem: "hash_mismatch" });
  });

  it("detects a deleted entry", async () => {
    const { entries } = await populatedRecord();
    const withoutRefusal = entries.filter((_entry, seq) => seq !== 3);

    assert.deepEqual(verifyRecord(withoutRefusal), { ok: false, seq: 3, problem: "sequence_gap" });
  });

  it("detects reordered entries", async () => {
    const { entries } = await populatedRecord();
    const swapped = [...entries];
    [swapped[3], swapped[4]] = [swapped[4]!, swapped[3]!];

    assert.equal(verifyRecord(swapped).ok, false);
  });

  it("detects a deleted entry even when the sequence numbers are rewritten", async () => {
    const { entries } = await populatedRecord();
    const renumbered = entries.filter((_entry, seq) => seq !== 3).map((entry, seq) => ({ ...entry, seq }));

    assert.deepEqual(verifyRecord(renumbered), { ok: false, seq: 3, problem: "broken_link" });
  });

  it("detects a truncated tail only when checked against an anchored head", async () => {
    const { authority, entries } = await populatedRecord();
    const truncated = entries.slice(0, 4);

    assert.equal(verifyRecord(truncated).ok, true);
    assert.deepEqual(verifyRecord(truncated, { head: authority.record.head() }), {
      ok: false,
      seq: 4,
      problem: "head_mismatch",
    });
  });

  it("detects a fully rewritten chain only when checked against an anchored head", async () => {
    const { authority, entries } = await populatedRecord();
    const forged = rehashed(entries.filter((entry) => entry.type !== "revoke"));

    assert.equal(verifyRecord(forged).ok, true);
    assert.equal(verifyRecord(forged, { head: authority.record.head() }).ok, false);
  });

  it("hands out copies, so callers cannot edit the stored record", async () => {
    const { authority } = await populatedRecord();
    const copy = authority.record.entries();

    (copy[0] as { reason: string }).reason = "edited";

    assert.equal(verifyRecord(authority.record.entries(), { head: authority.record.head() }).ok, true);
  });
});
