import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MandateError } from "../src/index.ts";
import { MINUTE, START, deployRequest, setup } from "./support.ts";

describe("issuing a mandate", () => {
  it("records the grant with grantor, holder, reason, scope and expiry", () => {
    const { authority } = setup();

    const { mandate, credential } = authority.issue(deployRequest());

    assert.equal(mandate.grantor, "person:hammed");
    assert.equal(mandate.holder, "agent:fix-agent/run-7f3");
    assert.equal(mandate.issuedAt, START);
    assert.equal(mandate.expiresAt, START + 30 * MINUTE);
    assert.notEqual(credential, mandate.id);
    const [grant] = authority.record.entries();
    assert.equal(grant?.type, "grant");
    assert.deepEqual(
      grant?.type === "grant" && {
        mandateId: grant.mandateId,
        grantor: grant.grantor,
        holder: grant.holder,
        reason: grant.reason,
        actions: grant.actions,
        resources: grant.resources,
        expiresAt: grant.expiresAt,
      },
      {
        mandateId: mandate.id,
        grantor: "person:hammed",
        holder: "agent:fix-agent/run-7f3",
        reason: "Fix the failing test in the api service and deploy it to staging",
        actions: ["open_pull_request", "deploy"],
        resources: ["repo:api", "env:staging/*"],
        expiresAt: START + 30 * MINUTE,
      },
    );
  });

  it("never writes the credential into the record", () => {
    const { authority } = setup();

    const { credential } = authority.issue(deployRequest());

    assert.doesNotMatch(JSON.stringify(authority.record.entries()), new RegExp(credential));
  });

  it("issues a distinct credential and mandate for each run", () => {
    const { authority } = setup();

    const first = authority.issue(deployRequest());
    const second = authority.issue(deployRequest({ holder: "agent:fix-agent/run-7f4" }));

    assert.notEqual(first.mandate.id, second.mandate.id);
    assert.notEqual(first.credential, second.credential);
  });

  it("refuses to let an agent hold the grantor's own identity", () => {
    const { authority } = setup();

    assert.throws(
      () => authority.issue(deployRequest({ holder: "person:hammed" })),
      (error: unknown) => error instanceof MandateError && /own identity/.test(error.message),
    );
  });

  it("requires a stated reason", () => {
    const { authority } = setup();

    assert.throws(() => authority.issue(deployRequest({ reason: "   " })), MandateError);
  });

  it("requires at least one action and one resource", () => {
    const { authority } = setup();

    assert.throws(() => authority.issue(deployRequest({ actions: [] })), MandateError);
    assert.throws(() => authority.issue(deployRequest({ resources: [] })), MandateError);
  });

  it("requires an expiry in the future", () => {
    const { authority } = setup();

    assert.throws(() => authority.issue(deployRequest({ expiresAt: START })), MandateError);
    assert.doesNotThrow(() => authority.issue(deployRequest({ expiresAt: START + 1 })));
  });

  it("caps the lifetime so standing access cannot be issued", () => {
    const { authority } = setup({ maxLifetimeMs: 15 * MINUTE });

    assert.doesNotThrow(() => authority.issue(deployRequest({ expiresAt: START + 15 * MINUTE })));
    assert.throws(() => authority.issue(deployRequest({ expiresAt: START + 15 * MINUTE + 1 })), MandateError);
  });

  it("does not record a grant that was rejected", () => {
    const { authority } = setup();

    assert.throws(() => authority.issue(deployRequest({ holder: "person:hammed" })));

    assert.equal(authority.record.entries().length, 0);
  });
});
