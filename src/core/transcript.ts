export type TranscriptRole = "user" | "assistant" | "tool" | "system_snapshot" | "unknown";

export interface TranscriptTurn {
  id: string;
  role: TranscriptRole;
  markdown: string;
}

export interface TranscriptCaptureInfo {
  method: "browser_shuttle_dom";
  completeness: "complete" | "partial" | "rendered_only";
  topReached: boolean;
  bottomReached: boolean;
  partialReasons: string[];
}

export interface BrowserTranscript {
  title: string;
  turns: TranscriptTurn[];
  markdown: string;
  warnings: string[];
  capture: TranscriptCaptureInfo;
}
