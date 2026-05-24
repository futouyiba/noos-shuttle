export const EXTENSION_CONTEXT_INVALID = "extension_context_invalid";

export function hasExtensionRuntime(): boolean {
  return typeof chrome !== "undefined" && typeof chrome.runtime?.sendMessage === "function";
}

export async function sendExtensionMessage<Request, Response>(message: Request): Promise<Response> {
  if (!hasExtensionRuntime()) {
    throw new Error(EXTENSION_CONTEXT_INVALID);
  }

  return chrome.runtime.sendMessage<Request, Response>(message);
}
