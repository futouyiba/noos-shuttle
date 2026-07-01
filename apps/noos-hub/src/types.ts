export type AdapterStatus = "ready" | "partial" | "missing" | "needs_action" | "error";
export type AdapterKind = "capture" | "transport" | "consumer" | "workspace";
export type SleepRecoveryState =
  | "running"
  | "suspended"
  | "resumed"
  | "recovering"
  | "healthy"
  | "degraded"
  | "relaunching";
export type UpdateCheckMode = "manual" | "silent";
export type UpdateStatus = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "restarting" | "error";

export interface AdapterCheck {
  label: string;
  status: AdapterStatus;
  detail?: string;
}

export interface AdapterAction {
  id: string;
  label: string;
  requires_user_action?: boolean;
}

export interface AdapterHealth {
  id: string;
  name: string;
  kind: AdapterKind;
  status: AdapterStatus;
  summary: string;
  checks: AdapterCheck[];
  actions: AdapterAction[];
}

export interface HubHealth {
  repo_root: string;
  noos_home: string;
  local_write: LocalWriteSummary;
  vault_stats: VaultStats;
  recent_files: RecentVaultFiles;
  adapters: AdapterHealth[];
}

export interface SleepRecoveryStatus {
  state: SleepRecoveryState;
  last_reason: string;
  last_resume_epoch?: number;
  last_gap_secs?: number;
  attempts: number;
  local_write_healthy: boolean;
  relaunch_recommended: boolean;
  message: string;
}

export interface LocalWriteSummary {
  endpoint: string;
  paired: boolean;
}

export interface VaultStats {
  handoffs_active: number;
  crystals_active: number;
  browser_handoffs: number;
  browser_crystals: number;
}

export interface RecentVaultFiles {
  handoffs: VaultFileSummary[];
  crystals: VaultFileSummary[];
}

export interface VaultFileSummary {
  name: string;
  path: string;
  modified_epoch: number;
  title?: string;
  key?: string;
  source_url?: string;
}
