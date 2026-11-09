import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scopeCovers } from "../src/index.ts";
import { act, deployRequest, setup } from "./support.ts";

describe("checking an action before it executes", () => {
  it("runs an action that is inside the mandate and records who allowed it", async () => {
    const { authority } = setup();
    const grant = authority.issue(deployRequest());

    const outcome = await authority.execute(act(grant, "deploy", "env:staging/api", "deploy-api-1.42"), () => "deployed");

    assert.deepEqual(outcome, { status: "executed", mandateId: grant.mandate.id, result: "deployed" });
    const allow = authority.record.entries().find((entry) => entry.type === "allow");
    assert.deepEqual(
      allow?.type === "allow" && [allow.mandateId, allow.grantor, allow.holder, allow.action, allow.resource],
      [grant.mandate.id, "person:hammed", "agent:fix-agent/run-7f3", "deploy", "env:staging/api"],
    );
  });

  it("refuses an action the mandate does not name, without running it", async () => {
    const { authority } = setup();
    const grant = authority.issue(deployRequest());
    let ran = false;

    const outcome = await authority.execute(act(grant, "delete_database", "env:staging/api", "k1"), () => {
      ran = true;
    });

    assert.deepEqual(outcome, { status: "refused", mandateId: grant.mandate.id, reason: "action_out_of_scope" });
    assert.equal(ran, false);
  });

  it("refuses a named action on a resource outside the mandate", async () => {
    const { authority } = setup();
    const grant = authority.issue(deployRequest());
    let ran = false;

    const outcome = await authority.execute(act(grant, "deploy", "env:production/api", "k1"), () => {
      ran = true;
    });

    assert.equal(outcome.status === "refused" && outcome.reason, "resource_out_of_scope");
    assert.equal(ran, false);
  });

  it("matches subtree resources on a path boundary, not a string prefix", async () => {
    const { authority } = setup();
    const grant = authority.issue(deployRequest());
    const tryDeploy = (resource: string) =>
      authority.execute(act(grant, "deploy", resource, `deploy:${resource}`), () => "ok");

    assert.equal((await tryDeploy("env:staging/api")).status, "executed");
    assert.equal((await tryDeploy("env:staging/api/worker")).status, "executed");
    assert.equal((await tryDeploy("env:staging-eu/api")).status, "refused");
    assert.equal((await tryDeploy("env:staging/")).status, "refused");
    assert.equal((await tryDeploy("env:staging")).status, "refused");
  });

  it("treats an exact resource as exact", async () => {
    const { authority } = setup();
    const grant = authority.issue(deployRequest());

    const outcome = await authority.execute(act(grant, "open_pull_request", "repo:api-admin", "pr-1"), () => "ok");

    assert.equal(outcome.status === "refused" && outcome.reason, "resource_out_of_scope");
  });

  it("refuses an unknown credential and records the attempt", async () => {
    const { authority } = setup();
    authority.issue(deployRequest());

    const outcome = await authority.execute(
      { credential: "forged", action: "deploy", resource: "env:staging/api", idempotencyKey: "k1" },
      () => "ok",
    );

    assert.deepEqual(outcome, { status: "refused", mandateId: null, reason: "unknown_credential" });
    const last = authority.record.entries().at(-1);
    assert.equal(last?.type === "refuse" && last.refusal, "unknown_credential");
  });

  it("refuses an action that carries no idempotency key", async () => {
    const { authority } = setup();
    const grant = authority.issue(deployRequest());

    const outcome = await authority.execute(act(grant, "deploy", "env:staging/api", " "), () => "ok");

    assert.equal(outcome.status === "refused" && outcome.reason, "missing_idempotency_key");
  });
});

describe("scope containment", () => {
  const parent = { actions: ["read", "deploy"], resources: ["env:staging/*", "repo:api"] };

  it("accepts a narrower subtree, an exact resource inside a subtree, and a subset of actions", () => {
    assert.equal(scopeCovers(parent, { actions: ["deploy"], resources: ["env:staging/api/*"] }), true);
    assert.equal(scopeCovers(parent, { actions: ["read"], resources: ["env:staging/api", "repo:api"] }), true);
  });

  it("rejects a wider subtree, a sibling, an extra action, or a subtree under an exact resource", () => {
    assert.equal(scopeCovers(parent, { actions: ["deploy"], resources: ["env:*"] }), false);
    assert.equal(scopeCovers(parent, { actions: ["deploy"], resources: ["env:staging-eu/*"] }), false);
    assert.equal(scopeCovers(parent, { actions: ["delete"], resources: ["repo:api"] }), false);
    assert.equal(scopeCovers(parent, { actions: ["read"], resources: ["repo:api/*"] }), false);
  });
});
