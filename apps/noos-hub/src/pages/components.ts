import { escapeHtml } from "../ui/html";

export function configRow(name: string, path: string, detail: string): string {
  return `
    <article class="config-row">
      <div>
        <strong>${escapeHtml(name)}</strong>
        <span>${escapeHtml(detail)}</span>
      </div>
      <code>${escapeHtml(path)}</code>
    </article>
  `;
}
