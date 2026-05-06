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
  autoAfterCollect: string;
  autoCopy: string;
  autoDownload: string;
  autoSave: string;
  copyText: string;
  downloadFile: string;
  saveToVault: string;
  settings: string;
  language: string;
  noCapturedHandoff: string;
  detectedHandoffs: string;
  chooseHandoffTitle: string;
  chooseHandoffIntro: string;
  deliverySuccessTitle: string;
  deliveryIssueTitle: string;
  validationWarningTitle: string;
  reviewBeforeDelivery: string;
  continueCopy: string;
  continueDownload: string;
  continueSave: string;
  warnings: string;
  untitledThread: string;
  vaultAdapterNote: string;
  promptInserted: string;
  promptSent: string;
  sendNotFound: string;
  generationSubmitted: string;
  waitingForGenerationStart: string;
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
  vaultFinished: string;
  vaultUnavailable: string;
}

export const DEFAULT_LOCALE: ShuttleLocale = "zh";

export const COPY: Record<ShuttleLocale, ShuttleCopy> = {
  en: {
    localeName: "English",
    ready: "Ready to package this conversation.",
    close: "Close",
    ok: "OK",
    generateAndCollect: "Generate & Collect",
    draftHandoff: "Generate Only",
    collectHandoff: "Collect Only",
    cancel: "Cancel",
    autoAfterCollect: "Auto after collect",
    autoCopy: "Auto Copy",
    autoDownload: "Auto Download",
    autoSave: "Auto Save",
    copyText: "Copy Text",
    downloadFile: "Download",
    saveToVault: "Save 2 Vault",
    settings: "Settings",
    language: "Language",
    noCapturedHandoff: "No captured handoff yet.",
    detectedHandoffs: "Detected Handoffs",
    chooseHandoffTitle: "Choose a handoff",
    chooseHandoffIntro: "Several NOOS handoffs were found. Pick the one to deliver.",
    deliverySuccessTitle: "Handoff delivered",
    deliveryIssueTitle: "Delivery needs attention",
    validationWarningTitle: "Review validation warnings",
    reviewBeforeDelivery: "Automatic delivery was paused. Review the warnings before sending this handoff downstream.",
    continueCopy: "Copy anyway",
    continueDownload: "Download anyway",
    continueSave: "Save anyway",
    warnings: "Warnings",
    untitledThread: "Untitled NOOS Thread",
    vaultAdapterNote: "Current vault adapter: GitHub",
    promptInserted: "Prompt inserted.",
    promptSent: "Prompt inserted and sent.",
    sendNotFound: "Prompt inserted, but the send button was not found.",
    generationSubmitted: "Prompt sent. Waiting for generation to start...",
    waitingForGenerationStart: "Waiting for the chatbot to start generating...",
    waitingForHandoff: "Generation appears complete. Collecting the handoff...",
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
    vaultFinished: "Saved to NOOS Vault.",
    vaultUnavailable: "NOOS Vault save unavailable."
  },
  zh: {
    localeName: "中文",
    ready: "可以把这段对话打包成交接稿。",
    close: "关闭",
    ok: "知道了",
    generateAndCollect: "生成并收取",
    draftHandoff: "单独生成",
    collectHandoff: "单独收取",
    cancel: "取消",
    autoAfterCollect: "拉取后自动",
    autoCopy: "自动复制",
    autoDownload: "自动下载",
    autoSave: "自动入库",
    copyText: "复制文本",
    downloadFile: "下载文件",
    saveToVault: "存入库",
    settings: "设置",
    language: "语言",
    noCapturedHandoff: "还没有收取交接稿。",
    detectedHandoffs: "检测到的交接稿",
    chooseHandoffTitle: "选择交接稿",
    chooseHandoffIntro: "检测到多份 NOOS 交接稿。请选择要交付的一份。",
    deliverySuccessTitle: "交接稿已交付",
    deliveryIssueTitle: "交付需要处理",
    validationWarningTitle: "请确认校验提醒",
    reviewBeforeDelivery: "已暂停自动交付。请先确认这些问题，再决定是否发送到下游。",
    continueCopy: "仍然复制",
    continueDownload: "仍然下载",
    continueSave: "仍然入库",
    warnings: "校验提醒",
    untitledThread: "未命名 NOOS 交接稿",
    vaultAdapterNote: "当前文件库适配：GitHub",
    promptInserted: "提示词已写入。",
    promptSent: "提示词已写入并发送。",
    sendNotFound: "提示词已写入，但没有找到发送按钮。",
    generationSubmitted: "提示词已发送，正在等待生成开始...",
    waitingForGenerationStart: "正在等待 Chatbot 开始生成...",
    waitingForHandoff: "生成看起来已完成，正在收取交接稿...",
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
    vaultFinished: "已存入 NOOS 文件库。",
    vaultUnavailable: "NOOS 文件库保存暂不可用。"
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
