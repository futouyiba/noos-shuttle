import type { NoosThread } from "../core/noos-thread";

export interface SaveOptions {
  filename?: string;
  preferredPath?: string;
  repo?: string;
  branch?: string;
  overwrite?: boolean;
}

export interface SaveResult {
  ok: boolean;
  adapterId: string;
  backend?: string;
  location?: string;
  errorCode?: string;
  message?: string;
}

export interface StorageAdapter {
  id: string;
  name: string;
  saveThread(thread: NoosThread, options?: SaveOptions): Promise<SaveResult>;
}
