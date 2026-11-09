import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MandateError } from "../src/index.ts";
import type { ActionRequest, DelegateRequest } from "../src/index.ts";
import { MINUTE, START, act, deferred, deployRequest, setup } from "./support.ts";

const subAgent: DelegateRequest = {
  holder: "agent:smoke-tester/run-7f3-1",
  reason: "Run smoke checks against the staging deploy",
  actions: ["deploy"],
  resources: ["env:staging/api"],
  expiresAt: START + 20 * MINUTE,
};

describe("revocation", () => {
  it("refuses a revoked mandate on the very next call, with no clock movement", async () => {
    const { authority } = setup();
    const grant = authority.issue(deployRequest());
    const first = await authority.execute(act(grant, "deploy", "env:staging/api", "deploy-1"), () => "ok");
    let ranAfterRevoke = false;

    const revoked = authority.revoke(grant.mandate.id, "person:hammed", "Revocation drill");
    const next = await authority.execute(act(grant, "deploy", "env:staging/api", "deploy-2"), () => {
      ranAfterRevoke = true;
    });

    assert.equal(first.status, "executed");
    assert.deepEqual(revoked, { status: "revoked", affected: [grant.mandate.id], cancelledInFlight: 0 });
    assert.deepEqual(next, { status: "refused", mandateId: grant.mandate.id, reason: "revoked" });
    assert.equal(ranAfterRevoke, false);
  });

  it("refuses a retry of an action that had already completed before revocation", async () => {
    const { authority } = setup();
    const grant = authority.issue(deployRequest());
    await authority.execute(act(grant, "deploy", "env:staging/api", "deploy-1"), () => "ok");

    authority.revoke(grant.mandate.id, "person:hammed", "Revocation drill");
    const retry = await authority.execute(act(grant, "deploy", "env:staging/api", "deploy-1"), () => "ok");

    assert.equal(retry.status === "refused" && retry.reason, "revoked");
  });

  it("leaves every other mandate working, so nothing else has to rotate", async () => {
    const { authority } = setup();
    const revokedAgent = authority.issue(deployRequest());
    const otherAgent = authority.issue(deployRequest({ holder: "agent:docs-agent/run-a01" }));

    authority.revoke(revokedAgent.mandate.id, "person:hammed", "Revocation drill");
    const other = await authority.execute(act(otherAgent, "deploy", "env:staging/docs", "docs-1"), () => "ok");

    assert.equal(other.status, "executed");
  });

  it("can only be done by the grantor, and the agent cannot revoke or restore itself", async () => {
    const { authority } = setup();
    const grant = authority.issue(deployRequest());

    const byAgent = authority.revoke(grant.mandate.id, grant.mandate.holder, "self-revoke");
    const byStranger = authority.revoke(grant.mandate.id, "person:someone-else", "not mine");
    const stillWorks = await authority.execute(act(grant, "deploy", "env:staging/api", "k1"), () => "ok");

    assert.deepEqual(byAgent, { status: "rejected", reason: "not_grantor" });
    assert.deepEqual(byStranger, { status: "rejected", reason: "not_grantor" });
    assert.equal(stillWorks.status, "executed");
  });

  it("reports an unknown or already revoked mandate instead of claiming success", () => {
    const { authority } = setup();
    const grant = authority.issue(deployRequest());

    authority.revoke(grant.mandate.id, "person:hammed", "first");

    assert.deepEqual(authority.revoke(grant.mandate.id, "person:hammed", "again"), {
      status: "rejected",
      reason: "already_revoked",
    });
    assert.deepEqual(authority.revoke("no-such-mandate", "person:hammed", "?"), {
      status: "rejected",
      reason: "unknown_mandate",
    });
  });

  it("refuses queued work at execution time, even though it was valid when queued", async () => {
    const { authority } = setup();
    const grant = authority.issue(deployRequest());
    const queue: ActionRequest[] = [
      act(grant, "deploy", "env:staging/api", "q-1"),
      act(grant, "deploy", "env:staging/worker", "q-2"),
      act(grant, "deploy", "env:staging/web", "q-3"),
    ];
    const effects: string[] = [];
    const outcomes: string[] = [];

    for (const [index, request] of queue.entries()) {
      if (index === 1) {
        authority.revoke(grant.mandate.id, "person:hammed", "Stop the rollout");
      }
      const outcome = await authority.execute(request, () => {
        effects.push(request.resource);
      });
      outcomes.push(outcome.status);
    }

    assert.deepEqual(effects, ["env:staging/api"]);
    assert.deepEqual(outcomes, ["executed", "refused", "refused"]);
  });

  it("signals in-flight work to stop and records how much was cancelled", async () => {
    const { authority } = setup();
    const grant = authority.issue(deployRequest());
    const started = deferred<void>();
    let abortReason: unknown;

    const running = authority.execute(act(grant, "deploy", "env:staging/api", "long-1"), (signal) => {
      started.resolve();
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          abortReason = signal.reason;
          reject(signal.reason);
        });
      });
    });
    await started.promise;
    const revoked = authority.revoke(grant.mandate.id, "person:hammed", "Stop now");

    await assert.rejects(running, MandateError);
    assert.equal(revoked.status === "revoked" && revoked.cancelledInFlight, 1);
    assert.ok(abortReason instanceof MandateError);
    const types = authority.record.entries().map((entry) => entry.type);
    assert.deepEqual(types, ["grant", "allow", "revoke", "fail"]);
  });

  it("records an in-flight effect that ignored the signal and finished anyway", async () => {
    const { authority } = setup();
    const grant = authority.issue(deployRequest());
    const release = deferred<string>();

    const running = authority.execute(act(grant, "deploy", "env:staging/api", "stubborn-1"), () => release.promise);
    authority.revoke(grant.mandate.id, "person:hammed", "Stop now");
    release.resolve("deployed");

    assert.equal((await running).status, "executed");
    assert.deepEqual(
      authority.record.entries().map((entry) => entry.type),
      ["grant", "allow", "revoke", "complete"],
    );
  });
});

describe("delegation", () => {
  it("lets a holder pass on a narrower mandate under the same grantor", async () => {
    const { authority } = setup();
    const parent = authority.issue(deployRequest());

    const child = authority.delegate(parent.credential, subAgent);
    const outcome = await authority.execute(act(child, "deploy", "env:staging/api", "smoke-1"), () => "ok");

    assert.equal(child.mandate.grantor, "person:hammed");
    assert.equal(child.mandate.delegatedBy, "agent:fix-agent/run-7f3");
    assert.equal(child.mandate.parentId, parent.mandate.id);
    assert.equal(outcome.status, "executed");
  });

  it("refuses a delegated scope wider than the parent", () => {
    const { authority } = setup();
    const parent = authority.issue(deployRequest());

    assert.throws(() => authority.delegate(parent.credential, { ...subAgent, actions: ["delete"] }), MandateError);
    assert.throws(
      () => authority.delegate(parent.credential, { ...subAgent, resources: ["env:production/api"] }),
      MandateError,
    );
  });

  it("refuses a delegated mandate that outlives its parent", () => {
    const { authority } = setup();
    const parent = authority.issue(deployRequest({ expiresAt: START + 20 * MINUTE }));

    assert.throws(
      () => authority.delegate(parent.credential, { ...subAgent, expiresAt: START + 20 * MINUTE + 1 }),
      /outlive/,
    );
  });

  it("refuses a sub-agent the moment its parent is revoked", async () => {
    const { authority } = setup();
    const parent = authority.issue(deployRequest());
    const child = authority.delegate(parent.credential, subAgent);
    const grandchild = authority.delegate(child.credential, { ...subAgent, holder: "agent:probe/run-7f3-1-a" });

    const revoked = authority.revoke(parent.mandate.id, "person:hammed", "Revoke the whole tree");
    const childOutcome = await authority.execute(act(child, "deploy", "env:staging/api", "c-1"), () => "ok");
    const grandchildOutcome = await authority.execute(act(grandchild, "deploy", "env:staging/api", "g-1"), () => "ok");

    assert.deepEqual(revoked.status === "revoked" && revoked.affected, [
      parent.mandate.id,
      child.mandate.id,
      grandchild.mandate.id,
    ]);
    assert.equal(childOutcome.status === "refused" && childOutcome.reason, "revoked");
    assert.equal(grandchildOutcome.status === "refused" && grandchildOutcome.reason, "revoked");
  });

  it("cancels a sub-agent's in-flight work when an ancestor is revoked", async () => {
    const { authority } = setup();
    const parent = authority.issue(deployRequest());
    const child = authority.delegate(parent.credential, subAgent);
    const started = deferred<void>();

    const running = authority.execute(act(child, "deploy", "env:staging/api", "c-long"), (signal) => {
      started.resolve();
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      });
    });
    await started.promise;
    const revoked = authority.revoke(parent.mandate.id, "person:hammed", "Revoke the whole tree");

    await assert.rejects(running, MandateError);
    assert.equal(revoked.status === "revoked" && revoked.cancelledInFlight, 1);
  });

  it("refuses to delegate from a revoked mandate", () => {
    const { authority } = setup();
    const parent = authority.issue(deployRequest());

    authority.revoke(parent.mandate.id, "person:hammed", "drill");

    assert.throws(() => authority.delegate(parent.credential, subAgent), /revoked/);
  });

  it("lets the grantor revoke one sub-agent without stopping its parent", async () => {
    const { authority } = setup();
    const parent = authority.issue(deployRequest());
    const child = authority.delegate(parent.credential, subAgent);

    authority.revoke(child.mandate.id, "person:hammed", "Sub-agent misbehaving");
    const parentOutcome = await authority.execute(act(parent, "deploy", "env:staging/api", "p-1"), () => "ok");
    const childOutcome = await authority.execute(act(child, "deploy", "env:staging/api", "c-1"), () => "ok");

    assert.equal(parentOutcome.status, "executed");
    assert.equal(childOutcome.status, "refused");
  });
});
