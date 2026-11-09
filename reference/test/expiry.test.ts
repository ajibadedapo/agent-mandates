import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MINUTE, START, act, deployRequest, setup } from "./support.ts";

describe("expiry", () => {
  it("allows the last millisecond before expiry and refuses at the expiry instant", async () => {
    const { authority, clock } = setup();
    const grant = authority.issue(deployRequest({ expiresAt: START + 10 * MINUTE }));

    clock.set(START + 10 * MINUTE - 1);
    const before = await authority.execute(act(grant, "deploy", "env:staging/api", "k1"), () => "ok");
    clock.set(START + 10 * MINUTE);
    const at = await authority.execute(act(grant, "deploy", "env:staging/api", "k2"), () => "ok");

    assert.equal(before.status, "executed");
    assert.deepEqual(at, { status: "refused", mandateId: grant.mandate.id, reason: "expired" });
  });

  it("stops working on its own, with nobody revoking it", async () => {
    const { authority, clock } = setup();
    const grant = authority.issue(deployRequest({ expiresAt: START + MINUTE }));
    let runs = 0;

    clock.advance(2 * MINUTE);
    const outcome = await authority.execute(act(grant, "deploy", "env:staging/api", "k1"), () => {
      runs += 1;
    });

    assert.equal(outcome.status === "refused" && outcome.reason, "expired");
    assert.equal(runs, 0);
  });

  it("cannot be extended by delegating from an expired mandate", () => {
    const { authority, clock } = setup();
    const parent = authority.issue(deployRequest({ expiresAt: START + MINUTE }));

    clock.advance(MINUTE);

    assert.throws(
      () =>
        authority.delegate(parent.credential, {
          holder: "agent:test-runner/run-7f3-1",
          reason: "Run the staging smoke tests",
          actions: ["deploy"],
          resources: ["env:staging/api"],
          expiresAt: START + 5 * MINUTE,
        }),
      /expired/,
    );
  });
});
