import { escapeHtml } from "../ui/html";

export function renderLogs(currentLog: string): string {
  const hasOutput = currentLog.trim().length > 0;

  return `
    <section class="section-head">
      <div>
        <p class="eyebrow">输出</p>
        <h2>运行输出</h2>
      </div>
      <button type="button" data-run="doctor">运行 Doctor</button>
    </section>
    <article class="panel log-page-panel">
      <header>
        <strong data-log-title>${hasOutput ? "最近输出" : "还没有输出"}</strong>
        <span>安装、检查和修复动作都会同步到这里。</span>
      </header>
      <pre class="log-page-output">${escapeHtml(hasOutput ? currentLog : "运行 Doctor 或其他动作后，这里会显示输出。")}</pre>
    </article>
  `;
}
