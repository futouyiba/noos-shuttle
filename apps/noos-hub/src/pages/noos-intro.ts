import type { HubHealth } from "../types";
import { storyPanel } from "./components";
import { renderGuideSnapshot } from "./guide";

const githubUrl = "https://github.com/futouyiba/noos-shuttle";
const docsUrl = "https://futouyiba.github.io/noos-shuttle/";

export function renderNoosIntro(health: HubHealth): string {
  return `
    <section class="intro-hero">
      <div class="intro-copy">
        <p class="eyebrow">NOOS Shuttle + NOOS OS</p>
        <h2>让不同 AI 工具共享上下文、状态和下一步。</h2>
        <p>NOOS Shuttle 负责把 chatbox 里的讨论变成 Handoff 和 Crystal；NOOS Operating System 负责把 artifact、agent、repo、浏览器和本机能力组织成可检查、可安装、可消费的系统。</p>
        <div class="intro-actions">
          <a href="${githubUrl}" target="_blank" rel="noreferrer">GitHub</a>
          <a href="${docsUrl}" target="_blank" rel="noreferrer">文档</a>
        </div>
      </div>
      <div class="system-visual" aria-label="NOOS system flow">
        <div class="orbit orbit--chat">Chatbox</div>
        <div class="orbit orbit--handoff">Handoff</div>
        <div class="orbit orbit--agent">Agent</div>
        <div class="core-node">NOOS</div>
      </div>
    </section>
    <section class="story-grid">
      ${storyPanel("01", "捕获", "ChatGPT、Claude、Gemini 等上游讨论被整理成结构化 Handoff 或 Crystal。", "capture")}
      ${storyPanel("02", "存储", "Hub 管理本机 NOOS Vault，并从 Browser Mirror 导入回退保存的文件。", "transport")}
      ${storyPanel("03", "消费", "Codex、Claude Code 和其他 coding agent 按 key 或路径读取并继续执行。", "consume")}
    </section>
    <section class="section-head">
      <div>
        <p class="eyebrow">本机状态</p>
        <h2>当前 NOOS 实体状态</h2>
      </div>
      <button type="button" data-run="doctor">运行 Doctor</button>
    </section>
    ${renderGuideSnapshot(health)}
  `;
}
