export const copy = {
  appTitle: "GoldMem 记忆 MVP",
  appDescription: "把老人随手记录转成可追溯记忆、提醒确认和证据化回忆。",
  identity: {
    elderId: "老人 ID",
    elderActor: "老人操作人",
    familyActor: "家庭操作人",
  },
  capture: {
    title: "记录记忆",
    action: "保存记忆",
    latestSummary: "最新摘要",
    defaultTranscript: "我今天去菜市场买了青菜，明天上午提醒我给女儿打电话。",
  },
  recall: {
    title: "询问记忆",
    action: "询问",
    defaultQuestion: "我买了什么？",
    confidence: "可信度",
    matchedSources: "匹配证据",
    evidenceSources: "召回来源",
    postgresEvidence: "PostgreSQL 事实源",
    mem0Evidence: "Mem0 语义记忆",
    contextLinkEvidence: "上下文关联",
    graphitiEvidence: "Graphiti 长期关系",
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
    timeNeeded: "需要补充时间",
  },
  familyTasks: {
    title: "家庭确认",
    confirm: "家庭确认",
    empty: "暂无家庭待确认事项。",
  },
  status: {
    refreshed: "列表已刷新。",
    memorySaved: "记忆已保存。",
    queryAnswered: "已生成回答。",
    reminderConfirmed: "提醒已确认。",
    familyTaskConfirmed: "家庭任务已确认。",
  },
} as const;

export function translateStatus(status: string): string {
  const map: Record<string, string> = {
    candidate: "候选",
    pending_elder_confirm: "待老人确认",
    pending_family_confirm: "待家庭确认",
    confirmed: "已确认",
    scheduled: "已计划",
    sent: "已发送",
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
    sensitive: "敏感",
    medical: "医疗",
    financial: "金融",
    fraud_risk: "诈骗风险",
  };
  return map[riskLevel] ?? riskLevel;
}

export function translateEventType(type: string): string {
  const map: Record<string, string> = {
    health: "健康",
    medication: "用药",
    appointment: "预约",
    family: "家庭",
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
