export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[character];
  });
}

export function formatDisplayPath(value: string, noosHome?: string): string {
  if (!value) {
    return value;
  }

  const normalizedValue = normalizePath(value);
  const normalizedNoosHome = noosHome ? normalizePath(noosHome) : undefined;
  const homePath = normalizedNoosHome ? inferHomePath(normalizedNoosHome) : inferHomePath(normalizedValue);

  if (homePath && (normalizedValue === homePath || normalizedValue.startsWith(`${homePath}/`))) {
    return `~${normalizedValue.slice(homePath.length)}`;
  }

  return value;
}

function inferHomePath(path: string): string | undefined {
  if (path.endsWith("/.noos")) {
    return path.slice(0, -"/.noos".length);
  }

  const userHomeMatch = path.match(/^\/Users\/[^/]+/);
  if (userHomeMatch) {
    return userHomeMatch[0];
  }

  const linuxHomeMatch = path.match(/^\/home\/[^/]+/);
  if (linuxHomeMatch) {
    return linuxHomeMatch[0];
  }

  return undefined;
}

function normalizePath(path: string): string {
  return path.replace(/\/+$/g, "") || "/";
}
