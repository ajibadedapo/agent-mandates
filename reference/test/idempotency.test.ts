import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { act, deferred, deployRequest, setup } from "./support.ts";

describe("idempotency", () => {
  it("executes a retried action once and returns the first result", async () => {
    const { authority } = setup();
    const grant = authority.issue(deployRequest());
    let effects = 0;
    const deploy = () => {
      effects += 1;
      return `release-${effects}`;
    };

    const first = await authority.execute(act(grant, "deploy", "env:staging/api", "deploy-api-1.42"), deploy);
    const retry = await authority.execute(act(grant, "deploy", "env:staging/api", "deploy-api-1.42"), deploy);

    assert.equal(effects, 1);
    assert.deepEqual(first, { status: "executed", mandateId: grant.mandate.id, result: "release-1" });
    assert.deepEqual(retry, { status: "replayed", mandateId: grant.mandate.id, result: "release-1" });
  });

  it("holds the effect once across runs under the same grantor", async () => {
    const { authority } = setup();
    const firstRun = authority.issue(deployRequest());
    const secondRun = authority.issue(deployRequest({ holder: "agent:fix-agent/run-7f4" }));
    let effects = 0;

    await authority.execute(act(firstRun, "deploy", "env:staging/api", "deploy-api-1.42"), () => (effects += 1));
    const second = await authority.execute(
      act(secondRun, "deploy", "env:staging/api", "deploy-api-1.42"),
      () => (effects += 1),
    );

    assert.equal(effects, 1);
    assert.equal(second.status, "replayed");
  });

  it("keeps different grantors' keys apart", async () => {
    const { authority } = setup();
    const mine = authority.issue(deployRequest());
    const theirs = authority.issue(deployRequest({ grantor: "person:another" }));
    let effects = 0;

    await authority.execute(act(mine, "deploy", "env:staging/api", "shared-key"), () => (effects += 1));
    const other = await authority.execute(act(theirs, "deploy", "env:staging/api", "shared-key"), () => (effects += 1));

    assert.equal(effects, 2);
    assert.equal(other.status, "executed");
  });

  it("refuses a concurrent retry while the first attempt is still running", async () => {
    const { authority } = setup();
    const grant = authority.issue(deployRequest());
    const release = deferred<string>();
    let effects = 0;

    const first = authority.execute(act(grant, "deploy", "env:staging/api", "k1"), () => {
      effects += 1;
      return release.promise;
    });
    const concurrent = await authority.execute(act(grant, "deploy", "env:staging/api", "k1"), () => {
      effects += 1;
      return "second";
    });
    release.resolve("first");

    assert.deepEqual(concurrent, { status: "refused", mandateId: grant.mandate.id, reason: "in_progress" });
    assert.equal((await first).status, "executed");
    assert.equal(effects, 1);
  });

  it("allows a retry after a failed attempt, because nothing took effect", async () => {
    const { authority } = setup();
    const grant = authority.issue(deployRequest());

    await assert.rejects(
      authority.execute(act(grant, "deploy", "env:staging/api", "k1"), () => {
        throw new Error("registry unavailable");
      }),
      /registry unavailable/,
    );
    const retry = await authority.execute(act(grant, "deploy", "env:staging/api", "k1"), () => "deployed");

    assert.deepEqual(retry, { status: "executed", mandateId: grant.mandate.id, result: "deployed" });
    const fail = authority.record.entries().find((entry) => entry.type === "fail");
    assert.equal(fail?.type === "fail" && fail.error, "registry unavailable");
  });

  it("refuses a key reused for a different action or resource", async () => {
    const { authority } = setup();
    const grant = authority.issue(deployRequest());
    await authority.execute(act(grant, "deploy", "env:staging/api", "k1"), () => "ok");

    const otherResource = await authority.execute(act(grant, "deploy", "env:staging/web", "k1"), () => "ok");
    const otherAction = await authority.execute(act(grant, "open_pull_request", "repo:api", "k1"), () => "ok");

    assert.equal(otherResource.status === "refused" && otherResource.reason, "idempotency_key_conflict");
    assert.equal(otherAction.status === "refused" && otherAction.reason, "idempotency_key_conflict");
  });

  it("records the replay so the retry is visible in the evidence", async () => {
    const { authority } = setup();
    const grant = authority.issue(deployRequest());

    await authority.execute(act(grant, "deploy", "env:staging/api", "k1"), () => "ok");
    await authority.execute(act(grant, "deploy", "env:staging/api", "k1"), () => "ok");

    assert.deepEqual(
      authority.record.entries().map((entry) => entry.type),
      ["grant", "allow", "complete", "replay"],
    );
  });
});
