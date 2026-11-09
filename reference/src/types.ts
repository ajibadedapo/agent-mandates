import type { Scope } from "./scope.ts";

export type Clock = () => number;

export interface Mandate {
  readonly id: string;
  readonly grantor: string;
  readonly holder: string;
  readonly delegatedBy: string | null;
  readonly parentId: string | null;
  readonly reason: string;
  readonly scope: Scope;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export type RefusalReason =
  | "unknown_credential"
  | "expired"
  | "revoked"
  | "action_out_of_scope"
  | "resource_out_of_scope"
  | "missing_idempotency_key"
  | "idempotency_key_conflict"
  | "in_progress";

export type RecordEvent =
  | {
      readonly type: "grant";
      readonly mandateId: string;
      readonly parentId: string | null;
      readonly grantor: string;
      readonly holder: string;
      readonly delegatedBy: string | null;
      readonly reason: string;
      readonly actions: readonly string[];
      readonly resources: readonly string[];
      readonly expiresAt: number;
    }
  | {
      readonly type: "revoke";
      readonly mandateId: string;
      readonly revokedBy: string;
      readonly reason: string;
      readonly affected: readonly string[];
      readonly cancelledInFlight: number;
    }
  | {
      readonly type: "allow";
      readonly mandateId: string;
      readonly grantor: string;
      readonly holder: string;
      readonly action: string;
      readonly resource: string;
      readonly idempotencyKey: string;
    }
  | {
      readonly type: "refuse";
      readonly mandateId: string | null;
      readonly holder: string | null;
      readonly action: string;
      readonly resource: string;
      readonly refusal: RefusalReason;
    }
  | {
      readonly type: "complete" | "replay";
      readonly mandateId: string;
      readonly idempotencyKey: string;
    }
  | {
      readonly type: "fail";
      readonly mandateId: string;
      readonly idempotencyKey: string;
      readonly error: string;
    };

export type RecordEntry = RecordEvent & {
  readonly seq: number;
  readonly at: number;
  readonly prevHash: string;
  readonly hash: string;
};
