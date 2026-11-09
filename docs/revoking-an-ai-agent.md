# Revoking an AI agent: what actually has to happen

Hammed Ajibade, November 2026. Part of [Agent Mandates](../README.md).

Most teams that run agents believe they can switch one off. Ask how, and the answer is usually: delete its API key, flip a flag in its configuration, or tell it to stop. Each can leave the agent acting for minutes or hours afterwards, and none produces evidence that it stopped.

This note sets out what a complete revocation requires, why the usual approaches fall short, and how to test it. The worked example is the [reference implementation](../reference/) in this repository, whose tests demonstrate each step.

A working definition first. Revoking an agent's authority is complete when, after the grantor revokes it at time *t*:

1. no new effect starts under that authority after *t*, at any enforcement point, including through sub-agents it delegated to;
2. work already running under it is told to stop, and anything that finishes anyway is visible;
3. nothing else stops: no other agent, person or pipeline loses access;
4. there is a record that shows all of the above, which the operator cannot quietly edit.

Anything less is a pause request.

## Why revocation fails in practice

**Cached tokens.** A self-contained token, such as a signed JWT, is checked by verifying its signature and expiry. Nothing in that check asks whether the grant still stands, so a revoked token keeps working until it expires. Gateways that cache introspection results, and services that poll a revocation list every few minutes, have the same gap at a smaller scale. If the token lives for a day, revocation takes a day.

**Long-running jobs.** Many agent runtimes authorise a job when it starts. A forty-minute migration, a crawl, or a multi-step plan then runs on that single decision. Revoking the credential stops the next job, not this one.

**Delegated sub-agents.** An orchestrating agent hands work to sub-agents, often by minting them credentials of their own. Revoking the parent's credential does nothing to the children's. The sub-agents are now orphans: they hold valid authority derived from a grant that no longer exists, and nobody is tracking them.

**Queued actions.** Agents frequently plan first and execute later. Actions are authorised when they are queued, then executed by a worker some time afterwards. If revocation happens in between, the queue drains anyway. A retry policy can make this worse by resurrecting an action that failed before the revocation.

**Revocation that depends on the agent.** A pause flag in the agent's own configuration only works if the agent reads it and obeys. An agent that is misbehaving, or merely stuck in a retry loop, is the case where that assumption is least safe.

## What a complete revocation needs

### 1. An authority check at execution time

The decision to allow an action has to be made at the moment the effect starts, by a component outside the agent, against current state. Not at planning time, not at queue time, not at job start.

In the reference, every action goes through `execute`. The credential is an opaque random value; the authority stores only its digest and looks up the mandate on each call. The check and the start of the effect happen in one synchronous step, so a revocation cannot land between them:

```ts
const decision = this.#authorise(request);
if (!decision.ok) {
  return this.#refuse(request, decision.mandate, decision.reason);
}
```

`#authorise` refuses an unknown credential, a revoked or expired mandate (or ancestor), an action or resource outside scope, and a missing idempotency key. A refusal never calls the effect. The test `refuses a revoked mandate on the very next call, with no clock movement` proves the property directly: revoke, then call again in the same instant, and the call is refused.

In a distributed system this means the enforcement point (an API gateway, a tool server, a policy engine in front of the target system) asks the authority, or a strongly consistent copy of its revocation state, on every call. OAuth 2.0 Token Introspection ([RFC 7662](https://www.rfc-editor.org/rfc/rfc7662)) is the standard shape of that question. OWASP's guidance on [Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) calls the same idea complete mediation: authorise in the downstream system, not in the model.

### 2. Short-lived credentials

Short lifetimes are the backstop for every place the execution-time check is cached, skipped or unreachable. The reference refuses to issue a mandate that lasts longer than a configured maximum (an hour by default), and checks expiry on every call against an injected clock. The tests pin the boundary: an action at one millisecond before expiry runs; the same action at the expiry instant is refused.

If you must use self-contained tokens, keep their lifetime shorter than the revocation delay you are prepared to accept, and push revocation events to the systems that cache them. The OpenID [Continuous Access Evaluation Profile](https://openid.net/specs/openid-caep-1_0-final.html) defines a session-revoked event for exactly this purpose.

### 3. Delegation-chain invalidation

Revoking a mandate has to revoke everything derived from it. There are two ways to do it: propagate the revocation to every descendant, or check the whole chain on every call. The reference does the second, because it stays correct even if the list of descendants is incomplete:

```ts
for (let link: Mandate | undefined = mandate; link !== undefined; ) {
  if (this.#revoked.has(link.id)) return "revoked";
  if (now >= link.expiresAt) return "expired";
  link = link.parentId === null ? undefined : this.#mandates.get(link.parentId);
}
```

Two rules at delegation time make the chain trustworthy. A delegated mandate can only narrow its parent's scope, and it cannot outlive its parent. Delegating from a revoked or expired mandate is refused. The test `refuses a sub-agent the moment its parent is revoked` revokes a parent and shows that a child and a grandchild are both refused on their next call, while `lets the grantor revoke one sub-agent without stopping its parent` shows the reverse is also precise.

### 4. Draining or cancelling in-flight work

Queued work is handled by the execution-time check: an action that was valid when queued is refused when it is dequeued. The test `refuses queued work at execution time` queues three deploys, revokes after the first, and shows that only the first effect happened.

Running work needs a signal. In the reference, each effect receives an `AbortSignal`. Revoking a mandate aborts the signal for every in-flight effect under it and under every descendant, and the revocation entry in the record states how many were cancelled.

Cancellation is cooperative. An effect that ignores the signal, or a third party that has already accepted a request, will finish. The reference does not hide that: the test `records an in-flight effect that ignored the signal and finished anyway` shows a `complete` entry after the `revoke`. This is why the framework requires a second key or a verified way back for irreversible actions. Revocation stops the next step; it cannot unsend the last one.

Idempotency closes the remaining gap. A retry carries the same key as the original attempt, and the authority checks the mandate before it looks the key up. So a retry after revocation is refused, and a retry under a fresh mandate for the same grantor replays the stored result instead of repeating the effect.

### 5. Proof it stopped

"We revoked it" is a claim. Evidence is a record that shows the revocation, what it affected, and the refusals that followed. The reference writes every grant, allowed action, outcome, refusal and revocation to a hash-chained record. Each entry's hash covers its content and the previous entry's hash, so `verifyRecord` detects an edited field, a changed timestamp, a deleted entry or a reordering.

A hash chain on its own is tamper-evident only against people who do not control the writer. Whoever runs the system can rewrite the entire chain and recompute every hash, and the tests show that this forgery passes a bare verification. It fails as soon as the verifier holds a head hash that was published or countersigned before the rewrite. As [Crosby and Wallach](https://www.usenix.org/legacy/events/sec09/tech/full_papers/crosby.pdf) put the general point, a tamper-evident log needs auditors who keep commitments.

## Testing it: revocation drills

If you have never pulled the switch, you do not know that you have one. A revocation drill makes it routine. Against a real agent, in a non-production environment first:

1. **Start real work.** Let the agent run a task that includes a queued action, a long-running step and, if it delegates, a sub-agent.
2. **Revoke from outside.** Use the grantor's revocation channel. Do not ask the agent to stop, and do not change its configuration.
3. **Attempt the next action.** Try an action the agent was allowed a moment ago, through every enforcement point it can reach. Each attempt must be refused.
4. **Check the sub-agents and the queue.** Each must be refused on its next call.
5. **Check everyone else.** Other agents and people keep working. Nothing had to be rotated.
6. **Collect the evidence.** Export the record, verify it against the anchored head, and confirm it shows the revocation, the affected mandates, any in-flight work and the refusals.

Measure the time from revocation to the first refusal at each enforcement point, and count anything that completed after the revocation. Those two numbers are your actual off switch, whatever the design says.

The reference runs this drill as a script (`npm run drill`) and as automated tests that should run on every change: the very-next-call refusal, the queued-work refusal, the chain revocation of a child and grandchild, the in-flight cancellation, the unaffected neighbour, and the replay refusal after revocation.

## How this maps to the standards

The [OWASP Top 10 for Agentic Applications for 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) lists ASI03 Identity and Privilege Abuse, ASI08 Cascading Failures and ASI10 Rogue Agents. Per-run identity and chain-wide revocation address the first; stopping a whole delegation tree and refusing duplicate retries limit the second; revocation that does not depend on the agent is the containment control for the third. [LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) asks for authorisation in downstream systems, which is the execution-time check.

In the [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework), revocation is a Manage function treatment, and the drill is how the Measure function gets a number for it. NIST's National Cybersecurity Center of Excellence [concept paper on software and AI agent identity and authorization](https://csrc.nist.gov/pubs/other/2026/02/05/accelerating-the-adoption-of-software-and-ai-agent/ipd) asks how agents should be identified, authorised and audited, and how their actions can be made non-repudiable.

The UK ICO's [Tech futures: Agentic AI](https://ico.org.uk/about-the-ico/research-reports-impact-and-evaluation/research-and-reports/technology-and-innovation/tech-horizons-and-ico-tech-futures/ico-tech-futures-agentic-ai/) report names systems with "no measures in place to secure access, monitor or stop activity" as a source of data protection risk. A drilled revocation, with a verifiable record, is a direct answer to that. The ICO's [call for evidence on agentic AI](https://ico.org.uk/about-the-ico/ico-and-stakeholder-consultations/2026/10/agentic-ai-call-for-evidence/) is open until 20 November 2026 and asks about data security and accountability among other themes.

None of these documents prescribes this design, and none has reviewed it.

## Summary

A complete revocation is an execution-time check outside the agent, credentials too short-lived for caches to outlast, a delegation chain that dies with its root, a signal to running work with idempotency behind it, and a record you can verify. Each can be tested.
