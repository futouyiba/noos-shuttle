import type { AdapterStatus } from "../types";
import { escapeHtml } from "../ui/html";

export function metric(label: string, value: string, caption: string): string {
  return `
    <article class="metric">
      <span>${escapeHtml(value)}</span>
      <strong>${escapeHtml(label)}</strong>
      <small>${escapeHtml(caption)}</small>
    </article>
  `;
}

export function storyPanel(index: string, title: string, detail: string, variant: string): string {
  return `
    <article class="story-panel story-panel--${variant}">
      <span>${index}</span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(detail)}</p>
    </article>
  `;
}

export function modelRoadmap(stage: string, title: string, detail: string): string {
  return `
    <article class="roadmap-item">
      <span>${escapeHtml(stage)}</span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(detail)}</p>
    </article>
  `;
}

export function pipelineStep(title: string, detail: string, status: AdapterStatus): string {
  return `
    <article class="pipe pipe--${status}">
      <span></span>
      <strong>${escapeHtml(title)}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `;
}

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

