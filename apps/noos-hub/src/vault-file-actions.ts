export type VaultFileAction = "open-vault-file" | "project-runtime";

export interface VaultFileActionSource {
  path: string;
}

export interface VaultFileActionGroup {
  id: string;
  files: VaultFileActionSource[];
}

const vaultFileActions = new Set<VaultFileAction>(["open-vault-file", "project-runtime"]);

export function setVaultFileActionDataRuns(root: ParentNode, groups: VaultFileActionGroup[]): void {
  const filesByGroup = new Map(groups.map((group) => [group.id, group.files]));

  root.querySelectorAll<HTMLButtonElement>("[data-vault-file-action]").forEach((button) => {
    const groupId = button.dataset.vaultGroup ?? "";
    const fileIndex = Number(button.dataset.vaultIndex);
    const action = button.dataset.vaultFileAction;
    const file = Number.isInteger(fileIndex) ? filesByGroup.get(groupId)?.[fileIndex] : undefined;

    if (!isVaultFileAction(action) || !file) {
      button.disabled = true;
      button.removeAttribute("data-run");
      return;
    }

    button.dataset.run = vaultFileRunCommand(action, file.path);
  });
}

export function vaultFileRunCommand(action: VaultFileAction, path: string): string {
  return `${action}:${path}`;
}

function isVaultFileAction(value: string | undefined): value is VaultFileAction {
  return Boolean(value && vaultFileActions.has(value as VaultFileAction));
}
