export type ShuttleLocale = "en" | "zh";

export interface ShuttleCopy {
  localeName: string;
  ready: string;
  close: string;
  ok: string;
  generateAndCollect: string;
  draftHandoff: string;
  collectHandoff: string;
  cancel: string;
  copy: string;
  download: string;
  afterCollect: string;
  deliverNone: string;
  deliverCopy: string;
  deliverDownload: string;
  deliverGithub: string;
  settings: string;
  language: string;
  noCapturedHandoff: string;
  detectedHandoffs: string;
  chooseHandoffTitle: string;
  chooseHandoffIntro: string;
  deliverySuccessTitle: string;
  validationWarningTitle: string;
  reviewBeforeDelivery: string;
  continueCopy: string;
  continueDownload: string;
  continueGithub: string;
  warnings: string;
  untitledThread: string;
  githubPlaceholder: string;
  promptInserted: string;
  promptSent: string;
  sendNotFound: string;
  waitingForHandoff: string;
  waitingTimedOut: string;
  waitCancelled: string;
  conversationChanged: string;
  inputNotFound: string;
  noThreadDetected: string;
  chooseDetected: (count: number) => string;
  captured: string;
  capturedWithWarnings: string;
  autoDeliverySkipped: string;
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
    ok: "OK",
    generateAndCollect: "Generate & Collect",
    draftHandoff: "Draft Handoff",
    collectHandoff: "Collect Handoff",
    cancel: "Cancel",
    copy: "Copy",
    download: "Download",
    afterCollect: "After collection",
    deliverNone: "Keep in panel",
    deliverCopy: "Copy",
    deliverDownload: "Download",
    deliverGithub: "GitHub",
    settings: "Settings",
    language: "Language",
    noCapturedHandoff: "No captured handoff yet.",
    detectedHandoffs: "Detected Handoffs",
    chooseHandoffTitle: "Choose a handoff",
    chooseHandoffIntro: "Several NOOS handoffs were found. Pick the one to deliver.",
    deliverySuccessTitle: "Handoff delivered",
    validationWarningTitle: "Review validation warnings",
    reviewBeforeDelivery: "Automatic delivery was paused. Review the warnings before sending this handoff downstream.",
    continueCopy: "Copy anyway",
    continueDownload: "Download anyway",
    continueGithub: "Send to GitHub anyway",
    warnings: "Warnings",
    untitledThread: "Untitled NOOS Thread",
    githubPlaceholder: "Placeholder adapter",
    promptInserted: "Prompt inserted.",
    promptSent: "Prompt inserted and sent.",
    sendNotFound: "Prompt inserted, but the send button was not found.",
    waitingForHandoff: "Waiting for the handoff to finish...",
    waitingTimedOut: "Timed out. You can collect the handoff manually.",
    waitCancelled: "Automatic collection cancelled.",
    conversationChanged: "Conversation changed. Shuttle state refreshed.",
    inputNotFound: "Chat input box not found. The page layout may have changed.",
    noThreadDetected: "No NOOS Thread detected. Try Draft Handoff first.",
    chooseDetected: (count) => `Detected ${count} handoffs. Choose one to deliver.`,
    captured: "Handoff collected.",
    capturedWithWarnings: "Collected with validation warnings.",
    autoDeliverySkipped: "Collected with warnings. Review before delivery.",
    captureBeforeDelivery: "Collect a NOOS Handoff before delivery.",
    copyFinished: "Copy finished.",
    downloadFinished: "Download finished.",
    githubUnavailable: "GitHub save unavailable."
  },
  zh: {
    localeName: "中文",
    ready: "可以把这段对话打包成交接稿。",
    close: "关闭",
    ok: "知道了",
    generateAndCollect: "生成并收取",
    draftHandoff: "生成交接稿",
    collectHandoff: "收取交接稿",
    cancel: "取消",
    copy: "复制",
    download: "下载",
    afterCollect: "收取后",
    deliverNone: "留在面板",
    deliverCopy: "复制",
    deliverDownload: "下载",
    deliverGithub: "GitHub",
    settings: "设置",
    language: "语言",
    noCapturedHandoff: "还没有收取交接稿。",
    detectedHandoffs: "检测到的交接稿",
    chooseHandoffTitle: "选择交接稿",
    chooseHandoffIntro: "检测到多份 NOOS 交接稿。请选择要交付的一份。",
    deliverySuccessTitle: "交接稿已交付",
    validationWarningTitle: "请确认校验提醒",
    reviewBeforeDelivery: "已暂停自动交付。请先确认这些问题，再决定是否发送到下游。",
    continueCopy: "仍然复制",
    continueDownload: "仍然下载",
    continueGithub: "仍然发送 GitHub",
    warnings: "校验提醒",
    untitledThread: "未命名 NOOS 交接稿",
    githubPlaceholder: "GitHub 适配器占位",
    promptInserted: "提示词已写入。",
    promptSent: "提示词已写入并发送。",
    sendNotFound: "提示词已写入，但没有找到发送按钮。",
    waitingForHandoff: "正在等待交接稿生成...",
    waitingTimedOut: "等待超时，可以手动收取交接稿。",
    waitCancelled: "已取消自动收取。",
    conversationChanged: "已切换会话，插件状态已刷新。",
    inputNotFound: "没有找到 ChatGPT 输入框。页面结构可能已经变化。",
    noThreadDetected: "没有检测到 NOOS 交接稿。可以先生成交接稿。",
    chooseDetected: (count) => `检测到 ${count} 份交接稿。请选择要交付的一份。`,
    captured: "交接稿已收取。",
    capturedWithWarnings: "已收取，但存在校验提醒。",
    autoDeliverySkipped: "已收取，但存在校验提醒。请确认后再交付。",
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
