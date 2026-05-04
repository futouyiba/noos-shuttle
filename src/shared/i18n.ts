export type ShuttleLocale = "en" | "zh";

export interface ShuttleCopy {
  localeName: string;
  ready: string;
  close: string;
  draftHandoff: string;
  collectHandoff: string;
  copy: string;
  download: string;
  settings: string;
  language: string;
  noCapturedHandoff: string;
  detectedHandoffs: string;
  warnings: string;
  untitledThread: string;
  githubPlaceholder: string;
  promptInserted: string;
  promptSent: string;
  sendNotFound: string;
  inputNotFound: string;
  noThreadDetected: string;
  chooseDetected: (count: number) => string;
  captured: string;
  capturedWithWarnings: string;
  captureBeforeDelivery: string;
  copyFinished: string;
  downloadFinished: string;
  githubUnavailable: string;
}

export const DEFAULT_LOCALE: ShuttleLocale = "zh";

export const COPY: Record<ShuttleLocale, ShuttleCopy> = {
  en: {
    localeName: "English",
    ready: "Ready to package this conversation.",
    close: "Close",
    draftHandoff: "Draft Handoff",
    collectHandoff: "Collect Handoff",
    copy: "Copy",
    download: "Download",
    settings: "Settings",
    language: "Language",
    noCapturedHandoff: "No captured handoff yet.",
    detectedHandoffs: "Detected Handoffs",
    warnings: "Warnings",
    untitledThread: "Untitled NOOS Thread",
    githubPlaceholder: "Placeholder adapter",
    promptInserted: "Prompt inserted.",
    promptSent: "Prompt inserted and sent.",
    sendNotFound: "Prompt inserted, but the send button was not found.",
    inputNotFound: "Chat input box not found. The page layout may have changed.",
    noThreadDetected: "No NOOS Thread detected. Try Draft Handoff first.",
    chooseDetected: (count) => `Detected ${count} handoffs. Choose one to deliver.`,
    captured: "Handoff collected.",
    capturedWithWarnings: "Collected with validation warnings.",
    captureBeforeDelivery: "Collect a NOOS Handoff before delivery.",
    copyFinished: "Copy finished.",
    downloadFinished: "Download finished.",
    githubUnavailable: "GitHub save unavailable."
  },
  zh: {
    localeName: "中文",
    ready: "可以把这段对话打包成交接稿。",
    close: "关闭",
    draftHandoff: "生成交接稿",
    collectHandoff: "收取交接稿",
    copy: "复制",
    download: "下载",
    settings: "设置",
    language: "语言",
    noCapturedHandoff: "还没有收取交接稿。",
    detectedHandoffs: "检测到的交接稿",
    warnings: "校验提醒",
    untitledThread: "未命名 NOOS 交接稿",
    githubPlaceholder: "GitHub 适配器占位",
    promptInserted: "提示词已写入。",
    promptSent: "提示词已写入并发送。",
    sendNotFound: "提示词已写入，但没有找到发送按钮。",
    inputNotFound: "没有找到 ChatGPT 输入框。页面结构可能已经变化。",
    noThreadDetected: "没有检测到 NOOS 交接稿。可以先生成交接稿。",
    chooseDetected: (count) => `检测到 ${count} 份交接稿。请选择要交付的一份。`,
    captured: "交接稿已收取。",
    capturedWithWarnings: "已收取，但存在校验提醒。",
    captureBeforeDelivery: "请先收取 NOOS 交接稿，再进行交付。",
    copyFinished: "复制完成。",
    downloadFinished: "下载完成。",
    githubUnavailable: "GitHub 保存暂不可用。"
  }
};

export function detectLocale(language = navigator.language): ShuttleLocale {
  return language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function getStoredLocale(): ShuttleLocale {
  const stored = window.localStorage.getItem("noos-shuttle-locale");
  return stored === "en" || stored === "zh" ? stored : detectLocale();
}

export function storeLocale(locale: ShuttleLocale): void {
  window.localStorage.setItem("noos-shuttle-locale", locale);
}
