# Agent Mandates

**Agents act under a mandate, never under your identity.**

Version 0 (draft for comment), October 2026. Hammed Ajibade.

---

## The problem

AI agents have moved from writing text to taking actions: deploying code, submitting forms, moving money, editing data. Most of them do it by borrowing a person's identity. The agent logs in as you, holds your tokens, and can do anything you can do. The only limits are instructions in a prompt.

That is the same-user problem. When the agent and the person are the same identity:

- you cannot tell their actions apart afterwards,
- you cannot narrow what the agent may do without narrowing yourself,
- you cannot stop the agent without stopping yourself,
- two runs of the same agent look like one actor,
- and nobody can say who approved a given action.

None of this is new. Organisations have let strangers act on someone else's behalf, safely, for a long time. Banks do it every day.

## The idea, borrowed on purpose

A direct debit mandate lets a company take money from your account without ever holding your bank login.

| Direct debit mandate | Agent mandate |
|---|---|
| Names one payee and a purpose | Names one agent and one job |
| Limits amount and schedule | Limits actions, resources, volume, spend and time |
| You cancel it at your bank, not by asking the payee | Revocation is held by the grantor and enforced outside the agent |
| Wrong collections are refunded under a guarantee | Irreversible actions need a second key or a way back |
| Every collection references the mandate you signed | Every action references the mandate it ran under and the person who granted it |
| The same collection is not taken twice | The same instruction has its effect only once |

An agent mandate is that structure, applied to software that acts.

## What a mandate contains

A mandate is a record, issued by a person or an accountable system, that an agent presents when it acts. At minimum it states:

1. **Grantor**: the person who is accountable for what the agent does.
2. **Holder**: the specific agent and the specific run it was issued to.
3. **Purpose**: the job, in plain words.
4. **Scope**: the actions allowed, on which resources.
5. **Limits**: counts, amounts, rates and spend.
6. **Expiry**: when it stops working, by default soon.
7. **Approval points**: which actions need a second key before they happen.
8. **Revocation channel**: where the grantor cancels it, outside the agent.

## Action classes

Not every action carries the same risk. A mandate grants each class separately.

| Class | Example | Default |
|---|---|---|
| **Read** | Query logs, list files, inspect a system | Allowed within scope |
| **Recommend** | Draft a change, propose a fix, prepare a form | Allowed; nothing leaves the agent |
| **Execute** | Apply a change, submit a form, send a message | Only when named in the mandate |
| **Irreversible** | Delete data, deploy to production, move money, publish | Second key, or a tested way back |

## The six principles

### 1. Mandate, not identity

An agent never acts as a person. It acts under its own identity, holding a mandate from a person.

- An agent's credentials MUST be distinct from any human's credentials.
- Each run SHOULD receive its own holder identity, so concurrent runs are distinguishable.
- Systems that receive an agent's action MUST be able to tell it came from an agent, and which one.

*Prevents:* two runs of one job submitting the same application twice under one shared identity; an agent posting under a brand it was never meant to speak for.

### 2. Bounded by default

A mandate states its purpose, scope, limits and expiry. Anything not granted is refused.

- A mandate MUST have an expiry. Standing access is not a mandate.
- Scope MUST be expressed as action class plus resource, not as "everything this user can do".
- Limits SHOULD cover volume and spend, so one job cannot exhaust a budget shared with people.

*Prevents:* an agent asked to audit something deciding to change it; scheduled jobs consuming a shared quota until the people who share it are locked out.

### 3. The grantor holds the off switch

Revocation belongs to the grantor and is enforced outside the agent.

- Revoking a mandate MUST take effect without the agent's cooperation.
- A paused or revoked agent MUST NOT be able to act, even if its own configuration says otherwise.
- Revocation SHOULD take effect within seconds and be observable: the grantor can confirm it worked.

*Prevents:* a job marked as paused that keeps running, because the pause was a flag the job itself was trusted to read.

### 4. Irreversible needs a second key

An action that cannot be undone needs either a second approval or a tested way back before it runs.

- The mandate MUST name which actions are irreversible.
- Irreversible actions MUST require an approval by someone other than the agent, or a recovery path that has been verified to exist at the time of the action.
- Deleting the recovery path (backups, rollback images, previous versions) is itself irreversible.

*Prevents:* an automated deploy that wipes a production database's accounts; a rollback that fails because the image it needed had already been pruned.

### 5. Every action has an owner

Every action traces to the mandate it ran under and the person who granted it.

- Each action record MUST reference the holder, the mandate, and the grantor.
- Approvals MUST be recorded with who approved, what they saw, and when.
- Records SHOULD be append-only and tamper-evident.

*Answers:* "Who approved that?", with evidence instead of a guess.

### 6. Once means once

The same instruction has its effect only once, no matter how many times it is retried.

- Execute and irreversible actions MUST carry an idempotency key derived from the mandate and the intended effect.
- A retry, a restart, or a second run of the same job MUST NOT repeat an effect that already happened.

*Prevents:* the duplicate submission, payment or post that appears when a job is retried after a timeout it actually survived.

## Maturity levels

| Level | Name | What is true |
|---|---|---|
| **0** | Borrowed identity | Agents act as a person. Limits live in prompts. |
| **1** | Separate credentials | Agents have their own credentials with narrowed scope. No expiry or per-run identity. |
| **2** | Mandated | Per-run mandates with purpose, scope, limits and expiry. Revocation works from outside the agent. |
| **3** | Accountable | Level 2, plus second keys on irreversible actions, idempotent execution, and a tamper-evident record linking every action to a mandate and a grantor. |

## Audit checklist

For any agent that acts:

1. Can you tell this agent's actions apart from the person's, and from its other runs?
2. Does its access expire on its own?
3. Can you list exactly what it is allowed to do, by action class and resource?
4. If you revoke it now, does it stop without its cooperation, and can you prove it stopped?
5. Which of its possible actions are irreversible, and what stands in front of each one?
6. For any action it took last week, can you name the mandate and the person who granted it?
7. If its last run is retried, what happens twice?

## Related work

This framework stands on older ideas and does not replace them.

- **Least privilege** and **capability-based security** (Dennis and Van Horn, 1966): authority travels with an unforgeable grant, not with an identity.
- **The confused deputy** (Hardy, 1988): a program misusing authority it holds for someone else.
- **OAuth 2.0 Token Exchange** (RFC 8693): delegation and actor claims, a building block for issuing mandates.
- **Agent Payments Protocol (AP2)**: uses mandates for agent payments. Agent Mandates applies the same model to every kind of action.
- **OWASP agentic AI guidance** and the **NIST AI Risk Management Framework**: threat and risk views that this authority view complements.

## Status and feedback

This is version 0. The principles are intended to stay stable; the requirements and levels will change with feedback from people building and auditing agent systems.

Feedback, objections and real-world examples are welcome as [issues](https://github.com/ajibadedapo/agent-mandates/issues).

## Citing

> Ajibade, H. (2026). *Agent Mandates: agents act under a mandate, never under your identity* (Version 0). https://github.com/ajibadedapo/agent-mandates

## Licence

[CC BY 4.0](LICENSE). Use, adapt and build on it, including commercially, with attribution.
