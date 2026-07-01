import type { AdapterHealth, AdapterKind, AdapterStatus, HubHealth, SleepRecoveryStatus } from "./types";

export type RecoveryDisplayState = SleepRecoveryStatus["state"] | "preview";

export interface AdapterStatusSummary {
  ready: number;
  needsAction: number;
  partial: number;
  error: number;
}

export interface SleepRecoveryDisplay {
  dataState: RecoveryDisplayState;
  text: string;
  title: string;
}

export const statusLabels: Record<AdapterStatus, string> = {
  ready: "就绪",
  partial: "部分就绪",
  missing: "未安装",
  needs_action: "需要处理",
  error: "异常"
};

export const kindLabels: Record<AdapterKind, string> = {
  capture: "捕获",
  transport: "传输",
  consumer: "消费",
  workspace: "工作区"
};

export const kindOrder: AdapterKind[] = ["capture", "transport", "workspace", "consumer"];

export function adapterStatusSummary(adapters: AdapterHealth[]): AdapterStatusSummary {
  return adapters.reduce<AdapterStatusSummary>(
    (summary, adapter) => {
      if (adapter.status === "ready") {
        summary.ready += 1;
      } else if (adapter.status === "partial") {
        summary.partial += 1;
      } else if (adapter.status === "error") {
        summary.error += 1;
      } else {
        summary.needsAction += 1;
      }
      return summary;
    },
    { ready: 0, needsAction: 0, partial: 0, error: 0 }
  );
}

export function adapterStatus(health: HubHealth, kind: AdapterKind): AdapterStatus {
  const adapters = health.adapters.filter((adapter) => adapter.kind === kind);
  if (!adapters.length) return "missing";
  if (adapters.every((adapter) => adapter.status === "ready")) return "ready";
  if (adapters.some((adapter) => adapter.status === "error")) return "error";
  if (adapters.some((adapter) => adapter.status === "needs_action" || adapter.status === "missing")) return "needs_action";
  return "partial";
}

export function chooseNextAction(adapters: AdapterHealth[]): AdapterHealth | undefined {
  return (
    adapters.find((adapter) => adapter.status === "error") ??
    adapters.find((adapter) => adapter.status === "missing" || adapter.status === "needs_action") ??
    adapters.find((adapter) => adapter.status === "partial")
  );
}

export function sleepRecoveryDisplay(status: SleepRecoveryStatus, isRuntime: boolean): SleepRecoveryDisplay {
  if (!isRuntime && status.last_reason === "browser preview") {
    return {
      dataState: "preview",
      text: "睡眠恢复：预览模式",
      title: "浏览器预览不会接收 macOS 休眠/唤醒事件；打包后的 NOOS Hub 会启用恢复流程。"
    };
  }

  const stateText: Record<SleepRecoveryStatus["state"], string> = {
    running: "睡眠恢复：就绪",
    healthy: "睡眠恢复：正常",
    suspended: "睡眠恢复：已休眠",
    resumed: "睡眠恢复：正在恢复",
    recovering: "睡眠恢复：正在恢复",
    degraded: "睡眠恢复：降级",
    relaunching: "睡眠恢复：建议重启"
  };

  return {
    dataState: status.state,
    text: stateText[status.state],
    title: status.message
  };
}

