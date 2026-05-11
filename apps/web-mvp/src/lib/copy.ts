export const copy = {
  appKicker: "生活记忆助手",
  appTitle: "我帮你记",
  appDescription: "说一句话，我帮你记住；想不起来时，我根据你说过的话帮你找。",
  nav: {
    today: "今天",
    capture: "记一下",
    recall: "问一问",
  },
  conversation: {
    inputLabel: "想说的话",
    placeholder: "说一句话，我来判断是记住，还是帮你找。",
    voiceAction: "语音输入",
    listening: "我在听，你慢慢说",
    send: "发送给记忆助手",
    thinking: "正在理解你说的话",
    emptyTitle: "直接说一句话就行",
    emptyBody: "不用先选是记录还是查询。我会自己判断该记住、该查找，还是需要再问清楚。",
    defaultInput: "我今天去菜市场买了青菜，明天上午提醒我给女儿打电话。",
    exampleRecord: "我把医保卡放在电视柜第二个抽屉了。",
    exampleRecall: "我的医保卡放在哪里？",
    exampleMixed: "我刚吃过降压药了，今天还有什么要注意的吗？",
  },
  identity: {
    elderId: "老人 ID",
    elderActor: "老人操作人",
    familyActor: "家庭操作人",
  },
  today: {
    kicker: "今天",
    hasActions: "有几件事需要你确认",
    noActions: "今天没有需要处理的事",
    needsConfirmation: "需要你确认",
    todayReminders: "今天提醒",
    recentMemories: "最近记住",
    noPending: "现在没有需要你确认的事。",
    noReminderToday: "今天还没有提醒。",
    noRecentMemories: "还没有最近记住的事。",
  },
  capture: {
    kicker: "记一下",
    title: "按住说，我帮你记住",
    description: "可以说东西放哪了、明天要做什么、刚才发生了什么。",
    voiceAction: "按住说，我帮你记住",
    textFallback: "也可以在这里打字",
    saveAction: "帮我记住",
    latestSummary: "最新摘要",
    savedTitle: "我帮你记住了",
    understoodTitle: "我理解的是",
    savedStatus: "已经记好了",
    listening: "我在听，你慢慢说",
    understanding: "正在整理你说的话",
    reminderCandidates: "可能需要提醒",
    needsConfirmation: "你可以再确认一下",
    defaultTranscript: "我今天去菜市场买了青菜，明天上午提醒我给女儿打电话。",
  },
  recall: {
    kicker: "问一问",
    title: "想不起什么？问我",
    description: "我只会根据你之前说过、系统记下来的内容回答。",
    inputLabel: "想问的事",
    action: "帮我想一想",
    thinking: "正在帮你找",
    defaultQuestion: "我买了什么？",
    answerTitle: "我找到了",
    certainTitle: "确定记得",
    possibleTitle: "可能相关",
    missingTitle: "没有找到",
    basis: "依据",
    recordedEvidence: "你之前记录过",
    contextLinkEvidence: "可能相关",
    graphitiEvidence: "长期记忆里有相关线索",
    noEvidenceTitle: "没有找到依据",
    noEvidenceBody: "我没有找到你之前说过这件事。",
    saveNow: "现在记一下",
    correct: "这不对，改一下",
    correctionLabel: "哪里不对？",
    correctionPlaceholder: "例如：不是青菜，是菠菜。",
    sendCorrection: "提交修改",
  },
  events: {
    title: "记忆记录",
    refresh: "刷新",
    empty: "还没有记忆记录。",
  },
  reminders: {
    title: "提醒",
    confirm: "确认提醒",
    empty: "还没有提醒。",
    readyToConfirm: "可以确认这个提醒",
    timeNeeded: "还差具体时间",
    quickTimes: {
      morning: "早上 7 点",
      noon: "中午 12 点",
      evening: "晚上 7 点",
    },
  },
  familyTasks: {
    title: "需要家人一起确认",
    elderFacingTitle: "这件事建议确认清楚",
    confirm: "我知道了",
    empty: "暂无家庭待确认事项。",
  },
  risk: {
    attention: "这件事比较重要",
  },
  status: {
    refreshed: "已刷新。",
    memorySaved: "记好了。",
    queryAnswered: "找到了回答。",
    reminderConfirmed: "提醒已确认。",
    familyTaskConfirmed: "已确认。",
    feedbackSaved: "我记下这个修改了。",
    turnCompleted: "处理好了。",
  },
} as const;

export function translateStatus(status: string): string {
  const map: Record<string, string> = {
    candidate: "候选",
    pending_elder_confirm: "待确认",
    pending_family_confirm: "待家人确认",
    confirmed: "已确认",
    scheduled: "已计划",
    sent: "已提醒",
    done: "已完成",
    cancelled: "已取消",
    rejected: "已拒绝",
    needs_more_info: "需补充",
    expired: "已过期",
    active: "有效",
    needs_review: "需复核",
    archived: "已归档",
  };
  return map[status] ?? status;
}

export function translateRiskLevel(riskLevel: string): string {
  const map: Record<string, string> = {
    normal: "普通",
    sensitive: "敏感信息",
    medical: "健康或用药",
    financial: "财务",
    fraud_risk: "可能有诈骗风险",
  };
  return map[riskLevel] ?? riskLevel;
}

export function translateEventType(type: string): string {
  const map: Record<string, string> = {
    health: "健康",
    medication: "用药",
    appointment: "预约",
    family: "家人",
    shopping: "购物",
    finance: "财务",
    place: "地点",
    object: "物品",
    general: "普通",
  };
  return map[type] ?? type;
}

export function translateUrgency(urgency: string): string {
  const map: Record<string, string> = {
    low: "低优先级",
    medium: "中优先级",
    high: "高优先级",
  };
  return map[urgency] ?? urgency;
}

export function translateVisibility(visibility: string): string {
  const map: Record<string, string> = {
    private: "私密",
    shared_summary: "共享摘要",
    shared_full: "完整共享",
    family_required: "需家庭查看",
  };
  return map[visibility] ?? visibility;
}
