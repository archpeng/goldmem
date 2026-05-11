# 10. Mobile Elder AI-Native Roadmap

本文定义下一阶段产品交付路线：把 `apps/web-mvp` 从 Kernel MVP 控制台改造成手机优先的老人端 AI-native 体验原型。

本路线不替代长期记忆架构路线。PostgreSQL、Mem0、Graphiti、Kernel 的职责边界保持不变；本路线关注如何把这些后端能力包装成老人能理解、愿意每天使用、且可被验证的产品交互。

## Product Decision

下一阶段主线：

```text
老人端优先
手机优先
AI-native 输入/确认/回忆闭环优先
家人端完整设计暂缓
家人端只保留最小确认旁路
```

原因：

- 老人端是高质量记忆数据的入口。没有老人愿意持续记录，Mem0 和 Graphiti 没有足够生活证据。
- 当前后端已经能支撑老人端 v1：text ingest、voice ingest path、reminder candidate、risk guardrail、evidence-bound recall、Mem0 recall、Graphiti temporal evidence、audit。
- 家人端是商业价值和安全闭环的一部分，但完整家属 dashboard 会过早扩大范围。现阶段只保留必要 family task / risk / reminder confirmation 能力。

## Target Experience

老人端不是数据管理台，也不是普通聊天机器人。

产品定位：

```text
一个会听、会记、会提醒、会帮我想起来的生活记忆助手。
```

核心承诺：

```text
你说一句话，我帮你记住。
你想不起，我根据你说过的话帮你找。
要提醒的事，我先让你确认。
没有依据的事，我不会乱说。
```

## User Constraints

老人端设计必须默认面对以下限制：

- 视力下降：低对比、小字号、密集列表会降低可用性。
- 精细操作下降：小按钮、复杂滑动、多级菜单会造成误触。
- 短期记忆下降：多步骤流程、隐藏状态、返回后丢上下文会造成迷失。
- 注意力易被打断：每屏只能承载一个主要任务。
- 对技术概念无感：不能出现 tenant、trace、schema、evidence id、Mem0、Graphiti 等内部词。
- 使用频率不稳定：即使几天不用，再打开也要立刻知道能做什么。

## Design Principles

### 1. One Primary Action Per Screen

每个主屏只允许一个主动作。

首页主动作：

```text
按住说，我帮你记住
```

其他动作只能作为次级入口：

```text
问一问
今天要确认
最近记住
```

### 2. Voice First, Text Fallback

手机端以语音作为默认入口，文字输入作为兜底。

MVP 可以先复用 text API 实现输入体验，但 UI 必须按语音优先设计：

```text
press-to-talk / tap-to-type
listening
understanding
confirmation card
saved
```

### 3. AI Understands, User Confirms

AI 可以理解、总结、追问、生成候选，但不能替老人确认业务事实。

必须确认的内容：

- 新提醒
- 缺时间的提醒
- 低置信度事件
- 药物、财务、诈骗、身份、密码等风险相关事项
- 修改已有记忆

### 4. Evidence Becomes Trust Copy

后端 evidence 不能原样暴露成技术元数据。老人端应翻译成信任语言：

```text
根据你 5月10日 说过的话：
医保卡在电视柜左边抽屉里。
```

没有 evidence 时必须清楚说：

```text
我没有找到你之前说过这件事。
```

### 5. Calm, Large, Stable Mobile UI

默认 UI 约束：

```text
正文 >= 18px
关键答案 22-28px
主按钮高度 >= 56px
触控目标 >= 48px
底部导航最多 3 项
一屏不超过 5 个可点击对象
避免表格、密集 badge、技术状态堆叠
```

## Information Architecture

老人端第一版只保留 3 个主入口：

```text
今天
记一下
问一问
```

### 今天

默认首页。

显示：

- 需要确认
- 今天提醒
- 最近记住

不显示：

- 原始 event table
- tenant/elder/actor 配置
- debug trace
- family task 技术列表

### 记一下

AI-native 录入入口。

支持：

- 大号语音按钮
- 文字输入兜底
- 理解结果确认卡
- 提醒补充时间
- 风险提示

### 问一问

自然语言回忆入口。

支持：

- 输入问题
- evidence-bound answer
- matched source trust copy
- 没找到时引导用户现在记录
- 可选“这不对，改一下”反馈入口

## Core Flows

### Flow 1: Save A Memory

输入：

```text
我把钥匙放在门口鞋柜上了。
```

UI 状态：

```text
正在听
正在整理
我理解的是
已记住
```

确认卡：

```text
我帮你记住了

钥匙在门口鞋柜上。

按钮：
对，记住
改一下
不用记
```

后端映射：

```text
POST /elder/turn
ElderTurnPlan intent = record
Kernel MemoryPlan validation
PostgreSQL source/event write
Mem0 canonical summary write
Graphiti temporal episode write
audit
```

Acceptance:

- 老人不需要填写标题、类型、时间。
- 保存成功后只显示生活语言摘要。
- Graphiti/Mem0 状态不出现在普通老人界面。
- Graphiti 失败只进入开发状态或内部诊断，不打断老人保存记忆。

### Flow 2: Create A Reminder

输入：

```text
明天早上提醒我吃降压药。
```

如果时间不够具体：

```text
还差一个具体时间

你想几点提醒？

早上 7 点
早上 8 点
我来说时间
```

确认后：

```text
已设置提醒

明天 8:00
吃降压药
```

后端映射：

```text
Reminder candidate
DefaultReminderEngine.confirmReminder
Audit reminder_confirmed
```

Acceptance:

- 不用表单创建提醒。
- 缺少 `remindAt` 时不能确认。
- 药物提醒必须保留风险/确认语义，不由前端自行降级。

### Flow 3: Ask A Memory Question

输入：

```text
我医保卡放哪了？
```

有 evidence：

```text
你之前说过：

医保卡在电视柜左边抽屉里。

依据：
5月10日 你记录过“医保卡放在电视柜左边抽屉”
```

无 evidence：

```text
我没有找到你之前说过医保卡放在哪里。

你可以现在告诉我，我帮你记住。
```

后端映射：

```text
POST /elder/turn
ElderTurnPlan intent = recall
parseMemoryQuery
PostgreSQL broad recall
Mem0 recall
Graphiti temporal search when useful
evidence merge
no evidence => no generated answer
```

Acceptance:

- 回答永远优先显示可理解结论。
- 依据最多显示 1-3 条，不展示技术字段。
- no evidence 状态不能生成猜测答案。

### Flow 4: Today Confirmation Queue

首页显示：

```text
需要你确认

这个提醒还差时间：
明天早上吃降压药

这件事要不要提醒你？
下午去医院
```

Acceptance:

- 只展示需要老人行动的事项。
- 已确认事项进入“今天提醒”。
- 家人任务不以 family task 技术概念展示给老人。

### Flow 5: Correct A Memory

入口：

```text
这不对，改一下
```

第一阶段只做轻量反馈，不直接覆盖 truth：

```text
你想改成什么？
```

后端策略：

- MVP 可先写 feedback/audit。
- 后续由 Kernel 生成 correction MemoryPlan。
- 不允许前端直接改 PostgreSQL truth。

Acceptance:

- 修正行为可审计。
- 原始 source 不被覆盖。
- 后续 recall 应能解释“之前说过”和“后来改过”的差异。

## Work Packages

### EP-1: Mobile Product Shell

Scope:

```text
Convert apps/web-mvp from desktop console to mobile-first elder app.
Keep React + Vite + Tailwind + shadcn-style components.
Add bottom navigation: 今天 / 记一下 / 问一问.
Hide technical identity fields behind development mode.
Move debug trace to hidden dev panel.
```

Files:

```text
apps/web-mvp/src/App.tsx
apps/web-mvp/src/styles.css
apps/web-mvp/src/lib/copy.ts
apps/web-mvp/src/components/ui/*
```

Acceptance:

- Mobile viewport is the primary layout.
- Desktop view shows a constrained phone-like app surface, not a dashboard.
- No tenant/trace/schema/API terminology in normal UI.
- Existing API usage remains centralized in `src/lib/api.ts`.

### EP-2: AI Capture Experience

Scope:

```text
Create "记一下" flow.
Use large voice-first input surface.
Text input remains available.
Show "正在整理" state during ingest.
Render "我帮你记住了" cards from ingest result.
Render reminder candidates as confirmation cards.
```

Acceptance:

- User can save a memory with one obvious action.
- Ingest result becomes a life-language confirmation card.
- Reminder candidate is actionable without exposing raw reminder schema.
- Risk copy is clear but calm.

### EP-3: Evidence-Bound Recall Experience

Scope:

```text
Create "问一问" flow.
Show answer in large readable text.
Show 1-3 evidence snippets from retrievedEvidence/matchedSources.
Separate "确定记得" / "可能相关" / "没有找到" states.
Add correction feedback entry point.
```

Acceptance:

- Evidence is understandable to an elder.
- No evidence response invites user to create a new memory.
- Retrieval source labels are not shown as provider names by default.

### EP-4: Today Action Queue

Scope:

```text
Create Today home.
Fetch events/reminders/family tasks through existing APIs.
Convert raw records into elder-facing action groups:
  needsConfirmation
  todayReminders
  recentlyRemembered
```

Acceptance:

- The first screen answers "今天我需要做什么？"
- Reminder confirmation works from Today.
- Recently remembered items are readable, short, and non-technical.

### EP-5: Mobile Accessibility Pass

Scope:

```text
Large type scale.
Large touch targets.
High contrast.
Stable card heights where possible.
Safe-area bottom navigation.
Reduced visual density.
Clear loading/error/success states.
```

Acceptance:

- 375px wide viewport has no clipped text.
- Main actions remain reachable with one thumb.
- Error messages are Chinese, non-technical, and actionable.
- No hover-only controls.

### EP-6: Voice Readiness

Scope:

```text
Design UI states for recording/listening/transcribing.
Send recognized text through /elder/turn when browser recording is ready.
Keep text fallback for development and unsupported browsers.
```

Acceptance:

- Product flow is voice-first even if MVP still uses typed transcript in development.
- Failed transcription has a clear retry path.
- Audio evidence remains optional in UI unless source can play back.

### EP-7: Minimal Family Sidecar

Scope:

```text
Do not build full family dashboard.
Keep backend family task actions available.
Expose only elder-relevant confirmation states in elder app.
Reserve family digest/dashboard for a later roadmap.
```

Acceptance:

- Family path does not block elder app delivery.
- Risk/family-required states remain visible enough for safety.
- No new frontend business rules duplicate Kernel behavior.

### EP-8: Product Verification

Scope:

```text
Update unit tests for mobile elder copy and API mapping.
Add responsive rendering tests where practical.
Keep existing Kernel/API/store tests unchanged.
Run mvp verification after frontend changes.
```

Required checks for this roadmap:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm lint
pnpm architecture:check
```

When touching recall display:

```bash
pnpm eval
pnpm e2e:golden
```

When touching reminder confirmation:

```bash
pnpm test
pnpm mvp:smoke
```

## API Fit

Current APIs are enough for the first mobile elder prototype:

```text
POST /elder/turn
GET /elder/events
GET /elder/reminders
POST /elder/reminders/:id/confirm
GET /family/elders/:elderId/tasks
POST /family/tasks/:taskId/confirm
POST /family/tasks/:taskId/reject
POST /family/tasks/:taskId/needs-more-info
```

Frontend constraints:

- All API calls stay in `apps/web-mvp/src/lib/api.ts`.
- React must not replicate risk, permission, reminder, or truth-write rules.
- UI may group and rename statuses for display, but not change domain state semantics.
- Debug endpoints are development-only UI.

Likely later API additions:

```text
GET /elder/today
POST /elder/feedback
GET /elder/memories/:eventId
POST /elder/memories/:eventId/correction
GET /elder/timeline
```

These should be added only after the mobile prototype proves the shape of the experience.

## Non-Goals

Do not build in this phase:

- full family dashboard
- admin memory debugger
- complex graph visualization
- dense timeline explorer
- manual CRUD editor for memory truth
- provider-specific Mem0/Graphiti UI
- production auth onboarding
- notification scheduler UI

## Milestones

### M1: Mobile Elder Shell

Deliver:

- mobile-first layout
- bottom navigation
- Today / 记一下 / 问一问
- technical controls hidden

Exit criteria:

- app looks like an elder mobile product, not a developer console
- `pnpm build` passes

### M2: AI Capture Loop

Deliver:

- one-action memory capture
- "我帮你记住了" confirmation cards
- reminder candidate cards
- calm risk copy

Exit criteria:

- normal note, reminder note, medication/risk note are understandable on phone
- no backend rule duplicated in React

### M3: Evidence Recall Loop

Deliver:

- natural language question UI
- answer + basis display
- no-evidence state
- correction entry point

Exit criteria:

- user can ask "我说过 X 吗" and understand answer provenance
- no-evidence answer does not look like failure

### M4: Today Action Loop

Deliver:

- pending confirmation queue
- today reminders
- recently remembered

Exit criteria:

- opening the app answers what needs attention today
- reminder confirmation is usable on mobile

### M5: Usability Hardening

Deliver:

- mobile accessibility pass
- error/success copy
- loading states
- regression tests

Exit criteria:

- 375px and 430px mobile widths are visually stable
- typecheck/test/build/lint/architecture checks pass

## Success Criteria

The mobile elder prototype succeeds when an older user can do these without training:

1. Open the app and understand what to do first.
2. Record or type one life memory.
3. Confirm what the system understood.
4. Create or confirm a reminder without filling a form.
5. Ask where something is or what they previously said.
6. Understand whether the answer has evidence.
7. Recover gracefully when the system did not find evidence.

The engineering success criterion:

```text
The frontend becomes a thin, mobile-first elder interaction layer over the existing Kernel/API.
It improves comprehension and trust without weakening PostgreSQL truth, Mem0 recall boundaries, Graphiti evidence alignment, or deterministic safety behavior.
```
