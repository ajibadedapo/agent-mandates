import { MandateAuthority } from "../src/index.ts";
import type { Grant, IssueRequest } from "../src/index.ts";

export const START = Date.UTC(2026, 10, 9, 9, 30, 0, 417);
export const MINUTE = 60_000;

export class FakeClock {
  #now: number;

  constructor(start = START) {
    this.#now = start;
  }

  readonly now = (): number => this.#now;

  advance(ms: number): void {
    this.#now += ms;
  }

  set(at: number): void {
    this.#now = at;
  }
}

export function setup(options: { maxLifetimeMs?: number } = {}) {
  const clock = new FakeClock();
  const authority = new MandateAuthority({ clock: clock.now, ...options });
  return { clock, authority };
}

export function deployRequest(overrides: Partial<IssueRequest> = {}): IssueRequest {
  return {
    grantor: "person:hammed",
    holder: "agent:fix-agent/run-7f3",
    reason: "Fix the failing test in the api service and deploy it to staging",
    actions: ["open_pull_request", "deploy"],
    resources: ["repo:api", "env:staging/*"],
    expiresAt: START + 30 * MINUTE,
    ...overrides,
  };
}

export function act(grant: Grant, action: string, resource: string, idempotencyKey: string) {
  return { credential: grant.credential, action, resource, idempotencyKey };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}
