export interface ContentActionHandlers {
  run: (action: string, sourceButton: HTMLButtonElement) => void;
  refresh: () => void;
  checkUpdate: () => void;
}

/**
 * Single binder for every action hook that can appear inside #content
 * (data-run actions, state refresh, update checks).
 *
 * Both the initial section render and the async config redraw replace
 * #content.innerHTML, which drops all listeners — every redraw path must go
 * through this binder or buttons (e.g. System Refresh) go dead.
 */
export function bindContentActions(root: ParentNode, handlers: ContentActionHandlers): void {
  root.querySelectorAll<HTMLButtonElement>("[data-run]").forEach((button) => {
    button.addEventListener("click", () => {
      handlers.run(button.dataset.run ?? "", button);
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-action="refresh"]').forEach((button) => {
    button.addEventListener("click", () => {
      handlers.refresh();
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-action="check-update"]').forEach((button) => {
    button.addEventListener("click", () => {
      handlers.checkUpdate();
    });
  });
}
