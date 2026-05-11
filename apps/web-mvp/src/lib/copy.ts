export const copy = {
  appKicker: "生活记忆助手",
  appTitle: "我帮你记",
  appDescription: "说一句话，我帮你记住；想不起来时，我根据你说过的话帮你找。",
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
  today: {
    kicker: "今天",
    hasActions: "有几件事需要你确认",
    noActions: "今天没有需要处理的事",
    needsConfirmation: "需要你确认",
    todayReminders: "今天提醒",
    recentMemories: "最近记住",
  },
  capture: {
    understoodTitle: "我理解的是",
    reminderCandidates: "可能需要提醒",
  },
  recall: {
    certainTitle: "确定记得",
    possibleTitle: "可能相关",
    missingTitle: "没有找到",
    basis: "依据",
    recordedEvidence: "你之前记录过",
    contextLinkEvidence: "可能相关",
    graphitiEvidence: "长期记忆里有相关线索",
    noEvidenceBody: "我没有找到你之前说过这件事。",
    correct: "这不对，改一下",
    correctionLabel: "哪里不对？",
    correctionPlaceholder: "例如：不是青菜，是菠菜。",
    sendCorrection: "提交修改",
  },
  events: {
    refresh: "刷新",
  },
  reminders: {
    confirm: "确认提醒",
    readyToConfirm: "可以确认这个提醒",
    timeNeeded: "还差具体时间",
    quickTimes: {
      morning: "早上 7 点",
      noon: "中午 12 点",
      evening: "晚上 7 点",
    },
  },
  risk: {
    attention: "这件事比较重要",
  },
  status: {
    refreshed: "已刷新。",
    reminderConfirmed: "提醒已确认。",
    feedbackSaved: "我记下这个修改了。",
    turnCompleted: "处理好了。",
  },
} as const;

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
