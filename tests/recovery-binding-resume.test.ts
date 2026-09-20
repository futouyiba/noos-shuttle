import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bindingChangeDecision,
  budgetForResumedConversation,
  evaluateResumeEligible,
  pauseForSameConversationRecovery,
  resumeAuthorizationRequired,
  resumeEligibilityStopBoundary,
  type ResumeEligibility,
} from "../src/core/recovery-binding-resume";
import {
  createRecoveryBudget,
  type ProviderBinding,
  type RecoveryBudget,
  type RecoveryBudgetScope,
} from "../src/core/recovery-evidence-types";

function binding(overrides: Partial<ProviderBinding> = {}): ProviderBinding {
  return { providerConversationRef: "conv-1", bindingGeneration: 1, headFingerprint: "head-a", ...overrides };
}

function scope(overrides: Partial<RecoveryBudgetScope> = {}): RecoveryBudgetScope {
  return {
    logicalThreadId: "thread-1",
    providerConversationRef: "conv-1",
    bindingGeneration: 1,
    interruptedRoundRef: "round-1",
    ...overrides,
  };
}

function budget(overrides: Partial<RecoveryBudget> = {}): RecoveryBudget {
  return { ...createRecoveryBudget({ budgetId: "bud-1", scope: scope(), maxAttempts: 5, goSlots: { maxSlots: 5 } }), ...overrides };
}

const ELIGIBLE: ResumeEligibility = evaluateResumeEligible({ bootstrapComplete: true, hardVerificationPassed: true, softVerificationMismatch: false });

describe("binding change ends the Run (§6, §6.2)", () => {
  it("ends on any binding-identity field moving, with the rebase stop reason", () => {
    for (const to of [binding({ providerConversationRef: "conv-2" }), binding({ bindingGeneration: 2 }), binding({ headFingerprint: "head-b" })]) {
      const decision = bindingChangeDecision(binding(), to);
      expect(decision.changed).toBe(true);
      expect(decision.disposition).toBe("END");
      expect(decision.endStatus).toBe("FAILED_SAFE");
      expect(decision.stopReason).toBe("CONVERSATION_REBASE_REQUIRED");
    }
  });

  it("does not end the Run on a carrier change, a reload or a single interruption (§6.2)", () => {
    // Carrier identity is not part of ProviderBinding, and reload/interruption
    // are not binding changes — so none of them reach the `changed` branch.
    const decision = bindingChangeDecision(binding(), binding());
    expect(decision.changed).toBe(false);
    expect(decision.disposition).toBe("PAUSED");
    expect(decision.endStatus).toBeUndefined();
    expect(decision.stopReason).toBeUndefined();
  });

  it("records which field moved, for the audit trail", () => {
    const decision = bindingChangeDecision(binding(), binding({ bindingGeneration: 2, headFingerprint: "head-b" }));
    expect(decision.reasons).toEqual(["bindingGeneration", "headFingerprint"]);
  });

  it("pauses, rather than ends, for same-conversation recovery (§6.1)", () => {
    const pause = pauseForSameConversationRecovery({ runId: "run-1", reason: "UNCERTAIN", binding: binding(), evidenceRevision: 4 });
    expect(pause.disposition).toBe("PAUSED");
    expect(pause.allowsNextGo).toBe(false);
    expect(pause.runId).toBe("run-1");
  });
});

describe("RESUME_ELIGIBLE (§6.2)", () => {
  it("requires all three clauses", () => {
    expect(ELIGIBLE.eligible).toBe(true);
    expect(ELIGIBLE.unsatisfied).toEqual([]);

    const cases: Array<[string, Parameters<typeof evaluateResumeEligible>[0]]> = [
      ["BOOTSTRAP_NOT_COMPLETE", { bootstrapComplete: false, hardVerificationPassed: true, softVerificationMismatch: false }],
      ["HARD_RESUME_VERIFICATION_NOT_PASSED", { bootstrapComplete: true, hardVerificationPassed: false, softVerificationMismatch: false }],
      ["SOFT_VERIFICATION_MISMATCH_OR_MISSING", { bootstrapComplete: true, hardVerificationPassed: true, softVerificationMismatch: true }],
    ];
    for (const [expected, input] of cases) {
      const result = evaluateResumeEligible(input);
      expect(result.eligible).toBe(false);
      expect(result.unsatisfied).toContain(expected);
    }
  });

  it("treats a missing verification result as unsatisfied, not as passed", () => {
    // §6.2: "resume verification not passed, or its result missing, must all be
    // handled as a stop boundary" — never fail-open.
    const missing = evaluateResumeEligible({} as Parameters<typeof evaluateResumeEligible>[0]);
    expect(missing.eligible).toBe(false);
    expect(missing.unsatisfied).toHaveLength(3);
  });

  it("does not let `binding committed` or the CC §11 bootstrap-failure path promote eligibility", () => {
    const result = evaluateResumeEligible({
      bootstrapComplete: false,
      hardVerificationPassed: true,
      softVerificationMismatch: false,
      bindingCommitted: true,
      bootstrapFailedButBindingCommitted: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.unsatisfied).toEqual(["BOOTSTRAP_NOT_COMPLETE"]);
  });

  it("NEVER authorizes a go, whether eligible or not", () => {
    expect(ELIGIBLE.authorizesGo).toBe(false);
    expect(ELIGIBLE.requiresNewContinuationAuthorization).toBe(true);
    const ineligible = evaluateResumeEligible({ bootstrapComplete: false, hardVerificationPassed: false, softVerificationMismatch: true });
    expect(ineligible.authorizesGo).toBe(false);
    expect(ineligible.requiresNewContinuationAuthorization).toBe(true);
  });

  it("produces a stop boundary with the pause held when not eligible", () => {
    const boundary = resumeEligibilityStopBoundary(evaluateResumeEligible({ bootstrapComplete: false, hardVerificationPassed: true, softVerificationMismatch: false }));
    expect(boundary.disposition).toBe("PAUSED");
    expect(boundary.stopBoundary).toBe("RESUME_ELIGIBLE_FALSE");
    expect(boundary.authorizesGo).toBe(false);
    expect(boundary.unsatisfied).toContain("BOOTSTRAP_NOT_COMPLETE");
  });
});

describe("RESUME_ELIGIBLE is a precondition for asking, not the permission (§6.2)", () => {
  it("denies when eligibility is false even if an authorization is presented", () => {
    const ineligible = evaluateResumeEligible({ bootstrapComplete: false, hardVerificationPassed: true, softVerificationMismatch: false });
    const decision = resumeAuthorizationRequired({
      eligibility: ineligible,
      newAuthorizationRef: "auth-new",
      priorAuthorizationRef: "auth-old",
      newAuthorizationEstablishedAt: 5_000,
      pausedAt: 1_000,
    });
    expect(decision.authorized).toBe(false);
    expect(decision.denial).toBe("RESUME_ELIGIBLE_FALSE");
  });

  it("denies when eligible but no new authorization exists", () => {
    // The load-bearing case: everything §6.2 names as eligibility is satisfied,
    // and the answer is STILL no — "requires a new continuation authorization
    // after RESUME_ELIGIBLE".
    const decision = resumeAuthorizationRequired({ eligibility: ELIGIBLE });
    expect(decision.authorized).toBe(false);
    expect(decision.denial).toBe("NO_NEW_CONTINUATION_AUTHORIZATION");
  });

  it("denies re-presentation of the pre-pause authorization", () => {
    const decision = resumeAuthorizationRequired({
      eligibility: ELIGIBLE,
      newAuthorizationRef: "auth-old",
      priorAuthorizationRef: "auth-old",
      newAuthorizationEstablishedAt: 5_000,
      pausedAt: 1_000,
    });
    expect(decision.authorized).toBe(false);
    expect(decision.denial).toBe("AUTHORIZATION_NOT_ESTABLISHED_AFTER_PAUSE");
  });

  it("denies an authorization established at or before the pause", () => {
    for (const establishedAt of [1_000, 999]) {
      const decision = resumeAuthorizationRequired({
        eligibility: ELIGIBLE,
        newAuthorizationRef: "auth-new",
        newAuthorizationEstablishedAt: establishedAt,
        pausedAt: 1_000,
      });
      expect(decision.authorized).toBe(false);
      expect(decision.denial).toBe("AUTHORIZATION_NOT_ESTABLISHED_AFTER_PAUSE");
    }
  });

  it("authorizes only an eligible resume with a genuinely new, post-pause authorization", () => {
    const decision = resumeAuthorizationRequired({
      eligibility: ELIGIBLE,
      newAuthorizationRef: "auth-new",
      priorAuthorizationRef: "auth-old",
      newAuthorizationEstablishedAt: 1_001,
      pausedAt: 1_000,
    });
    expect(decision.authorized).toBe(true);
    expect(decision.denial).toBeUndefined();
  });
});

describe("no-actuation property: nothing outside tests imports the recovery modules", () => {
  // The slice's defining boundary. These modules compute verdicts and nothing
  // else; the moment a file under src/ imports one, that stops being true and
  // the claim "this slice performs no actuation" has to be re-argued rather
  // than assumed. This test is the tripwire for that.
  const MODULES = ["recovery-evidence-types", "recovery-evidence-gate", "recovery-binding-resume"] as const;

  it("is not imported by any src module outside the recovery set itself", () => {
    const srcDir = fileURLToPath(new URL("../src", import.meta.url));
    // The three modules may import each other — they are one pure unit. What
    // must never appear is an importer outside them.
    const ownFiles = new Set(MODULES.map((module) => join("src", "core", `${module}.ts`)));
    const importers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        const relative = full.replace(srcDir, "src");
        if (ownFiles.has(relative)) continue;
        const text = readFileSync(full, "utf8");
        for (const module of MODULES) {
          if (new RegExp(`from\\s+["'][^"']*${module}["']`).test(text) || new RegExp(`import\\(["'][^"']*${module}["']\\)`).test(text)) {
            importers.push(relative);
          }
        }
      }
    };
    walk(srcDir);
    expect(importers).toEqual([]);
  });
});

describe("remaining Go × N budget never crosses a binding change as actuation authority (§5.3, §6)", () => {
  it("gives the new Provider Conversation a fresh, empty budget", () => {
    const decision = budgetForResumedConversation({
      budget: budget({ consumedAttempts: 2, goSlots: { maxSlots: 5, consumedSlots: 3 } }),
      from: binding(),
      to: binding({ providerConversationRef: "conv-2", bindingGeneration: 2, headFingerprint: "head-b" }),
      newScope: scope({ providerConversationRef: "conv-2", bindingGeneration: 2 }),
      newBudgetId: "bud-2",
    });
    expect(decision.disposition).toBe("END");
    expect(decision.carried).toBe(false);
    expect(decision.budget?.budgetId).toBe("bud-2");
    expect(decision.budget?.consumedAttempts).toBe(0);
    expect(decision.budget?.goSlots.consumedSlots).toBe(0);
  });

  it("reports what was left behind, for the audit record only", () => {
    const decision = budgetForResumedConversation({
      budget: budget({ consumedAttempts: 2, goSlots: { maxSlots: 5, consumedSlots: 3 } }),
      from: binding(),
      to: binding({ bindingGeneration: 2 }),
      newScope: scope({ bindingGeneration: 2 }),
      newBudgetId: "bud-2",
    });
    expect(decision.priorRemainder).toEqual({ remainingAttempts: 3, remainingGoSlots: 2 });
    // Reported, never transferred:
    expect(decision.budget?.goSlots.maxSlots).toBe(5);
    expect(decision.budget?.goSlots.consumedSlots).toBe(0);
  });

  it("never carries the remainder, on any branch", () => {
    const same = budgetForResumedConversation({
      budget: budget({ consumedAttempts: 2 }),
      from: binding(),
      to: binding(),
      newScope: scope(),
      newBudgetId: "bud-2",
    });
    expect(same.carried).toBe(false);
    expect(same.disposition).toBe("PAUSED");
    // No binding change: the existing budget stands, and still nothing is "carried" into a new one.
    expect(same.budget).toBeUndefined();
  });

  it("keeps the new budget scoped to the new binding generation", () => {
    const decision = budgetForResumedConversation({
      budget: budget(),
      from: binding(),
      to: binding({ bindingGeneration: 2 }),
      newScope: scope({ bindingGeneration: 2 }),
      newBudgetId: "bud-2",
    });
    expect(decision.budget?.scope.bindingGeneration).toBe(2);
    expect(decision.budget?.scope.providerConversationRef).toBe("conv-1");
  });

  it("holds the budget size at the Authority's cap until §10-3 fixes a default", () => {
    const decision = budgetForResumedConversation({
      budget: budget({ maxAttempts: 7, goSlots: { maxSlots: 9, consumedSlots: 0 } }),
      from: binding(),
      to: binding({ bindingGeneration: 2 }),
      newScope: scope({ bindingGeneration: 2 }),
      newBudgetId: "bud-2",
    });
    expect(decision.budget?.maxAttempts).toBe(7);
    expect(decision.budget?.goSlots.maxSlots).toBe(9);
  });
});
