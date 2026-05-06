# NOOS Shuttle 页面上下文事件与状态处理

NOOS Shuttle 运行在长期打开的 chatbot 标签页里。用户可能切换 conversation、刷新页面、通过浏览器历史恢复页面、从支持的网站跳到不支持的网站，或者因为账号切换进入登录/无权限状态。这些变化不一定会触发完整 reload，所以插件不能把当前页面当成静态文档，而要把它当成会变化的页面上下文。

## 目标

- 识别当前可见 chatbot 上下文是否已经不再是同一个 handoff 来源。
- 页面被卸载、刷新或替换时，取消过期的 `生成并收取` 等待。
- 用户切换到另一个 conversation 时，重置已捕获 handoff 状态。
- 用户只是把标签页切到后台时，不取消仍然有效的生成等待。
- 不把 ChatGPT 当成唯一支持对象，为 Claude、Gemini、Kimi 等页面留出扩展空间。

## 页面上下文模型

content script 会构造一个 `PageContext` 快照：

```ts
type PageKind = "conversation" | "composer" | "login" | "unavailable" | "unsupported" | "unknown";

interface PageContext {
  href: string;
  origin: string;
  pathname: string;
  conversationId: string;
  pageKind: PageKind;
  textFingerprint: string;
  signature: string;
}
```

真正用于判断是否需要重置的是 `signature`，它包含：

- Origin
- 归一化后的 path
- 能识别出来的 conversation id
- 页面类型 `pageKind`

Query string 和 hash fragment 暂时不参与重置判断，因为很多 chatbot 会把它们用于 UI 状态，而不是用于表示不同 conversation。

## 页面类型

- `conversation`：支持的 chatbot 页面，并且识别到了 conversation id。
- `composer`：支持的 chatbot 页面，有输入框，但还没有 conversation id。
- `login`：支持的 chatbot host 上出现登录、鉴权、OAuth、注册等状态。
- `unavailable`：支持的 chatbot host 上出现找不到、无法加载、无权限等状态。
- `unsupported`：当前页面不在已支持 chatbot host 列表里。
- `unknown`：host 支持，但当前没有匹配到 conversation、composer、login 或 unavailable。

## 监听的事件

插件会监听多组事件，因为现代 chatbot 经常在不刷新页面的情况下切换状态：

- `history.pushState` / `history.replaceState`：SPA 路由变化。
- `popstate` / `hashchange`：浏览器前进后退和 hash 导航。
- `focus`：用户从其他窗口或账号操作后回到当前标签页。
- `pageshow`：页面从浏览器历史或 back-forward cache 恢复。
- `visibilitychange`：标签页重新变为可见时重新检查上下文。
- `pagehide`：页面卸载、刷新、跳转或进入 back-forward cache；此时取消 active generation wait。
- 1 秒一次的上下文轮询：兜底捕获浏览器事件漏掉的 route、账号或 DOM 状态变化。

在 `生成并收取` 等待期间，还会额外监听生成状态：

- `MutationObserver`：观察 chatbot DOM 在生成时的变化。
- `isChatbotGenerating()`：判断当前是否仍在生成。
- 1.5 秒一次的收取轮询：即使页面没有在关键时刻触发 DOM mutation，也能发现已完成的 handoff。
- 120 秒等待超时：避免异常情况下无限等待。

## 重置行为

当页面上下文 `signature` 发生变化时，NOOS Shuttle 会：

1. 取消正在进行的生成/收取等待。
2. 收起 popover 和设置面板。
3. 将状态重置为 `idle`。
4. 清空已捕获的 thread 候选和当前选择。
5. 关闭选择、警告或成功弹窗。
6. 显示本地化的 `conversationChanged` 提示。

这个策略是有意保守的：一个 conversation 里捕获到的 handoff，不应该在用户切到另一个 conversation、账号状态或 chatbot host 后继续保持选中。

## 场景处理

| 场景 | 检测方式 | 行为 |
| --- | --- | --- |
| ChatGPT conversation 切换 | `pushState`、`replaceState`、`popstate` 或轮询发现新的 conversation id | 重置面板状态，取消过期等待 |
| 页面刷新 | `pagehide` 取消 active wait；reload 后 content script 重新启动 | 旧等待不会跨 reload 存活 |
| 标签页切到后台 | hidden 状态不取消等待 | 生成等待可以继续；重新可见时检查上下文 |
| 从历史恢复标签页 | `pageshow` 触发上下文检查 | 只有 signature 改变时才重置 |
| 跳到不支持的网站 | host 变成 `unsupported` | 重置已捕获状态 |
| 用户登出或账号状态变化 | page kind 变成 `login`、`unavailable` 或 `unknown` | 重置已捕获状态 |
| conversation 不可访问 | 页面文本匹配 `unavailable` | 重置已捕获状态 |

## 当前限制

- 账号身份目前从页面状态推断；插件还没有从各 chatbot provider 读取稳定账号 id。
- conversation id 路由模式是启发式的。ChatGPT 覆盖较强，其他 chatbot 页面后续可能需要增加 route pattern。
- 本机 NOOS Vault 写入仍通过浏览器下载 API 完成。后续 Hub local write channel 应提供更明确的成功/失败反馈。
- 如果某个 chatbot 在 URL、route 和页面类型都不变的情况下只替换可见 conversation 内容，1 秒轮询仍可能漏掉语义层面的切换。后续可以用 provider-specific selector 增强。

## 实现位置

页面上下文守卫位于：

```text
src/content/index.ts
```

核心函数：

- `installConversationWatcher`
- `checkPageContext`
- `resetForConversationChange`
- `getPageContext`
- `detectConversationId`
- `detectPageKind`
