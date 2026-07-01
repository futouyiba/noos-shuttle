export type ShuttleLocale = "en" | "zh";

export interface ShuttleCopy {
  localeName: string;
  ready: string;
  globalBalloonTitle: string;
  chatGptSurfaceTitle: string;
  feishuSurfaceTitle: string;
  feishuSurfaceReady: string;
  surfaceUnavailable: string;
  close: string;
  ok: string;
  generateAndCollect: string;
  draftHandoff: string;
  collectHandoff: string;
  extractCrystal: string;
  scanCrystal: string;
  downloadImages: string;
  cancel: string;
  autoAfterCollect: string;
  autoCopy: string;
  autoDownload: string;
  autoSave: string;
  importFromNoos: string;
  importFromNoosHint: string;
  exportProjectSources: string;
  projectSourcesExported: (count: number, location: string) => string;
  projectSourcesExportNeedsAttention: string;
  noProjectSourcesDetected: string;
  imagesDownloaded: (count: number, location: string) => string;
  noGeneratedImagesDetected: string;
  latestHandoffs: string;
  latestCrystals: string;
  latestResults: string;
  latestVaultObjects: string;
  browseVaultObjects: string;
  browseVaultObjectsHint: string;
  searchVaultObjects: string;
  vaultFolders: string;
  allVaultObjects: string;
  clearSelection: string;
  attachToCurrentChat: string;
  attachToProjectSources: string;
  attachToFeishuPublish: string;
  attachSelectedToTarget: (count: number, targetLabel: string) => string;
  noVaultObjects: string;
  vaultObjectAttached: (key: string) => string;
  vaultObjectAttachedToProject: (key: string) => string;
  vaultObjectDownloadedForProject: (key: string) => string;
  vaultObjectInserted: (key: string) => string;
  vaultObjectsAttached: (keys: string[]) => string;
  vaultObjectsAttachedToProject: (keys: string[]) => string;
  vaultObjectsDownloadedForProject: (keys: string[]) => string;
  vaultObjectsInserted: (keys: string[]) => string;
  captureFullTranscript: string;
  copyText: string;
  downloadFile: string;
  saveToVault: string;
  settings: string;
  language: string;
  noCapturedHandoff: string;
  detectedHandoffs: string;
  chooseHandoffTitle: string;
  chooseHandoffIntro: string;
  chooseCrystalTitle: string;
  chooseCrystalIntro: string;
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
  vaultStatusChecking: string;
  vaultStatusHub: string;
  vaultStatusNeedsRepair: string;
  vaultStatusMirror: string;
  vaultStatusRefresh: string;
  defaultWikiProject: string;
  defaultWikiProjectUnknown: string;
  feishuDocumentTitle: string;
  feishuPageLocation: string;
  feishuRootFolder: string;
  feishuCurrentFolder: string;
  feishuExportSectionTitle: string;
  feishuExportMdAndOrganize: string;
  feishuExportMd: string;
  feishuOrganizeWiki: string;
  feishuOpenMarkdownFolder: string;
  feishuOpenWikiFolder: string;
  feishuMarkdownHint: string;
  feishuPublishSectionTitle: string;
  feishuPublishSectionHint: string;
  feishuSelectMarkdown: string;
  feishuChangeMarkdown: string;
  feishuSelectedMarkdown: string;
  feishuMarkdownSelected: (key: string) => string;
  feishuPublishNewDocument: string;
  feishuPublishToRootFolder: string;
  feishuPublishToCurrentFolder: string;
  feishuOverwriteCurrentDocument: string;
  feishuOverwriteConfirmTitle: string;
  feishuOverwriteConfirmMessage: string;
  feishuPublishHint: string;
  feishuPublishNeedsSource: string;
  feishuPublishFinished: (status: string, message: string) => string;
  feishuPublishNeedsAuth: string;
  feishuPublishFailed: string;
  feishuActionFinished: (status: string, message: string) => string;
  feishuActionNeedsAuth: string;
  feishuActionFailed: string;
  extensionContextInvalid: string;
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
  noCrystalDetected: string;
  chooseDetected: (count: number) => string;
  captured: string;
  capturedWithWarnings: string;
  crystalSubmitted: string;
  waitingForCrystal: string;
  crystalCaptured: string;
  crystalCapturedWithWarnings: string;
  crystalSaved: (key: string) => string;
  crystalSavedWithoutClipboard: (key: string) => string;
  autoDeliverySkipped: string;
  captureBeforeDelivery: string;
  copyFinished: string;
  downloadFinished: string;
  vaultFinished: string;
  contextPackSaved: string;
  vaultUnavailable: string;
}

export const DEFAULT_LOCALE: ShuttleLocale = "zh";

function formatKeyList(keys: string[] | number, separator: string): string {
  if (Array.isArray(keys)) {
    return keys.join(separator);
  }
  return String(keys);
}

export const COPY: Record<ShuttleLocale, ShuttleCopy> = {
  en: {
    localeName: "English",
    ready: "Ready to package this conversation.",
    globalBalloonTitle: "NOOS",
    chatGptSurfaceTitle: "ChatGPT",
    feishuSurfaceTitle: "Feishu Doc",
    feishuSurfaceReady: "Export this Feishu document as MD, then organize it into the target Wiki when needed.",
    surfaceUnavailable: "No page-specific NOOS surface here.",
    close: "Close",
    ok: "OK",
    generateAndCollect: "Generate & Collect Handoff",
    draftHandoff: "Generate Only",
    collectHandoff: "Scan Handoff",
    extractCrystal: "Extract Crystal",
    scanCrystal: "Scan Crystal",
    downloadImages: "Download Reply Images",
    cancel: "Cancel",
    autoAfterCollect: "Auto after collect",
    autoCopy: "Auto Copy",
    autoDownload: "Auto Download",
    autoSave: "Auto Save",
    importFromNoos: "Import from NOOS",
    importFromNoosHint: "Pick a recent Vault object and attach it to this chat.",
    exportProjectSources: "Export sources to NOOS",
    projectSourcesExported: (count, location) => `Exported ${count} Project source item(s) to NOOS: ${location}`,
    projectSourcesExportNeedsAttention: "Project sources export needs attention.",
    noProjectSourcesDetected: "No visible Project source items were found. Open the Project sources list and try again.",
    imagesDownloaded: (count, location) => `Downloaded ${count} image(s) to ${location}`,
    noGeneratedImagesDetected: "No generated images were found in the selected or current reply. Select text in the target reply, or open the image set and try again.",
    latestHandoffs: "Latest Handoffs",
    latestCrystals: "Latest Crystals",
    latestResults: "Latest Results",
    latestVaultObjects: "Newest",
    browseVaultObjects: "Browse Vault",
    browseVaultObjectsHint: "Select one or more Handoffs, Crystals, or Results.",
    searchVaultObjects: "Search Vault",
    vaultFolders: "Folders",
    allVaultObjects: "All matching objects",
    clearSelection: "Clear selection",
    attachToCurrentChat: "Attach to current chat",
    attachToProjectSources: "Attach to Project sources",
    attachToFeishuPublish: "Use for Feishu publish",
    attachSelectedToTarget: (count, targetLabel) => (count > 1 ? `${targetLabel} (${count})` : targetLabel),
    noVaultObjects: "No recent NOOS Vault objects found.",
    vaultObjectAttached: (key) => `Attached NOOS object: ${key}`,
    vaultObjectAttachedToProject: (key) => `Attached NOOS object to Project sources: ${key}`,
    vaultObjectDownloadedForProject: (key) => `Project source input was not found. Downloaded NOOS object for manual upload: ${key}`,
    vaultObjectInserted: (key) => `Inserted NOOS object text: ${key}`,
    vaultObjectsAttached: (keys) => `Attached NOOS objects: ${formatKeyList(keys, ", ")}`,
    vaultObjectsAttachedToProject: (keys) => `Attached NOOS objects to Project sources: ${formatKeyList(keys, ", ")}`,
    vaultObjectsDownloadedForProject: (keys) =>
      `Project source input was not found. Downloaded NOOS objects for manual upload: ${formatKeyList(keys, ", ")}`,
    vaultObjectsInserted: (keys) => `Inserted NOOS object text: ${formatKeyList(keys, ", ")}`,
    captureFullTranscript: "Capture full conversation transcript",
    copyText: "Copy Text",
    downloadFile: "Download",
    saveToVault: "Save 2 Vault",
    settings: "Settings",
    language: "Language",
    noCapturedHandoff: "No captured handoff yet.",
    detectedHandoffs: "Detected Handoffs",
    chooseHandoffTitle: "Choose a handoff",
    chooseHandoffIntro: "Several NOOS handoffs were found. Pick the one to deliver.",
    chooseCrystalTitle: "Choose a crystal",
    chooseCrystalIntro: "Pick the crystal to save. The newest one is selected first.",
    deliverySuccessTitle: "Handoff delivered",
    deliveryIssueTitle: "Delivery needs attention",
    validationWarningTitle: "Review validation warnings",
    reviewBeforeDelivery: "Automatic delivery was paused. Review the warnings before sending this handoff downstream.",
    continueCopy: "Copy anyway",
    continueDownload: "Download anyway",
    continueSave: "Save anyway",
    warnings: "Warnings",
    untitledThread: "Untitled NOOS Thread",
    vaultAdapterNote: "Vault route",
    vaultStatusChecking: "Checking vault route...",
    vaultStatusHub: "Hub connected. Saves go to the local NOOS Vault.",
    vaultStatusNeedsRepair: "Hub is running, but the browser connection needs repair.",
    vaultStatusMirror: "Hub is not running. Saves use Browser Vault Mirror.",
    vaultStatusRefresh: "Refresh",
    defaultWikiProject: "Target Wiki",
    defaultWikiProjectUnknown: "Hub default Wiki project",
    feishuDocumentTitle: "Current document",
    feishuPageLocation: "Current location",
    feishuRootFolder: "Main folder",
    feishuCurrentFolder: "Current folder",
    feishuExportSectionTitle: "Feishu to NOOS",
    feishuExportMdAndOrganize: "Export MD & Organize Wiki",
    feishuExportMd: "Export MD Only",
    feishuOrganizeWiki: "Organize Wiki",
    feishuOpenMarkdownFolder: "Open MD Sources",
    feishuOpenWikiFolder: "Open Wiki Project",
    feishuMarkdownHint: "Export MD overwrites the stable .md source. Organize Wiki queues that source for Wiki organization.",
    feishuPublishSectionTitle: "NOOS to Feishu",
    feishuPublishSectionHint: "Choose one NOOS Markdown source and publish it as a Feishu document.",
    feishuSelectMarkdown: "Choose NOOS Markdown",
    feishuChangeMarkdown: "Change Markdown",
    feishuSelectedMarkdown: "Selected Markdown",
    feishuMarkdownSelected: (key) => `Selected NOOS Markdown: ${key}`,
    feishuPublishNewDocument: "Publish as New Document",
    feishuPublishToRootFolder: "Publish to Main Folder",
    feishuPublishToCurrentFolder: "Publish to Current Folder",
    feishuOverwriteCurrentDocument: "Overwrite Current Document",
    feishuOverwriteConfirmTitle: "Overwrite current Feishu document?",
    feishuOverwriteConfirmMessage: "This will replace the entire current Feishu document with the selected NOOS Markdown content.",
    feishuPublishHint: "Publish converts the Markdown body into Feishu document content, not an attachment.",
    feishuPublishNeedsSource: "Choose a NOOS Markdown source first.",
    feishuPublishFinished: (status, message) => `${status}: ${message}`,
    feishuPublishNeedsAuth: "Feishu authorization is required in NOOS Hub.",
    feishuPublishFailed: "Feishu publish failed.",
    feishuActionFinished: (status, message) => `${status}: ${message}`,
    feishuActionNeedsAuth: "Feishu authorization is required in NOOS Hub.",
    feishuActionFailed: "Feishu action failed.",
    extensionContextInvalid: "The extension was updated or reloaded. Refresh this page and try again.",
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
    noCrystalDetected: "No NOOS Crystal detected.",
    chooseDetected: (count) => `Detected ${count} handoffs. Choose one to deliver.`,
    captured: "Handoff collected.",
    capturedWithWarnings: "Collected with validation warnings.",
    crystalSubmitted: "Crystal prompt sent. Waiting for generation...",
    waitingForCrystal: "Generation appears complete. Collecting the crystal...",
    crystalCaptured: "Crystal collected.",
    crystalCapturedWithWarnings: "Crystal collected with validation warnings.",
    crystalSaved: (key) => `Crystal saved. Key copied: ${key}`,
    crystalSavedWithoutClipboard: (key) => `Crystal saved. Copy this key manually: ${key}`,
    autoDeliverySkipped: "Collected with warnings. Review before delivery.",
    captureBeforeDelivery: "Collect a NOOS Handoff before delivery.",
    copyFinished: "Copy finished.",
    downloadFinished: "Download finished.",
    vaultFinished: "Saved to NOOS Vault.",
    contextPackSaved: "Context Pack saved to NOOS Vault.",
    vaultUnavailable: "NOOS Vault save unavailable."
  },
  zh: {
    localeName: "中文",
    ready: "可以把这段对话打包成交接稿，或沉淀成结晶。",
    globalBalloonTitle: "NOOS",
    chatGptSurfaceTitle: "ChatGPT",
    feishuSurfaceTitle: "飞书文档",
    feishuSurfaceReady: "将当前飞书文档导出为 MD，并按需加入目标 Wiki 的整理队列。",
    surfaceUnavailable: "当前页面没有专属 NOOS 场景。",
    close: "关闭",
    ok: "知道了",
    generateAndCollect: "生成并拉取 Handoff",
    draftHandoff: "单独生成",
    collectHandoff: "扫描 Handoff",
    extractCrystal: "沉淀结晶",
    scanCrystal: "扫描结晶",
    downloadImages: "下载本条回复图",
    cancel: "取消",
    autoAfterCollect: "拉取后自动",
    autoCopy: "自动复制",
    autoDownload: "自动下载",
    autoSave: "自动入库",
    importFromNoos: "从 NOOS 导入",
    importFromNoosHint: "选择最近入库对象，优先作为 Markdown 附件投喂当前对话。",
    exportProjectSources: "导出项目源到 NOOS",
    projectSourcesExported: (count, location) => `已导出 ${count} 个 Project 源条目到 NOOS：${location}`,
    projectSourcesExportNeedsAttention: "项目源导出需要处理。",
    noProjectSourcesDetected: "没有找到可见的 Project 源条目。请先展开 Project sources 列表后再试。",
    imagesDownloaded: (count, location) => `已下载 ${count} 张图片到 ${location}`,
    noGeneratedImagesDetected: "没有在选中或当前回复里找到可下载的生成图。请先选中目标回复里的文字，或打开图片区域后再试。",
    latestHandoffs: "最近 Handoff",
    latestCrystals: "最近 Crystal",
    latestResults: "最近 Result",
    latestVaultObjects: "最新对象",
    browseVaultObjects: "浏览文件库",
    browseVaultObjectsHint: "可多选 Handoff、Crystal 或 Result。",
    searchVaultObjects: "搜索 Vault",
    vaultFolders: "文件夹",
    allVaultObjects: "匹配对象",
    clearSelection: "清空选择",
    attachToCurrentChat: "附加到当前对话",
    attachToProjectSources: "附加到 Project 源",
    attachToFeishuPublish: "用于发布到飞书",
    attachSelectedToTarget: (count, targetLabel) => (count > 1 ? `${targetLabel}（${count}）` : targetLabel),
    noVaultObjects: "没有找到最近的 NOOS Vault 对象。",
    vaultObjectAttached: (key) => `已附加 NOOS 对象：${key}`,
    vaultObjectAttachedToProject: (key) => `已附加到 Project 源：${key}`,
    vaultObjectDownloadedForProject: (key) => `没有找到 Project 源上传入口，已下载该 NOOS 对象，可手动上传：${key}`,
    vaultObjectInserted: (key) => `已写入 NOOS 对象正文：${key}`,
    vaultObjectsAttached: (keys) => `已附加 NOOS 对象：${formatKeyList(keys, "、")}`,
    vaultObjectsAttachedToProject: (keys) => `已附加到 Project 源：${formatKeyList(keys, "、")}`,
    vaultObjectsDownloadedForProject: (keys) => `没有找到 Project 源上传入口，已下载这些 NOOS 对象，可手动上传：${formatKeyList(keys, "、")}`,
    vaultObjectsInserted: (keys) => `已写入 NOOS 对象正文：${formatKeyList(keys, "、")}`,
    captureFullTranscript: "同时抓取完整对话 transcript",
    copyText: "复制文本",
    downloadFile: "下载文件",
    saveToVault: "存入库",
    settings: "设置",
    language: "语言",
    noCapturedHandoff: "还没有收取交接稿。",
    detectedHandoffs: "检测到的交接稿",
    chooseHandoffTitle: "选择交接稿",
    chooseHandoffIntro: "检测到多份 NOOS 交接稿。请选择要交付的一份。",
    chooseCrystalTitle: "选择结晶",
    chooseCrystalIntro: "请选择要保存的 NOOS 结晶。默认优先选择最新的一份。",
    deliverySuccessTitle: "交接稿已交付",
    deliveryIssueTitle: "交付需要处理",
    validationWarningTitle: "请确认校验提醒",
    reviewBeforeDelivery: "已暂停自动交付。请先确认这些问题，再决定是否发送到下游。",
    continueCopy: "仍然复制",
    continueDownload: "仍然下载",
    continueSave: "仍然入库",
    warnings: "校验提醒",
    untitledThread: "未命名 NOOS 交接稿",
    vaultAdapterNote: "入库路径",
    vaultStatusChecking: "正在检查入库路径...",
    vaultStatusHub: "Hub 已连接，保存到本机 NOOS Vault。",
    vaultStatusNeedsRepair: "Hub 正在运行，但浏览器连接需要修复。",
    vaultStatusMirror: "Hub 未运行，将保存到 Browser Vault Mirror。",
    vaultStatusRefresh: "刷新",
    defaultWikiProject: "目标 Wiki",
    defaultWikiProjectUnknown: "Hub 默认 Wiki 项目",
    feishuDocumentTitle: "当前文档",
    feishuPageLocation: "当前位置",
    feishuRootFolder: "主文件夹",
    feishuCurrentFolder: "当前文件夹",
    feishuExportSectionTitle: "飞书到 NOOS",
    feishuExportMdAndOrganize: "导出 MD 并整理 Wiki",
    feishuExportMd: "仅导出 MD",
    feishuOrganizeWiki: "整理 Wiki",
    feishuOpenMarkdownFolder: "打开 MD 源目录",
    feishuOpenWikiFolder: "打开 Wiki 项目目录",
    feishuMarkdownHint: "导出 MD 会覆盖当前飞书文档对应的稳定 .md source；整理 Wiki 会将该 source 加入整理队列。",
    feishuPublishSectionTitle: "NOOS 到飞书",
    feishuPublishSectionHint: "选择一个 NOOS Markdown 源，并发布为飞书文档正文。",
    feishuSelectMarkdown: "选择 NOOS Markdown",
    feishuChangeMarkdown: "更换 Markdown",
    feishuSelectedMarkdown: "已选 Markdown",
    feishuMarkdownSelected: (key) => `已选择 NOOS Markdown：${key}`,
    feishuPublishNewDocument: "发布为新文档",
    feishuPublishToRootFolder: "发布到主文件夹",
    feishuPublishToCurrentFolder: "发布到当前文件夹",
    feishuOverwriteCurrentDocument: "覆盖当前文档",
    feishuOverwriteConfirmTitle: "确认覆盖当前飞书文档？",
    feishuOverwriteConfirmMessage: "这会用选中的 NOOS Markdown 全文替换当前飞书文档内容。",
    feishuPublishHint: "发布会把 Markdown 正文转换成飞书文档内容，不是上传附件。",
    feishuPublishNeedsSource: "请先选择一个 NOOS Markdown 源。",
    feishuPublishFinished: (status, message) => `${status}：${message}`,
    feishuPublishNeedsAuth: "需要先在 NOOS Hub 完成飞书授权。",
    feishuPublishFailed: "飞书发布失败。",
    feishuActionFinished: (status, message) => `${status}：${message}`,
    feishuActionNeedsAuth: "需要先在 NOOS Hub 完成飞书授权。",
    feishuActionFailed: "飞书动作执行失败。",
    extensionContextInvalid: "插件已更新或上下文已失效。请刷新当前页面后再试。",
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
    noCrystalDetected: "没有检测到 NOOS 结晶。",
    chooseDetected: (count) => `检测到 ${count} 份交接稿。请选择要交付的一份。`,
    captured: "交接稿已收取。",
    capturedWithWarnings: "已收取，但存在校验提醒。",
    crystalSubmitted: "结晶提示词已发送，正在等待生成...",
    waitingForCrystal: "生成看起来已完成，正在收取结晶...",
    crystalCaptured: "结晶已收取。",
    crystalCapturedWithWarnings: "结晶已收取，但存在校验提醒。",
    crystalSaved: (key) => `结晶已保存，检索 key 已复制：${key}`,
    crystalSavedWithoutClipboard: (key) => `结晶已保存，请手动复制检索 key：${key}`,
    autoDeliverySkipped: "已收取，但存在校验提醒。请确认后再交付。",
    captureBeforeDelivery: "请先收取 NOOS 交接稿，再进行交付。",
    copyFinished: "复制完成。",
    downloadFinished: "下载完成。",
    vaultFinished: "已存入 NOOS 文件库。",
    contextPackSaved: "Context Pack 已存入 NOOS 文件库。",
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
