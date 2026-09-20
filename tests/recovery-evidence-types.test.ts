import { describe, expect, it } from "vitest";
import {
  CONTEXT_REBASE_ACTION,
  OBSERVATION_ONLY_ACTIONS,
  RECOVERY_ACTIONS,
  bindingChanged,
  bindingChangeReasons,
  budgetScopeMatches,
  carryAcrossBinding,
  createRecoveryBudget,
  isRecoveryAction,
  remainingGoSlots,
  remainingRecoveryAttempts,
  recoveryBudgetExhausted,
  type ProviderBinding,
  type RecoveryBudget,
  type RecoveryBudgetScope,
} from "../src/core/recovery-evidence-types";

export function binding(overrides: Partial<ProviderBinding> = {}): ProviderBinding {
  return { providerConversationRef: "conv-1", bindingGeneration: 1, headFingerprint: "head-a", ...overrides };
}

export function scope(overrides: Partial<RecoveryBudgetScope> = {}): RecoveryBudgetScope {
  return {
    logicalThreadId: "thread-1",
    providerConversationRef: "conv-1",
    bindingGeneration: 1,
    interruptedRoundRef: "round-1",
    ...overrides,
  };
}

export function budget(overrides: Partial<RecoveryBudget> = {}): RecoveryBudget {
  return { ...createRecoveryBudget({ budgetId: "bud-1", scope: scope(), maxAttempts: 3, goSlots: { maxSlots: 2 } }), ...overrides };
}

describe("action taxonomy", () => {
  it("keeps observation-only and recovery actions disjoint", () => {
    for (const action of OBSERVATION_ONLY_ACTIONS) {
      expect(isRecoveryAction(action)).toBe(false);
    }
    for (const action of RECOVERY_ACTIONS) {
      expect(isRecoveryAction(action)).toBe(true);
    }
  });

  it("covers the five actions the decisive statement names", () => {
    // refresh / Retry / resend / 继续 (+ rebase denied separately)
    expect(RECOVERY_ACTIONS).toEqual(["REFRESH", "PROVIDER_NATIVE_RETRY", "SHUTTLE_RETRY", "CONTINUE_PROVIDER_TURN"]);
  });

  it("keeps context rebase out of the recoverable set (§6.2 / §8.2)", () => {
    expect(isRecoveryAction(CONTEXT_REBASE_ACTION)).toBe(false);
  });
});

describe("binding identity", () => {
  it("treats a carrier identity change as NO binding change (§4.1)", () => {
    // Carrier identity is not part of ProviderBinding, so a carrier swap is
    // invisible to the predicate rather than a special case inside it.
    const before = binding();
    const after = binding();
    expect(bindingChanged(before, after)).toBe(false);
    expect(bindingChangeReasons(before, after)).toEqual([]);
  });

  it("detects each binding-identity field moving", () => {
    expect(bindingChanged(binding(), binding({ providerConversationRef: "conv-2" }))).toBe(true);
    expect(bindingChanged(binding(), binding({ bindingGeneration: 2 }))).toBe(true);
    expect(bindingChanged(binding(), binding({ headFingerprint: "head-b" }))).toBe(true);
    expect(bindingChangeReasons(binding(), binding({ providerConversationRef: "conv-2", headFingerprint: "head-b" }))).toEqual([
      "providerConversationRef",
      "headFingerprint",
    ]);
  });
});

describe("RecoveryBudget shape and consumption rules", () => {
  it("starts empty and attributable", () => {
    const b = budget();
    expect(b.consumedAttempts).toBe(0);
    expect(b.goSlots).toEqual({ maxSlots: 2, consumedSlots: 0 });
    expect(b.revision).toBe(0);
    expect(budgetScopeMatches(b.scope, scope())).toBe(true);
    expect(budgetScopeMatches(b.scope, scope({ interruptedRoundRef: "round-2" }))).toBe(false);
  });

  it("clamps remainders at zero rather than going negative", () => {
    expect(remainingRecoveryAttempts(budget({ consumedAttempts: 9 }))).toBe(0);
    expect(remainingGoSlots(budget({ goSlots: { maxSlots: 2, consumedSlots: 5 } }))).toBe(0);
    expect(recoveryBudgetExhausted(budget({ consumedAttempts: 3 }))).toBe(true);
    expect(recoveryBudgetExhausted(budget({ consumedAttempts: 2 }))).toBe(false);
  });

  it("never carries the remainder across a binding change (§5.3, §6)", () => {
    const b = budget({ consumedAttempts: 1 });
    // Total: no parameter combination returns true. Written as a table so a
    // reviewer can see the argument list is exhaustive.
    for (const to of [binding(), binding({ providerConversationRef: "conv-2" }), binding({ bindingGeneration: 2 }), binding({ headFingerprint: "head-b" })]) {
      for (const from of [binding(), binding({ providerConversationRef: "conv-2" })]) {
        expect(carryAcrossBinding({ budget: b, from, to })).toBe(false);
      }
    }
  });
});
