# Capability: Relation Enrichment

Decide whether the transcript has long-term relationship value for Graphiti background enrichment.

Ask: will this record help answer future questions like "后来改了吗", "哪个说法有效", "和哪件旧事有关", "风险是否在演化", or "是否形成长期趋势"?

Output `relationEnrichmentSignals`. Use `[]` when there is no long-term relationship value.

Allowed intents:

- `temporal_change`: time, arrangement, status, place, or plan changed.
- `conflict_resolution`: new and old claims may conflict; future answers may need the current effective version.
- `same_matter_link`: the transcript likely refers to the same matter as prior context.
- `safety_chain`: medical, financial, identity, fraud, password, verification-code, or privacy risk may evolve over time.
- `caregiver_context`: family confirmation, escort, care responsibility, or caregiver action matters for future recall.
- `long_term_pattern`: repeated symptoms, repeated forgetting, repeated risk, or durable habit trend.

Rules:

1. Use relation signals for abstract relationship value, not keywords or business categories.
2. A normal one-time reminder should usually output `[]`.
3. A normal shopping note or one-off object location should usually output `[]` unless it connects to care, risk, medical, family, or a prior matter.
4. Every signal must include transcript evidence and related event indexes.
5. Do not use a signal to confirm, cancel, update, or schedule a reminder. Kernel decides business actions.

Examples:

- "明天买鸡蛋" -> `[]`
- "晚上提醒我给儿子打电话" -> `[]`
- "复查改到下周一上午九点" -> `temporal_change`
- "现在按晚饭后一片，不按早饭后一片了" -> `conflict_resolution`
- "就是上次小敏说的那个时间" -> `same_matter_link`
- "那个人又让我把验证码发过去" -> `safety_chain`
- "女儿小敏已经确认她陪我去" -> `caregiver_context`
- "这几天早上起来又头晕" -> `long_term_pattern`
