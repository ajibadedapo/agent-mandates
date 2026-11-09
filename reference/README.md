# Agent Mandates: reference implementation

A small, dependency-free TypeScript implementation of the Agent Mandates model. It runs in a single Node.js process with no external services, so every claim in the framework can be checked by reading about 500 lines of code and running the tests.

It is a reference, not a product. It shows where each control sits and what it must refuse. A production system would put the same checks behind a network boundary, in durable storage, with real authentication of the holder.

## Run it

Requires Node.js 22.18 or later, which runs TypeScript directly.

```sh
cd reference
npm install        # installs typescript and @types/node, for type checking only
npm test           # node:test, injected clock, no network
npm run typecheck  # tsc --noEmit, strict
npm run drill      # a scripted revocation drill with printed evidence
```

`npm test` and `npm run drill` do not need `npm install`; only `npm run typecheck` does.

## What it implements

| Control | Where | Framework principle |
|---|---|---|
| Issue a mandate naming grantor, holder, reason, actions, resources and expiry | `MandateAuthority.issue` | 1, 2 |
| Refuse to let an agent hold the grantor's identity | `issue` validation | 1 |
| Cap mandate lifetime so standing access cannot be issued | `maxLifetimeMs` | 2 |
| Check every action at execution time, before the effect runs | `MandateAuthority.execute` | 2, 3 |
| Expiry enforced on every check, from an injected clock | `#chainState` | 2 |
| Immediate revocation, held by the grantor, without the agent's cooperation | `MandateAuthority.revoke` | 3 |
| Delegation to sub-agents that can only narrow scope and lifetime, and that dies with its parent | `MandateAuthority.delegate` | 2, 3 |
| Cancellation signal to in-flight work when its mandate, or any ancestor, is revoked | `AbortSignal` passed to each effect | 3 |
| Hash-chained, append-only record of grants, allows, refusals, revocations and outcomes | `AuditRecord` | 5 |
| Tamper detection, with an optional externally anchored head | `verifyRecord` | 5 |
| Idempotency key, so a retried action has its effect once | `execute` | 6 |

Principle 4 (a second key for irreversible actions) is not implemented here. It needs an approval workflow with a second identity, which is outside the scope of a single-process reference.

## Using it

```ts
import { MandateAuthority, verifyRecord } from "./src/index.ts";

const authority = new MandateAuthority({ clock: Date.now });

const { mandate, credential } = authority.issue({
  grantor: "person:hammed",
  holder: "agent:fix-agent/run-7f3",
  reason: "Fix the failing test in the api service and deploy it to staging",
  actions: ["open_pull_request", "deploy"],
  resources: ["repo:api", "env:staging/*"],
  expiresAt: Date.now() + 15 * 60_000,
});

const outcome = await authority.execute(
  { credential, action: "deploy", resource: "env:staging/api", idempotencyKey: "deploy-api-1.42" },
  (signal) => deploy("api", "1.42", { signal }),
);

authority.revoke(mandate.id, "person:hammed", "Revocation drill");

verifyRecord(authority.record.entries(), { head: authority.record.head() });
```

`execute` returns `executed`, `replayed` (the same idempotency key already succeeded) or `refused` with a reason. A refused action never calls the effect. If the effect throws, the error propagates, a `fail` entry is recorded and the key is released so the action can be retried.

## Design decisions

- **The credential is an opaque reference, not a self-contained token.** The authority stores only a SHA-256 digest of it and looks up the mandate on every call. That is what makes revocation take effect on the very next call. A signed, self-contained token would keep working until it expired.
- **Every check walks the delegation chain.** A sub-agent's mandate is refused if any ancestor is revoked or expired, so revoking a parent needs no list of children to be correct. The record still lists every affected descendant, as evidence.
- **The check and the start of the effect happen in the same synchronous step**, so a revocation cannot slip in between them. Once the effect is running, revocation can only signal it through the `AbortSignal`. An effect that ignores the signal will finish, and the record will say so with a `complete` entry after the `revoke`.
- **Idempotency keys are scoped to the grantor**, not to one mandate, so a second run of the same job under a fresh mandate still has its effect only once. Reusing a key for a different action or resource is refused rather than silently replayed.
- **The record is a linear hash chain.** Each entry's SHA-256 hash covers its canonical JSON and the previous entry's hash. `verifyRecord` detects edits, deletions, insertions and reordering. Truncating the tail, or rewriting the whole chain, is detected only when the verifier holds a head hash anchored somewhere the writer cannot change. Publish or countersign `record.head()` to get that property.
- **Time is injected.** Tests use a fake clock; nothing reads the system clock except the example drill.

## Limits

- State is in memory. Restarting the process loses mandates, revocations and idempotency outcomes.
- The holder is authenticated only by possession of the credential. Production use should bind the credential to the agent's workload identity (for example mTLS or a proof-of-possession token) so a leaked credential is not enough.
- One process is one authority. Multiple enforcement points need a shared, strongly consistent store for revocations and idempotency outcomes, or revocation will not be immediate everywhere.
- The record lives with the authority that writes it. Tamper evidence against that authority itself needs an external anchor, as above.

## Licence

[CC BY 4.0](../LICENSE), the same as the framework.
