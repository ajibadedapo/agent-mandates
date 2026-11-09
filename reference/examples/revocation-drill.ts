import { MandateAuthority, verifyRecord } from "../src/index.ts";

const authority = new MandateAuthority({ clock: Date.now });
const grantor = "person:hammed";

const fixAgent = authority.issue({
  grantor,
  holder: "agent:fix-agent/run-7f3",
  reason: "Fix the failing test in the api service and deploy it to staging",
  actions: ["open_pull_request", "deploy"],
  resources: ["repo:api", "env:staging/*"],
  expiresAt: Date.now() + 15 * 60_000,
});
const smokeTester = authority.delegate(fixAgent.credential, {
  holder: "agent:smoke-tester/run-7f3-1",
  reason: "Run smoke checks against the staging deploy",
  actions: ["deploy"],
  resources: ["env:staging/api"],
  expiresAt: fixAgent.mandate.expiresAt,
});
const docsAgent = authority.issue({
  grantor,
  holder: "agent:docs-agent/run-a01",
  reason: "Publish the docs preview to staging",
  actions: ["deploy"],
  resources: ["env:staging/docs"],
  expiresAt: Date.now() + 15 * 60_000,
});

function show(label: string, value: unknown): void {
  console.log(`${label.padEnd(34)} ${JSON.stringify(value)}`);
}

show("1. fix-agent deploys to staging", await authority.execute(
  { credential: fixAgent.credential, action: "deploy", resource: "env:staging/api", idempotencyKey: "deploy-api-1.42" },
  () => "api 1.42 on staging",
));
show("2. fix-agent tries production", await authority.execute(
  { credential: fixAgent.credential, action: "deploy", resource: "env:production/api", idempotencyKey: "deploy-api-1.42-prod" },
  () => "api 1.42 on production",
));
show("3. same deploy retried", await authority.execute(
  { credential: fixAgent.credential, action: "deploy", resource: "env:staging/api", idempotencyKey: "deploy-api-1.42" },
  () => "api 1.42 on staging, again",
));

const longJob = authority.execute(
  { credential: smokeTester.credential, action: "deploy", resource: "env:staging/api", idempotencyKey: "smoke-1" },
  (signal) =>
    new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => resolve("smoke checks finished"), 60_000);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(signal.reason);
      });
    }),
);

show("4. grantor revokes fix-agent", authority.revoke(fixAgent.mandate.id, grantor, "Revocation drill"));
show("5. in-flight sub-agent job", await longJob.then(
  (outcome) => outcome,
  (error: Error) => ({ stopped: error.message }),
));
show("6. fix-agent next call", await authority.execute(
  { credential: fixAgent.credential, action: "deploy", resource: "env:staging/api", idempotencyKey: "deploy-api-1.43" },
  () => "api 1.43 on staging",
));
show("7. sub-agent next call", await authority.execute(
  { credential: smokeTester.credential, action: "deploy", resource: "env:staging/api", idempotencyKey: "smoke-2" },
  () => "smoke checks",
));
show("8. unrelated agent still works", await authority.execute(
  { credential: docsAgent.credential, action: "deploy", resource: "env:staging/docs", idempotencyKey: "docs-1" },
  () => "docs preview on staging",
));

console.log("\nRecord:");
for (const entry of authority.record.entries()) {
  const detail = entry.type === "refuse" ? ` (${entry.refusal})` : "";
  console.log(`  #${entry.seq} ${entry.type}${detail} ${entry.mandateId ?? "-"} ${entry.hash.slice(0, 12)}`);
}
show("\nRecord verifies against its head", verifyRecord(authority.record.entries(), { head: authority.record.head() }));
