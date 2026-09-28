/**
 * Pairing-panel event binding (#128), extracted for testability.
 *
 * The bug this replaced: per-button listeners were destroyed by every
 * `loadPairingPanel()` — it rebuilds `#pairing-panel`'s innerHTML — and never
 * rebound, so after ANY action all pairing buttons went dead until the next
 * section navigation. The Human got stuck mid-pairing exactly there (issue
 * #128): code expires → wants a new one → dead button.
 *
 * Event delegation: ONE listener lives on the persistent `#pairing-panel`
 * container and dispatches through `closest()`. The container survives the
 * innerHTML rebuilds (only section navigation replaces it, and that re-binds
 * through the normal render path), so one bind outlives every panel refresh.
 * The `data-pairing-bound` flag guards against a double bind if the section
 * is ever re-rendered without replacing the container.
 */

export interface PairingPanelDeps {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  loadPairingPanel(): Promise<void>;
  confirm(message: string): boolean;
  showToast(message: string, kind: "success" | "error" | "info"): void;
}

export function bindPairingPanelEvents(root: ParentNode, deps: PairingPanelDeps): void {
  const panel = root.querySelector("#pairing-panel");
  if (!panel || (panel as HTMLElement).dataset?.pairingBound === "true") return;
  (panel as HTMLElement).dataset.pairingBound = "true";
  panel.addEventListener("click", async (event: Event) => {
    const target = event.target as HTMLElement | null;
    const actionButton = target?.closest<HTMLButtonElement>("[data-pairing]");
    const revokeButton = target?.closest<HTMLButtonElement>("[data-pairing-revoke]");
    if (!actionButton && !revokeButton) return;
    event.stopPropagation();
    try {
      if (revokeButton && !actionButton) {
        await deps.invoke("revoke_paired_client", { origin: revokeButton.dataset.pairingRevoke });
      } else {
        const action = actionButton!.dataset.pairing;
        if (action === "generate") {
          await deps.invoke("generate_pair_code_command");
        } else if (action === "approve") {
          await deps.invoke("approve_pending_enrollment");
        } else if (action === "reject") {
          await deps.invoke("reject_pending_enrollment");
        } else if (action === "reset") {
          if (!deps.confirm("Reset all pairing? Every paired browser will be disconnected and must re-enter a new code.")) {
            return;
          }
          await deps.invoke("reset_pairing");
        } else if (action === "add-dev") {
          const input = panel.querySelector<HTMLInputElement>("[data-pairing-dev-input]");
          const origin = input?.value.trim() ?? "";
          if (origin === "") return;
          await deps.invoke("enroll_dev_origin", { origin });
          if (input) input.value = "";
        }
      }
    } catch (error) {
      deps.showToast(`Pairing: ${String(error)}`, "error");
    }
    await deps.loadPairingPanel();
  });
}
