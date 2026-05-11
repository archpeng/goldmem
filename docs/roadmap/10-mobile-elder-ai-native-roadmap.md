# 10. Mobile Elder AI-Native Roadmap

本文定义老人端当前产品路线：`apps/web-mvp` 是手机优先的单一 AI 对话体验，而不是 Kernel 控制台，也不是“记一下 / 问一问”分页面应用。

## Product Direction

下一阶段主线：

```text
老人端优先
手机优先
单一对话入口优先
由后端 /elder/turn 判断 record / recall / record_and_recall / clarify
家人端完整设计暂缓，只保留必要确认旁路
```

核心承诺：

```text
你直接说一句话。
我判断是帮你记住，还是帮你找以前的记忆。
需要提醒或不确定的事，我会让你确认。
没有依据的事，我不会乱说。
```

## Architecture Fit

老人端只调用薄前端 API adapter：

```text
POST /elder/turn
GET /elder/events
GET /elder/reminders
POST /elder/reminders/:id/confirm
GET /family/elders/:elderId/tasks
POST /elder/feedback
GET /debug/traces/:traceId   # dev only
```

`/elder/turn` 是唯一老人端主入口：

```text
text
  -> ModelGateway.planElderTurn
  -> Kernel schema gate
  -> record: ingestText
  -> recall: queryMemory
  -> record_and_recall: ingestText then queryMemory
  -> clarify: no truth write, no recall answer
  -> audit
```

保持架构红线：

- PostgreSQL 是 truth。
- Mem0 只做 recall proposal。
- Graphiti 只作为 source-aligned temporal evidence。
- 前端不判断任务类型。
- API route 不写业务 truth。
- LLM 输出必须经过 schema validation。
- No evidence means no invented answer。

## Mobile Experience

第一屏结构：

```text
Header: 我帮你记
Today snapshot: 需要确认 / 今天提醒 / 最近记住
Conversation stream
Fixed bottom input: text area + mic state + send
```

老人端普通界面不出现：

- tenant / trace / schema
- Mem0 / Graphiti / provider 名称
- 原始 event table
- 家人端 dashboard
- 开发调试字段

可读性约束：

```text
正文 >= 18px
关键答案 22-28px
主按钮高度 >= 56px
触控目标 >= 48px
375px / 430px 不裁切
主要动作可单手完成
错误提示必须是中文生活语言
```

## Core Flows

### Record

用户：

```text
我把医保卡放在电视柜第二个抽屉了。
```

结果：

```text
我帮你记住了。
我理解的是：医保卡在电视柜第二个抽屉。
```

后端：

```text
/elder/turn -> intent record -> MemoryPlan -> PostgreSQL -> Mem0 infer=false -> Graphiti episode -> audit
```

### Recall

用户：

```text
我的医保卡放在哪里？
```

结果：

```text
确定记得：医保卡在电视柜第二个抽屉。
依据：你之前记录过……
```

后端：

```text
/elder/turn -> intent recall -> parseMemoryQuery -> broad recall -> evidence merge -> answer
```

### Record And Recall

用户：

```text
我刚吃过降压药了，今天还有什么要注意的吗？
```

结果：

```text
先记录刚吃过降压药。
再根据已有证据回答今天相关事项。
```

后端：

```text
/elder/turn -> intent record_and_recall -> ingestText -> queryMemory -> audit same trace
```

### Clarify

用户：

```text
这个呢？
```

结果：

```text
您想让我记住这件事，还是帮您查以前的记忆？
```

后端：

```text
/elder/turn -> intent clarify -> no truth write -> audit
```

## Current Work Packages

### M1: Unified Turn Shell

Done:

- 单一对话入口。
- 今日摘要。
- 移动端固定输入栏。
- 开发 trace 面板隐藏在 dev mode。

### M2: Turn Result Cards

Done:

- record card: “我理解的是”。
- recall card: 确定记得 / 可能相关 / 没找到。
- reminder candidate card: 快捷时间 + datetime-local。
- correction feedback entry point.

Next:

- 语音录音接入后仍提交识别文本到 `/elder/turn`。
- clarification turn 的继续追问体验。
- reminder candidate 的确认语气继续老人化。

### M3: Verification And Regression

Required gates:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm lint
pnpm eval
pnpm architecture:check
pnpm mvp:verify
pnpm mvp:smoke
pnpm e2e:golden
```

Acceptance:

- smoke 覆盖 record、reminder confirm、recall。
- golden 覆盖 PostgreSQL、Mem0、Graphiti、context link evidence。
- Web tests 确认普通界面没有分页面“记一下 / 问一问”导航。
