import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AuditRecord } from "./record.ts";
import { allowsAction, allowsResource, scopeCovers } from "./scope.ts";
import type { Clock, Mandate, RefusalReason } from "./types.ts";

export interface IssueRequest {
  readonly grantor: string;
  readonly holder: string;
  readonly reason: string;
  readonly actions: readonly string[];
  readonly resources: readonly string[];
  readonly expiresAt: number;
}

export type DelegateRequest = Omit<IssueRequest, "grantor">;

export interface Grant {
  readonly mandate: Mandate;
  readonly credential: string;
}

export interface ActionRequest {
  readonly credential: string;
  readonly action: string;
  readonly resource: string;
  readonly idempotencyKey: string;
}

export type Effect<T> = (signal: AbortSignal) => T | Promise<T>;

export type ExecuteResult<T> =
  | { readonly status: "executed" | "replayed"; readonly mandateId: string; readonly result: T }
  | { readonly status: "refused"; readonly mandateId: string | null; readonly reason: RefusalReason };

export type RevokeResult =
  | { readonly status: "revoked"; readonly affected: readonly string[]; readonly cancelledInFlight: number }
  | { readonly status: "rejected"; readonly reason: "unknown_mandate" | "not_grantor" | "already_revoked" };

export interface AuthorityOptions {
  readonly clock: Clock;
  readonly maxLifetimeMs?: number;
}

export class MandateError extends Error {
  override name = "MandateError";
}

type Decision =
  | { readonly ok: true; readonly mandate: Mandate }
  | { readonly ok: false; readonly mandate: Mandate | null; readonly reason: RefusalReason };

interface Outcome {
  readonly action: string;
  readonly resource: string;
  readonly state: "running" | "done";
  readonly result?: unknown;
}

const DEFAULT_MAX_LIFETIME_MS = 60 * 60 * 1000;

function digest(credential: string): string {
  return createHash("sha256").update(credential).digest("hex");
}

export class MandateAuthority {
  readonly record: AuditRecord;
  readonly #clock: Clock;
  readonly #maxLifetimeMs: number;
  readonly #mandates = new Map<string, Mandate>();
  readonly #credentialDigests = new Map<string, string>();
  readonly #children = new Map<string, string[]>();
  readonly #revoked = new Set<string>();
  readonly #inFlight = new Map<string, Set<AbortController>>();
  readonly #outcomes = new Map<string, Outcome>();

  constructor(options: AuthorityOptions) {
    this.#clock = options.clock;
    this.#maxLifetimeMs = options.maxLifetimeMs ?? DEFAULT_MAX_LIFETIME_MS;
    this.record = new AuditRecord(options.clock);
  }

  issue(request: IssueRequest): Grant {
    return this.#grant(request, null);
  }

  delegate(parentCredential: string, request: DelegateRequest): Grant {
    const parent = this.#mandateFor(parentCredential);
    if (parent === null) {
      throw new MandateError("Unknown parent credential.");
    }
    const parentState = this.#chainState(parent);
    if (parentState !== null) {
      throw new MandateError(`Parent mandate is ${parentState}.`);
    }
    if (!scopeCovers(parent.scope, request)) {
      throw new MandateError("A delegated scope must be within the parent scope.");
    }
    if (request.expiresAt > parent.expiresAt) {
      throw new MandateError("A delegated mandate cannot outlive its parent.");
    }
    return this.#grant({ ...request, grantor: parent.grantor }, parent);
  }

  revoke(mandateId: string, revokedBy: string, reason: string): RevokeResult {
    const mandate = this.#mandates.get(mandateId);
    if (mandate === undefined) {
      return { status: "rejected", reason: "unknown_mandate" };
    }
    if (mandate.grantor !== revokedBy) {
      return { status: "rejected", reason: "not_grantor" };
    }
    if (this.#revoked.has(mandateId)) {
      return { status: "rejected", reason: "already_revoked" };
    }
    this.#revoked.add(mandateId);
    const affected = [mandateId, ...this.#descendants(mandateId)];
    let cancelledInFlight = 0;
    for (const id of affected) {
      for (const controller of this.#inFlight.get(id) ?? []) {
        controller.abort(new MandateError(`Mandate ${mandateId} was revoked.`));
        cancelledInFlight += 1;
      }
    }
    this.record.append({ type: "revoke", mandateId, revokedBy, reason, affected, cancelledInFlight });
    return { status: "revoked", affected, cancelledInFlight };
  }

  async execute<T>(request: ActionRequest, effect: Effect<T>): Promise<ExecuteResult<T>> {
    const decision = this.#authorise(request);
    if (!decision.ok) {
      return this.#refuse(request, decision.mandate, decision.reason);
    }
    const { mandate } = decision;
    const outcomeKey = `${mandate.grantor}\u0000${request.idempotencyKey}`;
    const prior = this.#outcomes.get(outcomeKey);
    if (prior !== undefined) {
      if (prior.action !== request.action || prior.resource !== request.resource) {
        return this.#refuse(request, mandate, "idempotency_key_conflict");
      }
      if (prior.state === "running") {
        return this.#refuse(request, mandate, "in_progress");
      }
      this.record.append({ type: "replay", mandateId: mandate.id, idempotencyKey: request.idempotencyKey });
      return { status: "replayed", mandateId: mandate.id, result: prior.result as T };
    }

    this.#outcomes.set(outcomeKey, { action: request.action, resource: request.resource, state: "running" });
    this.record.append({
      type: "allow",
      mandateId: mandate.id,
      grantor: mandate.grantor,
      holder: mandate.holder,
      action: request.action,
      resource: request.resource,
      idempotencyKey: request.idempotencyKey,
    });

    const controller = new AbortController();
    const running = this.#inFlight.get(mandate.id) ?? new Set<AbortController>();
    running.add(controller);
    this.#inFlight.set(mandate.id, running);
    try {
      const result = await effect(controller.signal);
      this.#outcomes.set(outcomeKey, { action: request.action, resource: request.resource, state: "done", result });
      this.record.append({ type: "complete", mandateId: mandate.id, idempotencyKey: request.idempotencyKey });
      return { status: "executed", mandateId: mandate.id, result };
    } catch (error) {
      this.#outcomes.delete(outcomeKey);
      this.record.append({
        type: "fail",
        mandateId: mandate.id,
        idempotencyKey: request.idempotencyKey,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      running.delete(controller);
      if (running.size === 0) {
        this.#inFlight.delete(mandate.id);
      }
    }
  }

  #grant(request: IssueRequest, parent: Mandate | null): Grant {
    const now = this.#clock();
    if (request.holder === request.grantor) {
      throw new MandateError("An agent must hold its own identity, never the grantor's.");
    }
    if (parent !== null && request.holder === parent.holder) {
      throw new MandateError("A delegated mandate must name a different holder.");
    }
    if (request.reason.trim() === "") {
      throw new MandateError("A mandate must state its reason.");
    }
    if (request.actions.length === 0 || request.resources.length === 0) {
      throw new MandateError("A mandate must name at least one action and one resource.");
    }
    if (request.expiresAt <= now) {
      throw new MandateError("A mandate must expire in the future.");
    }
    if (request.expiresAt - now > this.#maxLifetimeMs) {
      throw new MandateError(`A mandate cannot last longer than ${this.#maxLifetimeMs} ms.`);
    }

    const mandate: Mandate = Object.freeze({
      id: randomUUID(),
      grantor: request.grantor,
      holder: request.holder,
      delegatedBy: parent?.holder ?? null,
      parentId: parent?.id ?? null,
      reason: request.reason,
      scope: Object.freeze({
        actions: Object.freeze([...request.actions]),
        resources: Object.freeze([...request.resources]),
      }),
      issuedAt: now,
      expiresAt: request.expiresAt,
    });
    const credential = randomBytes(32).toString("base64url");

    this.#mandates.set(mandate.id, mandate);
    this.#credentialDigests.set(digest(credential), mandate.id);
    if (parent !== null) {
      this.#children.set(parent.id, [...(this.#children.get(parent.id) ?? []), mandate.id]);
    }
    this.record.append({
      type: "grant",
      mandateId: mandate.id,
      parentId: mandate.parentId,
      grantor: mandate.grantor,
      holder: mandate.holder,
      delegatedBy: mandate.delegatedBy,
      reason: mandate.reason,
      actions: mandate.scope.actions,
      resources: mandate.scope.resources,
      expiresAt: mandate.expiresAt,
    });
    return { mandate, credential };
  }

  #authorise(request: ActionRequest): Decision {
    const mandate = this.#mandateFor(request.credential);
    if (mandate === null) {
      return { ok: false, mandate: null, reason: "unknown_credential" };
    }
    const state = this.#chainState(mandate);
    if (state !== null) {
      return { ok: false, mandate, reason: state };
    }
    if (!allowsAction(mandate.scope, request.action)) {
      return { ok: false, mandate, reason: "action_out_of_scope" };
    }
    if (!allowsResource(mandate.scope, request.resource)) {
      return { ok: false, mandate, reason: "resource_out_of_scope" };
    }
    if (request.idempotencyKey.trim() === "") {
      return { ok: false, mandate, reason: "missing_idempotency_key" };
    }
    return { ok: true, mandate };
  }

  #chainState(mandate: Mandate): "revoked" | "expired" | null {
    const now = this.#clock();
    for (let link: Mandate | undefined = mandate; link !== undefined; ) {
      if (this.#revoked.has(link.id)) {
        return "revoked";
      }
      if (now >= link.expiresAt) {
        return "expired";
      }
      link = link.parentId === null ? undefined : this.#mandates.get(link.parentId);
    }
    return null;
  }

  #mandateFor(credential: string): Mandate | null {
    const id = this.#credentialDigests.get(digest(credential));
    return id === undefined ? null : (this.#mandates.get(id) ?? null);
  }

  #descendants(mandateId: string): string[] {
    const direct = this.#children.get(mandateId) ?? [];
    return direct.flatMap((child) => [child, ...this.#descendants(child)]);
  }

  #refuse<T>(request: ActionRequest, mandate: Mandate | null, reason: RefusalReason): ExecuteResult<T> {
    this.record.append({
      type: "refuse",
      mandateId: mandate?.id ?? null,
      holder: mandate?.holder ?? null,
      action: request.action,
      resource: request.resource,
      refusal: reason,
    });
    return { status: "refused", mandateId: mandate?.id ?? null, reason };
  }
}
