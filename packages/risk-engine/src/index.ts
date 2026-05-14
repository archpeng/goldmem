import type { MemoryPlan, MemorySource } from "@mem/memory-schema";

type RiskLevel = MemoryPlan["events"][number]["riskLevel"];
type RiskFlagType = MemoryPlan["riskFlags"][number]["type"];
type RiskFlagSeverity = MemoryPlan["riskFlags"][number]["severity"];

export type SafetyDomain =
  | "medical"
  | "medication"
  | "identity"
  | "password_or_code"
  | "financial_transfer"
  | "fraud_context"
  | "privacy";

export type RiskGuardrailRepair = {
  action:
    | "event_confirmation_required"
    | "event_risk_level_raised"
    | "family_task_added"
    | "reminder_confirmation_required"
    | "risk_flag_added"
    | "risk_flag_review_required";
  reason: "high_risk_flag" | "low_confidence_reminder" | "model_labeled_risk" | "source_safety_scan";
  domains?: SafetyDomain[];
  eventIndexes?: number[];
  reminderIndexes?: number[];
  riskFlagType?: RiskFlagType;
  riskLevel?: RiskLevel;
  familyTaskType?: MemoryPlan["familyTasks"][number]["type"];
};

export type RiskEnforcementInput = {
  plan: MemoryPlan;
  source: MemorySource;
};

export type RiskEnforcementResult = {
  plan: MemoryPlan;
  repairs: RiskGuardrailRepair[];
};

export interface RiskEngine {
  enforce(input: RiskEnforcementInput): Promise<RiskEnforcementResult>;
}

export class DefaultRiskEngine implements RiskEngine {
  async enforce(input: RiskEnforcementInput): Promise<RiskEnforcementResult> {
    const next = clonePlan(input.plan);
    const repairs: RiskGuardrailRepair[] = [];
    const modelRiskEventIndexes: number[] = [];
    const lowConfidenceReminderIndexes: number[] = [];

    for (let eventIndex = 0; eventIndex < next.events.length; eventIndex += 1) {
      const event = next.events[eventIndex];
      if (!event) continue;
      if (["medical", "financial", "fraud_risk", "sensitive"].includes(event.riskLevel)) {
        if (!event.requiresConfirmation) modelRiskEventIndexes.push(eventIndex);
        event.requiresConfirmation = true;
      }

      if (event.riskLevel === "fraud_risk") {
        next.familyTasks.push({
          type: "risk_review",
          title: "Possible fraud or financial risk needs review",
          summary: event.summary,
          urgency: "high",
          visibility: "family_required",
        });
        repairs.push({
          action: "family_task_added",
          reason: "model_labeled_risk",
          eventIndexes: [eventIndex],
          familyTaskType: "risk_review",
        });
      }
    }

    if (modelRiskEventIndexes.length > 0) {
      repairs.push({
        action: "event_confirmation_required",
        reason: "model_labeled_risk",
        eventIndexes: modelRiskEventIndexes,
      });
    }

    for (let reminderIndex = 0; reminderIndex < next.reminderCandidates.length; reminderIndex += 1) {
      const reminder = next.reminderCandidates[reminderIndex];
      if (!reminder) continue;
      if (!reminder.remindAt || reminder.timeConfidence < 0.7) {
        if (!reminder.confirmationRequired) lowConfidenceReminderIndexes.push(reminderIndex);
        reminder.confirmationRequired = true;
      }
    }

    if (lowConfidenceReminderIndexes.length > 0) {
      repairs.push({
        action: "reminder_confirmation_required",
        reason: "low_confidence_reminder",
        reminderIndexes: lowConfidenceReminderIndexes,
      });
    }

    const safetyHits = scanSafetyDomains(input.source.transcript);
    applySourceSafetyRepairs(next, input.source, safetyHits, repairs);
    enforceRiskFlagReview(next, new Set(safetyHits.map((hit) => hit.rule.riskFlagType)), repairs);

    return { plan: next, repairs };
  }
}

function clonePlan(plan: MemoryPlan): MemoryPlan {
  return JSON.parse(JSON.stringify(plan)) as MemoryPlan;
}

type SafetyRule = {
  domain: SafetyDomain;
  riskFlagType: RiskFlagType;
  severity: RiskFlagSeverity;
  riskLevel: RiskLevel;
  highRisk: boolean;
  patterns: RegExp[];
};

type SafetyHit = {
  rule: SafetyRule;
  startChar: number;
  endChar: number;
};

const RISK_LEVEL_PRIORITY: Record<RiskLevel, number> = {
  normal: 0,
  sensitive: 1,
  medical: 2,
  financial: 3,
  fraud_risk: 4,
};

const HIGH_REVIEW_RISK_FLAGS = new Set<RiskFlagType>([
  "financial_transfer",
  "fraud_suspected",
  "identity_document",
  "medication_change",
  "password_or_code",
]);

const REVIEW_TASK_DOMAINS = new Set<SafetyDomain>([
  "financial_transfer",
  "fraud_context",
  "identity",
  "password_or_code",
]);

const SAFETY_RULES: SafetyRule[] = [
  {
    domain: "medication",
    riskFlagType: "medication_change",
    severity: "high",
    riskLevel: "medical",
    highRisk: true,
    patterns: [
      /降压药|胰岛素|处方药|药量|剂量|用药|服药|停药|换药|改药|加药|减药/,
      /\b(medication|medicine|dose|dosage|prescription|pill|pills|insulin)\b/i,
    ],
  },
  {
    domain: "medical",
    riskFlagType: "medical_advice",
    severity: "medium",
    riskLevel: "medical",
    highRisk: false,
    patterns: [
      /医生|医院|门诊|复查|血压|血糖|诊断|治疗|手术|检查报告/,
      /\b(doctor|hospital|clinic|diagnosis|treatment|surgery|blood pressure|blood sugar)\b/i,
    ],
  },
  {
    domain: "identity",
    riskFlagType: "identity_document",
    severity: "high",
    riskLevel: "sensitive",
    highRisk: true,
    patterns: [
      /身份证|身份证号|护照|社保卡|医保卡|银行卡号/,
      /\b(identity card|id card|passport|social security|medicare card|bank card)\b/i,
    ],
  },
  {
    domain: "password_or_code",
    riskFlagType: "password_or_code",
    severity: "high",
    riskLevel: "sensitive",
    highRisk: true,
    patterns: [
      /密码|验证码|校验码|取款码|支付码|短信码|动态码|PIN码/,
      /\b(password|passcode|verification code|security code|one-time code|otp|pin)\b/i,
    ],
  },
  {
    domain: "financial_transfer",
    riskFlagType: "financial_transfer",
    severity: "high",
    riskLevel: "financial",
    highRisk: true,
    patterns: [
      /转账|汇款|打钱|转钱|付款码|收款码|转给/,
      /\b(bank transfer|wire transfer|transfer money|send money|wire money|send funds)\b/i,
    ],
  },
  {
    domain: "fraud_context",
    riskFlagType: "fraud_suspected",
    severity: "high",
    riskLevel: "fraud_risk",
    highRisk: true,
    patterns: [
      /诈骗|骗子|被骗|陌生人.*(转账|汇款|验证码|身份证|银行卡)|客服.*(转账|验证码)|公安.*安全账户|补贴.*(身份证|验证码)|投资群|刷单|中奖/,
      /\b(scam|fraud|fraudulent|suspicious)\b/i,
      /\bstranger\b.*\b(transfer|money|code|password|identity|id card)\b/i,
    ],
  },
  {
    domain: "privacy",
    riskFlagType: "location_sensitive",
    severity: "medium",
    riskLevel: "sensitive",
    highRisk: false,
    patterns: [
      /隐私|不要告诉|别告诉|不想分享|住址|家庭地址|门牌号|门禁/,
      /\b(privacy|private|do not share|don't share|do not tell|address|home address|gate code)\b/i,
    ],
  },
];

function scanSafetyDomains(transcript: string): SafetyHit[] {
  const hits: SafetyHit[] = [];
  for (const rule of SAFETY_RULES) {
    const match = firstMatch(transcript, rule.patterns);
    if (!match) continue;
    hits.push({ rule, startChar: match.startChar, endChar: match.endChar });
  }
  return hits;
}

function firstMatch(input: string, patterns: RegExp[]): { startChar: number; endChar: number } | undefined {
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (!match || match.index === undefined) continue;
    return { startChar: match.index, endChar: match.index + match[0].length };
  }
  return undefined;
}

function applySourceSafetyRepairs(
  plan: MemoryPlan,
  source: MemorySource,
  hits: SafetyHit[],
  repairs: RiskGuardrailRepair[],
): void {
  if (hits.length === 0) return;

  const domains = uniqueDomains(hits);
  const targetRiskLevel = highestRiskLevel(hits.map((hit) => hit.rule.riskLevel));
  const confirmationEventIndexes: number[] = [];
  const raisedRiskEventIndexes: number[] = [];

  for (let eventIndex = 0; eventIndex < plan.events.length; eventIndex += 1) {
    const event = plan.events[eventIndex];
    if (!event) continue;
    if (!event.requiresConfirmation) confirmationEventIndexes.push(eventIndex);
    event.requiresConfirmation = true;

    if (targetRiskLevel && RISK_LEVEL_PRIORITY[targetRiskLevel] > RISK_LEVEL_PRIORITY[event.riskLevel]) {
      event.riskLevel = targetRiskLevel;
      raisedRiskEventIndexes.push(eventIndex);
    }
  }

  if (confirmationEventIndexes.length > 0) {
    repairs.push({
      action: "event_confirmation_required",
      reason: "source_safety_scan",
      domains,
      eventIndexes: confirmationEventIndexes,
    });
  }

  if (raisedRiskEventIndexes.length > 0 && targetRiskLevel) {
    repairs.push({
      action: "event_risk_level_raised",
      reason: "source_safety_scan",
      domains,
      eventIndexes: raisedRiskEventIndexes,
      riskLevel: targetRiskLevel,
    });
  }

  for (const hit of hits) {
    if (plan.riskFlags.some((risk) => risk.type === hit.rule.riskFlagType)) continue;
    plan.riskFlags.push({
      type: hit.rule.riskFlagType,
      severity: hit.rule.severity,
      summary: riskFlagSummary(hit.rule.riskFlagType),
      reason: riskFlagReason(hit.rule.domain),
      requiresFamilyReview: hit.rule.highRisk,
      requiresHumanConfirmation: true,
      evidence: [{
        sourceId: source.id,
        startChar: hit.startChar,
        endChar: hit.endChar,
      }],
    });
    repairs.push({
      action: "risk_flag_added",
      reason: "source_safety_scan",
      domains: [hit.rule.domain],
      riskFlagType: hit.rule.riskFlagType,
    });
  }

  const highRiskDomains = uniqueDomains(hits.filter((hit) => hit.rule.highRisk && REVIEW_TASK_DOMAINS.has(hit.rule.domain)));
  if (highRiskDomains.length > 0 && !hasHighUrgencyRiskReview(plan)) {
    plan.familyTasks.push({
      type: "risk_review",
      title: "请家属核查安全风险",
      summary: "确定性安全扫描命中高风险安全领域，需要人工确认后再处理。",
      urgency: "high",
      visibility: "family_required",
    });
    repairs.push({
      action: "family_task_added",
      reason: "source_safety_scan",
      domains: highRiskDomains,
      familyTaskType: "risk_review",
    });
  }
}

function enforceRiskFlagReview(
  plan: MemoryPlan,
  sourceHitRiskFlagTypes: Set<RiskFlagType>,
  repairs: RiskGuardrailRepair[],
): void {
  for (const risk of plan.riskFlags) {
    const highRisk = HIGH_REVIEW_RISK_FLAGS.has(risk.type);
    const sourceHit = sourceHitRiskFlagTypes.has(risk.type);
    const nextRequiresHumanConfirmation = risk.requiresHumanConfirmation || highRisk || sourceHit;
    const nextRequiresFamilyReview = risk.requiresFamilyReview || highRisk;
    if (
      nextRequiresHumanConfirmation === risk.requiresHumanConfirmation &&
      nextRequiresFamilyReview === risk.requiresFamilyReview
    ) {
      continue;
    }

    risk.requiresHumanConfirmation = nextRequiresHumanConfirmation;
    risk.requiresFamilyReview = nextRequiresFamilyReview;
    repairs.push({
      action: "risk_flag_review_required",
      reason: highRisk ? "high_risk_flag" : "source_safety_scan",
      riskFlagType: risk.type,
    });
  }
}

function highestRiskLevel(levels: RiskLevel[]): RiskLevel | undefined {
  return levels.reduce<RiskLevel | undefined>((highest, level) => {
    if (!highest) return level;
    return RISK_LEVEL_PRIORITY[level] > RISK_LEVEL_PRIORITY[highest] ? level : highest;
  }, undefined);
}

function uniqueDomains(hits: SafetyHit[]): SafetyDomain[] {
  return [...new Set(hits.map((hit) => hit.rule.domain))];
}

function hasHighUrgencyRiskReview(plan: MemoryPlan): boolean {
  return plan.familyTasks.some((task) =>
    task.type === "risk_review" &&
    task.urgency === "high" &&
    task.visibility === "family_required"
  );
}

function riskFlagSummary(type: RiskFlagType): string {
  switch (type) {
    case "financial_transfer":
      return "来源内容可能涉及转账或汇款。";
    case "fraud_suspected":
      return "来源内容包含疑似诈骗或陌生人诱导信息。";
    case "identity_document":
      return "来源内容可能涉及身份证件信息。";
    case "location_sensitive":
      return "来源内容可能涉及隐私或敏感位置信息。";
    case "medical_advice":
      return "来源内容包含医疗相关安全信息。";
    case "medication_change":
      return "来源内容可能涉及用药或剂量变化。";
    case "password_or_code":
      return "来源内容可能涉及密码或验证码。";
  }
}

function riskFlagReason(domain: SafetyDomain): string {
  switch (domain) {
    case "financial_transfer":
      return "确定性安全扫描命中转账相关表达，需要人工确认。";
    case "fraud_context":
      return "确定性安全扫描命中疑似诈骗上下文，需要人工确认。";
    case "identity":
      return "确定性安全扫描命中证件信息相关表达，需要人工确认。";
    case "medical":
      return "确定性安全扫描命中医疗相关表达，需要人工确认。";
    case "medication":
      return "确定性安全扫描命中用药相关表达，需要人工确认。";
    case "password_or_code":
      return "确定性安全扫描命中密码或验证码相关表达，需要人工确认。";
    case "privacy":
      return "确定性安全扫描命中隐私相关表达，需要人工确认。";
  }
}
