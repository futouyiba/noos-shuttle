/**
 * Preserve what the Human is typing across the panel's full-DOM rebuild
 * (issue #126).
 *
 * `render()` rebuilds the panel with `app.innerHTML = …`, which destroys every
 * editable control — value, focus, caret and selection included. Any render
 * that fires mid-keystroke (whatever fires it: an observation tick, a state
 * transition, a queue update) therefore eats the input, which is how the #100
 * pairing ceremony became nearly impossible to complete in a generating tab.
 *
 * This module is the mechanism `render()` calls on both sides of the rebuild:
 * snapshot before, restore after. It is deliberately dumb about *why* a render
 * happened — throttling render sources is a separate concern
 * (`observation-render-throttle.ts`); this makes every render, current or
 * future, non-destructive.
 *
 * Matching a control to its rebuilt counterpart is by stable key, never by node
 * identity: the explicit `data-*` hooks the templates already carry (pairing
 * input, outbox compose/edit boxes, the Feishu category dialog, vault search)
 * come first, then `name`/`id`, then the control's ordinal among same-tag
 * controls — the same order the template emits them in, so ordinals stay stable
 * for a given panel shape. Template-bound state (checkboxes rendered from
 * viewState, values the template itself re-serializes) restores as a no-op:
 * the snapshot was taken from the same state the template renders from.
 */

export interface EditableControlSnapshot {
  readonly key: string;
  readonly value: string;
  readonly checked: boolean;
  readonly selectionStart: number | null;
  readonly selectionEnd: number | null;
  readonly selectionDirection: "forward" | "backward" | "none" | null;
  readonly focused: boolean;
}

const KEYED_ATTRIBUTES: ReadonlyArray<{ attribute: string; prefix: string; useValue: boolean }> = [
  { attribute: "data-hub-pairing-input", prefix: "hub-pairing", useValue: false },
  { attribute: "data-outbox-input", prefix: "outbox-compose", useValue: false },
  { attribute: "data-outbox-edit-input", prefix: "outbox-edit", useValue: true },
  { attribute: "data-feishu-category-dialog-input", prefix: "feishu-category", useValue: false },
  { attribute: "data-action", prefix: "action", useValue: true }
];

function controlKey(control: Element, ordinal: number): string | undefined {
  for (const keyed of KEYED_ATTRIBUTES) {
    const value = control.getAttribute(keyed.attribute);
    if (value === null) continue;
    // `data-action` keys only the vault search input; other data-action
    // elements are buttons, which never reach here.
    if (keyed.attribute === "data-action" && value !== "vault-search") continue;
    return keyed.useValue ? `${keyed.prefix}:${value}` : keyed.prefix;
  }
  const name = control.getAttribute("name");
  if (name) return `name:${name}`;
  const id = control.getAttribute("id");
  if (id) return `id:${id}`;
  return `ordinal:${control.tagName}:${ordinal}`;
}

function editableControls(root: ParentNode): Array<HTMLInputElement | HTMLTextAreaElement> {
  return Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"));
}

function activeElementOf(node: Node): Element | null {
  const view = node.ownerDocument?.defaultView;
  const root = node.getRootNode();
  // Shadow-root aware (the panel lives in one) without referencing a global
  // constructor: the realm that owns the node knows its own ShadowRoot.
  if (view && root !== node.ownerDocument && "activeElement" in root) {
    return (root as ShadowRoot).activeElement;
  }
  return view?.document.activeElement ?? null;
}

/** Read every editable control's live state, taken immediately before a rebuild. */
export function snapshotEditableControls(root: ParentNode): EditableControlSnapshot[] {
  const active = activeElementOf(root instanceof Element ? root : document.documentElement);
  const snapshots: EditableControlSnapshot[] = [];
  const controls = editableControls(root);
  const ordinals = new Map<string, number>();
  for (const control of controls) {
    const tag = control.tagName;
    ordinals.set(tag, (ordinals.get(tag) ?? 0) + 1);
    const key = controlKey(control, ordinals.get(tag)!);
    if (!key) continue;
    snapshots.push({
      key,
      value: control.value,
      checked: control instanceof HTMLInputElement ? control.checked : false,
      selectionStart: control.selectionStart,
      selectionEnd: control.selectionEnd,
      selectionDirection: control.selectionDirection,
      focused: control === active
    });
  }
  return snapshots;
}

/** Re-apply a pre-rebuild snapshot onto the rebuilt controls with the same keys. */
export function restoreEditableControls(root: ParentNode, snapshots: ReadonlyArray<EditableControlSnapshot>): void {
  if (snapshots.length === 0) return;
  const controls = editableControls(root);
  const ordinals = new Map<string, number>();
  const byKey = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
  for (const control of controls) {
    const tag = control.tagName;
    ordinals.set(tag, (ordinals.get(tag) ?? 0) + 1);
    const key = controlKey(control, ordinals.get(tag)!);
    if (key && !byKey.has(key)) byKey.set(key, control);
  }
  for (const snapshot of snapshots) {
    const control = byKey.get(snapshot.key);
    if (!control) continue;
    if (control.value !== snapshot.value) control.value = snapshot.value;
    if (control instanceof HTMLInputElement && control.type === "checkbox") {
      control.checked = snapshot.checked;
    }
    // Value assignment collapses the selection; put the caret/selection back
    // only where the control supports ranges (guarded for e.g. number inputs).
    if (snapshot.selectionStart !== null && snapshot.selectionEnd !== null) {
      try {
        control.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd, snapshot.selectionDirection ?? "none");
      } catch {
        // Inputs without selection support keep their value; that is enough.
      }
    }
    if (snapshot.focused && activeElementOf(control) !== control) control.focus();
  }
}
