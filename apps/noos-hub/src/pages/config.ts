import type { HubHealth } from "../types";
import { formatDisplayPath } from "../ui/html";
import { configRow } from "./components";

export function renderConfig(health: HubHealth): string {
  return `
    <section class="section-head">
      <div>
        <p class="eyebrow">配置</p>
        <h2>配置层</h2>
      </div>
      <div class="section-actions">
        <button type="button" data-action="check-update">检查更新</button>
      </div>
    </section>
    <div class="config-list">
      ${configRow("用户 Hub", formatDisplayPath(`${health.noos_home}/config.json`, health.noos_home), "用户级 inbox、默认 agent、GitHub auth provider。")}
      ${configRow("Vault", formatDisplayPath(`${health.noos_home}/vault`, health.noos_home), "本机 Wiki、Handoff、Crystal 的 local-first 存储中心。")}
      ${configRow("项目配置", formatDisplayPath(`${health.repo_root}/.noos/project.json`, health.noos_home), "项目 handoff / crystal 路径和 GitHub repo handle。")}
      ${configRow("本机私有配置", formatDisplayPath(`${health.repo_root}/.noos/local.json`, health.noos_home), "本机私有配置，已被 git ignore。")}
      ${configRow("自动更新", "GitHub Releases / noos-hub-latest.json", "检查签名 manifest，安装 NOOS Hub 桌面更新。")}
      ${configRow("内置 Shuttle", "NOOS Hub.app resources/noos-shuttle-extension", "Hub 更新后随包携带的浏览器插件 build，可直接从浏览器扩展页加载。")}
      ${configRow("署名", "FuTou 2026", "NOOS Hub 与 NOOS Shuttle 的产品署名。")}
    </div>
    <section class="panel">
      <h3>NOOS Shuttle 浏览器插件</h3>
      <p>Hub 更新包会自带当前版本的 Shuttle 扩展目录。安装或更新 Hub 后，打开这个目录，在浏览器扩展页启用开发者模式并加载该目录。</p>
      <button type="button" data-run="open-bundled-shuttle-extension">打开内置插件目录</button>
    </section>
  `;
}
