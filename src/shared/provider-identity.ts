export const SUPPORTED_PROVIDER_HOSTS = [
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
  "aistudio.google.com",
  "chat.deepseek.com",
  "kimi.moonshot.cn",
  "yuanbao.tencent.com",
  "www.doubao.com",
  "chat.qwen.ai",
  "grok.com",
  "www.perplexity.ai",
  "poe.com"
] as const;

export function isSupportedProviderHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/\.$/, "");
  return SUPPORTED_PROVIDER_HOSTS.some(
    (candidate) => normalized === candidate || normalized.endsWith(`.${candidate}`)
  );
}

export function extractProviderConversationId(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || !isSupportedProviderHost(url.hostname)) return undefined;
  const match = [
    /^\/c\/([^/?#]+)/,
    /^\/chat\/([^/?#]+)/,
    /^\/app\/[^/]+\/chat\/([^/?#]+)/,
    /^\/u\/\d+\/c\/([^/?#]+)/,
    /^\/g\/[^/]+\/c\/([^/?#]+)/,
    /^\/g\/[^/]+\/u\/\d+\/c\/([^/?#]+)/
  ]
    .map((pattern) => url.pathname.match(pattern)?.[1])
    .find(Boolean);
  const normalized = match ? normalizeProviderConversationId(match) : undefined;
  return normalized && !normalized.startsWith("WEB:") ? normalized : undefined;
}

export function normalizeProviderConversationId(value: string): string {
  let normalized = value.trim();
  for (let index = 0; index < 3; index += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(normalized);
    } catch {
      break;
    }
    if (decoded === normalized) break;
    normalized = decoded;
  }
  return normalized;
}
