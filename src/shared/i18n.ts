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
  bcrSectionTitle: string;
  bcrAssistedNote: string;
  bcrAutoBadge: string;
  bcrAutoNote: string;
  bcrAutoHint: string;
  bcrPhaseEvaluating: string;
  bcrSettingsTitle: string;
  bcrSettingsKey: string;
  bcrSettingsModel: string;
  bcrSettingsSaved: string;
  bcrSyncFromHub: string;
  bcrSynced: string;
  bcrHubNotConfigured: string;
  bcrSyncFailed: string;
  bcrLockedReason: string;
  bcrRunningLabel: string;
  bcrPhaseReady: string;
  bcrPhaseDispatching: string;
  bcrPhaseGenerating: string;
  bcrPhaseStabilizing: string;
  bcrPhaseAwaiting: string;
  bcrPhaseEnded: string;
  bcrContinuePrompt: string;
  bcrContinue: string;
  bcrStop: string;
  bcrSendGo: string;
  bcrEndedLabel: string;
  bcrReason: string;
  bcrStopReasonBudgetExhausted: string;
  bcrStopReasonWaitHuman: string;
  bcrStopReasonWaitReview: string;
  bcrStopReasonWaitEvidence: string;
  bcrStopReasonWaitExternal: string;
  bcrStopReasonGoalSatisfied: string;
  bcrStopReasonOptionalScopeExtension: string;
  bcrStopReasonScopeDrift: string;
  bcrStopReasonStalled: string;
  bcrStopReasonAssessmentUncertain: string;
  bcrStopReasonConfidenceTooLow: string;
  bcrStopReasonFocusNotAdvancing: string;
  bcrStopReasonExcerptUnavailable: string;
  bcrStopReasonUserCancelled: string;
  bcrStopReasonUserIntervention: string;
  bcrStopReasonAuthorityChanged: string;
  bcrStopReasonConversationRebaseRequired: string;
  bcrStopReasonSubmissionUncertain: string;
  bcrStopReasonCarrierFailure: string;
  bcrStopReasonEvaluatorUnavailable: string;
  bcrGoalMayContinue: string;
  bcrCarrierNotReady: string;
  bcrCarrierGenerating: string;
  bcrCarrierStabilizing: string;
  bcrStartFailed: string;
  bcrRunActive: string;
  bcrDebugRun: string;
  bcrDebugTurn: string;
  outboxSectionTitle: string;
  hubPairingTitle: string;
  hubPairingPlaceholder: string;
  hubPairingSubmit: string;
  hubPairingPaired: string;
  hubPairingNotPaired: string;
  hubPairingSuccess: string;
  hubPairingFailed: string;
  outboxPlaceholder: string;
  outboxEnqueue: string;
  outboxPaused: string;
  outboxResume: string;
  outboxPause: string;
  outboxEdit: string;
  outboxSaveEdit: string;
  outboxCancel: string;
  outboxEmpty: string;
  outboxStateQueued: string;
  outboxStateWaiting: string;
  outboxStateDispatching: string;
  outboxStateDelivered: string;
  outboxStateUncertain: string;
  outboxStateBlocked: string;
  outboxEditLocked: string;
  outboxUncertainItemNote: string;
  outboxWaitConversationAbsent: string;
  outboxWaitCarrierNotReady: string;
  outboxWaitComposerNotEmpty: string;
  outboxWaitSubmissionInFlight: string;
  outboxWaitLeaseNotHeld: string;
  outboxWaitAttemptFailed: string;
  outboxUncertainNote: string;
  outboxRewriteHint: string;
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
  feishuExportFolderMdAndOrganize: string;
  feishuExportFolderMd: string;
  feishuOrganizeWiki: string;
  feishuLibraryCategory: string;
  feishuCategoryInput: string;
  feishuCategoryUnset: string;
  feishuChangeCategory: string;
  feishuCategoryRequired: string;
  feishuCategoryDialogTitle: string;
  feishuCategoryDialogHint: string;
  feishuRecentCategories: string;
  feishuUseCategory: string;
  feishuCategoryChanged: (category: string) => string;
  feishuExportSuccessTitle: string;
  feishuExportSuccessMessage: (location: string, organized: boolean) => string;
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
  feishuPublishSuccessTitle: string;
  feishuPublishSuccessMessage: (status: string, documentUrl?: string) => string;
  feishuOpenFeishuDocument: string;
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
    bcrSectionTitle: "Bounded run",
    bcrAssistedNote: "assisted: each continuation asks you",
    bcrAutoBadge: "AUTO ×5",
    bcrAutoNote: "auto ×5: isolated evaluator gates each round",
    bcrAutoHint: "AUTO: the evaluator continues rounds when the step is in progress, in scope, advancing and unblocked, at HIGH or MEDIUM confidence; any uncertain reading, or LOW confidence, stops the run. Rounds 4+ re-anchor to the assistant's own stated direction.",
    bcrPhaseEvaluating: "Evaluating",
    bcrSettingsTitle: "BCR auto evaluator (experimental)",
    bcrSettingsKey: "DeepSeek API Key",
    bcrSettingsModel: "Model",
    bcrSettingsSaved: "BCR evaluator config saved.",
    bcrSyncFromHub: "Sync from NOOS Hub",
    bcrSynced: "Evaluator config synced from NOOS Hub",
    bcrHubNotConfigured: "NOOS Hub has no evaluator config; set it in the Hub settings page first.",
    bcrSyncFailed: "Could not reach NOOS Hub for evaluator sync.",
    bcrLockedReason: "Budget = max automatic rounds. Every round still passes the evaluator gate; Stop works at any time.",
    bcrRunningLabel: "Running",
    bcrPhaseReady: "Ready",
    bcrPhaseDispatching: "Dispatching go",
    bcrPhaseGenerating: "Assistant generating",
    bcrPhaseStabilizing: "Stabilizing",
    bcrPhaseAwaiting: "Waiting for your decision",
    bcrPhaseEnded: "Stopped",
    bcrContinuePrompt: "Continue this run?",
    bcrContinue: "Continue",
    bcrStop: "Stop",
    bcrSendGo: "Send go",
    bcrEndedLabel: "Run ended",
    bcrReason: "Reason",
    bcrStopReasonBudgetExhausted: "Round budget used up",
    bcrStopReasonWaitHuman: "Waiting for a human decision",
    bcrStopReasonWaitReview: "Waiting for review",
    bcrStopReasonWaitEvidence: "Waiting for evidence",
    bcrStopReasonWaitExternal: "Waiting on an external result",
    bcrStopReasonGoalSatisfied: "Goal satisfied",
    bcrStopReasonOptionalScopeExtension: "An optional scope extension was offered",
    bcrStopReasonScopeDrift: "Scope drift",
    bcrStopReasonStalled: "Progress suspected stalled",
    bcrStopReasonAssessmentUncertain: "The evaluator reported uncertainty instead of a verdict",
    bcrStopReasonConfidenceTooLow: "Evaluator confidence below the level the gate accepts",
    bcrStopReasonFocusNotAdvancing: "The current focus is not advancing",
    bcrStopReasonExcerptUnavailable: "No usable assistant turn text; the round was not evaluated",
    bcrStopReasonUserCancelled: "Stopped by you",
    bcrStopReasonUserIntervention: "You sent a message; the run stopped",
    bcrStopReasonAuthorityChanged: "The execution authority changed",
    bcrStopReasonConversationRebaseRequired: "The conversation changed; re-anchoring required",
    bcrStopReasonSubmissionUncertain: "The submission outcome is uncertain",
    bcrStopReasonCarrierFailure: "The carrier failed",
    bcrStopReasonEvaluatorUnavailable: "The evaluator was unavailable",
    bcrGoalMayContinue: "Goal may still be in progress.",
    bcrCarrierNotReady: "Carrier not READY; cannot start the run.",
    bcrCarrierGenerating: "The provider is still generating. Try again once this turn finishes.",
    bcrCarrierStabilizing: "The carrier is still settling. Try again in a moment.",
    bcrStartFailed: "Run request rejected",
    bcrRunActive: "A bounded run is active; stop it before manual GO.",
    bcrDebugRun: "run",
    bcrDebugTurn: "last turn",
    outboxSectionTitle: "Message queue",
    hubPairingTitle: "Hub pairing",
    hubPairingPlaceholder: "8-digit code from NOOS Hub",
    hubPairingSubmit: "Pair",
    hubPairingPaired: "Paired with NOOS Hub.",
    hubPairingNotPaired: "Not paired — generate a code in NOOS Hub.",
    hubPairingSuccess: "Paired with NOOS Hub.",
    hubPairingFailed: "Pairing failed",
    outboxPlaceholder: "Queue a message to send once the conversation is idle",
    outboxEnqueue: "Add to queue",
    outboxPaused: "Queue paused",
    outboxResume: "Resume",
    outboxPause: "Pause",
    outboxEdit: "Edit",
    outboxSaveEdit: "Save",
    outboxCancel: "Cancel",
    outboxEmpty: "Nothing queued.",
    outboxStateQueued: "queued",
    outboxStateWaiting: "waiting",
    outboxStateDispatching: "sending…",
    outboxStateDelivered: "sent",
    outboxStateUncertain: "unresolved",
    outboxStateBlocked: "review needed",
    outboxEditLocked: "Already sending; cancel instead of editing.",
    outboxUncertainItemNote: "Outcome unresolved; cancelling releases the queue.",
    outboxWaitConversationAbsent: "waiting for this conversation",
    outboxWaitCarrierNotReady: "waiting for the conversation to settle",
    outboxWaitComposerNotEmpty: "waiting for an empty input box",
    outboxWaitSubmissionInFlight: "waiting for the current send to finish",
    outboxWaitLeaseNotHeld: "waiting for the authorized tab",
    outboxWaitAttemptFailed: "not delivered; edit or cancel to continue",
    outboxUncertainNote: "Unresolved: the queue is suspended. The delivery is not retried automatically.",
    outboxRewriteHint: "Cancel the unresolved item to release the queue.",
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
    browseVaultObjectsHint: "Select Handoffs, Crystals, Results, or Library Sources.",
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
    feishuExportMdAndOrganize: "Export & Organize Wiki",
    feishuExportMd: "Export to Library",
    feishuExportFolderMdAndOrganize: "Export Folder & Organize Wiki",
    feishuExportFolderMd: "Export Current Folder",
    feishuOrganizeWiki: "Organize Wiki",
    feishuLibraryCategory: "Library category",
    feishuCategoryInput: "Category path",
    feishuCategoryUnset: "Choose a category",
    feishuChangeCategory: "Change Directory",
    feishuCategoryRequired: "Choose a document library category first.",
    feishuCategoryDialogTitle: "Change Library Directory",
    feishuCategoryDialogHint: "Use a relative category path inside the document library.",
    feishuRecentCategories: "Recent directories",
    feishuUseCategory: "Use Directory",
    feishuCategoryChanged: (category) => `Document library category: ${category}`,
    feishuExportSuccessTitle: "Export Complete",
    feishuExportSuccessMessage: (location, organized) =>
      `Written to the document library: ${location}.${organized ? " Wiki organization was also queued." : ""}`,
    feishuOpenMarkdownFolder: "Open Library Directory",
    feishuOpenWikiFolder: "Open Wiki Project",
    feishuMarkdownHint: "Export writes a Feishu package into the document library and refreshes progressive-reading indexes. Organize Wiki is explicit.",
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
    feishuPublishSuccessTitle: "Import Complete",
    feishuPublishSuccessMessage: (status, documentUrl) =>
      `Written to Feishu. ${status}${documentUrl ? ` Document: ${documentUrl}` : ""}`,
    feishuOpenFeishuDocument: "Open Feishu Document",
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
    bcrSectionTitle: "有界连续运行",
    bcrAssistedNote: "assisted 模式：每轮继续都需要你确认",
    bcrAutoBadge: "AUTO ×5",
    bcrAutoNote: "auto ×5：隔离评估器逐轮把关",
    bcrAutoHint: "AUTO：评估器在「进行中、范围内、持续推进、无依赖」且置信为 HIGH 或 MEDIUM 时继续；任何一项判不准，或置信为 LOW，即停。第 4 轮起按 assistant 自述方向重新锚定。",
    bcrPhaseEvaluating: "评估中",
    bcrSettingsTitle: "BCR 自动评估（实验）",
    bcrSettingsKey: "DeepSeek API Key",
    bcrSettingsModel: "模型",
    bcrSettingsSaved: "BCR 评估器配置已保存。",
    bcrSyncFromHub: "从 NOOS Hub 同步",
    bcrSynced: "已从 NOOS Hub 同步评估器配置",
    bcrHubNotConfigured: "NOOS Hub 侧尚未配置评估器，请先在 Hub 设置页填写。",
    bcrSyncFailed: "无法连接 NOOS Hub 进行评估器同步。",
    bcrLockedReason: "预算即最多自动轮数；每轮仍过评估器门，随时可停止。",
    bcrRunningLabel: "运行中",
    bcrPhaseReady: "就绪",
    bcrPhaseDispatching: "发送 go",
    bcrPhaseGenerating: "Assistant 生成中",
    bcrPhaseStabilizing: "稳定中",
    bcrPhaseAwaiting: "等待你的决定",
    bcrPhaseEnded: "已停止",
    bcrContinuePrompt: "继续本轮 Run？",
    bcrContinue: "继续",
    bcrStop: "停止",
    bcrSendGo: "发送 go",
    bcrEndedLabel: "Run 已结束",
    bcrReason: "原因",
    bcrStopReasonBudgetExhausted: "轮次预算已用尽",
    bcrStopReasonWaitHuman: "等待人工决定",
    bcrStopReasonWaitReview: "等待评审",
    bcrStopReasonWaitEvidence: "等待证据",
    bcrStopReasonWaitExternal: "等待外部结果",
    bcrStopReasonGoalSatisfied: "目标已达成",
    bcrStopReasonOptionalScopeExtension: "提出了可选的范围外延伸",
    bcrStopReasonScopeDrift: "范围漂移",
    bcrStopReasonStalled: "疑似停滞",
    bcrStopReasonAssessmentUncertain: "评估器自陈不确定，未给出判断",
    bcrStopReasonConfidenceTooLow: "评估器置信度低于门接受的档位",
    bcrStopReasonFocusNotAdvancing: "当前焦点未在推进",
    bcrStopReasonExcerptUnavailable: "未取到可用的 assistant 正文，本轮未评估",
    bcrStopReasonUserCancelled: "你已停止",
    bcrStopReasonUserIntervention: "你插入了消息，Run 已停止",
    bcrStopReasonAuthorityChanged: "执行授权已变更",
    bcrStopReasonConversationRebaseRequired: "会话已变更，需重新锚定",
    bcrStopReasonSubmissionUncertain: "提交结果不确定",
    bcrStopReasonCarrierFailure: "carrier 故障",
    bcrStopReasonEvaluatorUnavailable: "评估器不可用",
    bcrGoalMayContinue: "Goal 可能仍在进行中。",
    bcrCarrierNotReady: "Carrier 未就绪，无法开始 Run。",
    bcrCarrierGenerating: "provider 正在生成，请等本轮结束后再试。",
    bcrCarrierStabilizing: "carrier 正在稳定，请稍后再试。",
    bcrStartFailed: "Run 请求被拒绝",
    bcrRunActive: "有界 Run 进行中，请先停止再做手动 GO。",
    bcrDebugRun: "run",
    bcrDebugTurn: "最近轮次",
    outboxSectionTitle: "消息队列",
    hubPairingTitle: "Hub 配对",
    hubPairingPlaceholder: "Hub 上显示的 8 位配对码",
    hubPairingSubmit: "配对",
    hubPairingPaired: "已与 NOOS Hub 配对。",
    hubPairingNotPaired: "未配对——请在 NOOS Hub 生成配对码。",
    hubPairingSuccess: "已与 NOOS Hub 配对。",
    hubPairingFailed: "配对失败",
    outboxPlaceholder: "先排队，等对话空闲后再发送",
    outboxEnqueue: "加入队列",
    outboxPaused: "队列已暂停",
    outboxResume: "恢复",
    outboxPause: "暂停",
    outboxEdit: "编辑",
    outboxSaveEdit: "保存",
    outboxCancel: "取消",
    outboxEmpty: "队列为空。",
    outboxStateQueued: "待发送",
    outboxStateWaiting: "等待中",
    outboxStateDispatching: "发送中…",
    outboxStateDelivered: "已发送",
    outboxStateUncertain: "未决",
    outboxStateBlocked: "需人工处理",
    outboxEditLocked: "已在发送中，不能编辑；如需放弃请取消。",
    outboxUncertainItemNote: "结果未决；取消该条即可解除挂起。",
    outboxWaitConversationAbsent: "等待该对话打开",
    outboxWaitCarrierNotReady: "等待对话稳定",
    outboxWaitComposerNotEmpty: "等待输入框清空",
    outboxWaitSubmissionInFlight: "等待当前发送结束",
    outboxWaitLeaseNotHeld: "等待已授权的标签页",
    outboxWaitAttemptFailed: "未送达；请编辑或取消后再继续",
    outboxUncertainNote: "未决：队列已挂起，不会自动重发。",
    outboxRewriteHint: "取消未决的那条即可解除队列阻塞。",
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
    browseVaultObjectsHint: "可选择 Handoff、Crystal、Result 或文档库源。",
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
    feishuExportMdAndOrganize: "导出并整理 Wiki",
    feishuExportMd: "导出到文档库",
    feishuExportFolderMdAndOrganize: "导出当前文件夹并整理 Wiki",
    feishuExportFolderMd: "导出当前文件夹",
    feishuOrganizeWiki: "整理 Wiki",
    feishuLibraryCategory: "文档库分类",
    feishuCategoryInput: "分类路径",
    feishuCategoryUnset: "请选择分类",
    feishuChangeCategory: "更改目录",
    feishuCategoryRequired: "请先选择一个文档库分类目录。",
    feishuCategoryDialogTitle: "更改文档库目录",
    feishuCategoryDialogHint: "填写文档库内的相对分类路径。",
    feishuRecentCategories: "最近目录",
    feishuUseCategory: "使用此目录",
    feishuCategoryChanged: (category) => `文档库分类目录：${category}`,
    feishuExportSuccessTitle: "导出完成",
    feishuExportSuccessMessage: (location, organized) =>
      `已写入文档库：${location}。${organized ? "Wiki 整理也已加入队列。" : ""}`,
    feishuOpenMarkdownFolder: "打开文档库目录",
    feishuOpenWikiFolder: "打开 Wiki 项目目录",
    feishuMarkdownHint: "导出会把飞书 package 写入文档库，并刷新渐进式读取索引；整理 Wiki 需要显式触发。",
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
    feishuPublishSuccessTitle: "导入完成",
    feishuPublishSuccessMessage: (status, documentUrl) =>
      `已写入飞书文档。${status}${documentUrl ? ` 文档：${documentUrl}` : ""}`,
    feishuOpenFeishuDocument: "打开飞书文档",
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
