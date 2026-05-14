import { Pool } from "pg";

type Severity = "low" | "medium" | "high";

export type MemoryLintFinding = {
  id: string;
  severity: Severity;
  type: string;
  entityType: string;
  entityId: string;
  tenantId?: string;
  elderId?: string;
  reason: string;
  owner: string;
  suggestedAction: string;
  status: "open" | "accepted_risk";
};

export type MemoryLintReport = {
  ok: boolean;
  generatedAt: string;
  scope: { tenantId?: string; elderId?: string; includeTestData?: boolean };
  counts: Record<Severity, number>;
  findings: MemoryLintFinding[];
};

type Scope = { tenantId?: string; elderId?: string; includeTestData?: boolean };

export async function runMemoryLint(input: { databaseUrl: string; scope?: Scope; maxFindings?: number }): Promise<MemoryLintReport> {
  const pool = new Pool({ connectionString: input.databaseUrl });
  const findings: MemoryLintFinding[] = [];
  const maxFindings = input.maxFindings ?? 500;
  const scope = input.scope ?? {};
  try {
    await lintReminderConfirmation(pool, scope, findings);
    await lintSemanticMetadata(pool, scope, findings);
    await lintGraphitiProvenance(pool, scope, findings);
    await lintContextLinks(pool, scope, findings);
    await lintVisibility(pool, scope, findings);
    await lintFamilyAssistPrivacy(pool, scope, findings);
    await lintPendingFamilyTasks(pool, scope, findings);
  } finally {
    await pool.end();
  }

  const limited = findings.slice(0, maxFindings);
  const counts = countFindings(limited);
  return {
    ok: counts.high === 0,
    generatedAt: new Date().toISOString(),
    scope,
    counts,
    findings: limited,
  };
}

async function lintReminderConfirmation(pool: Pool, scope: Scope, findings: MemoryLintFinding[]): Promise<void> {
  const filter = scopedFilter("r", scope);
  const result = await pool.query(
    `
      select r.id, r.tenant_id, r.elder_id, r.status
      from reminders r
      where r.confirmation_required = true
        and r.status in ('confirmed', 'scheduled', 'sent', 'done', 'cancelled', 'expired')
        ${filter.sql}
      order by r.created_at desc
      limit 200
    `,
    filter.values,
  );
  for (const row of result.rows) {
    findings.push(finding({
      severity: "high",
      type: "reminder_confirmation_state_conflict",
      entityType: "reminder",
      entityId: row.id,
      tenantId: row.tenant_id,
      elderId: row.elder_id,
      reason: `Reminder is ${row.status} but confirmationRequired is still true.`,
      owner: "reminder-engine",
      suggestedAction: "Persist confirmationRequired=false when reminder leaves pending confirmation states.",
    }));
  }
}

async function lintSemanticMetadata(pool: Pool, scope: Scope, findings: MemoryLintFinding[]): Promise<void> {
  if (!(await tableExists(pool, "semantic_memories"))) {
    findings.push(systemFinding("semantic_memories_missing", "semantic_memories table is missing.", "memory-store"));
    return;
  }
  const filter = scopedFilter("s", scope);
  const result = await pool.query(
    `
      select s.id, s.tenant_id, s.elder_id, s.source_id, s.event_id
      from semantic_memories s
      where (
        coalesce(s.metadata_json->>'sourceId', '') = ''
        or coalesce(s.metadata_json->>'summary', '') = ''
        or s.source_id is null
      )
        ${filter.sql}
      order by s.created_at desc
      limit 200
    `,
    filter.values,
  );
  for (const row of result.rows) {
    findings.push(finding({
      severity: "high",
      type: "semantic_metadata_missing_provenance",
      entityType: "semantic_memory",
      entityId: row.id,
      tenantId: row.tenant_id,
      elderId: row.elder_id,
      reason: "Semantic recall row is missing sourceId or PostgreSQL-derived summary metadata.",
      owner: "memory-store",
      suggestedAction: "Rebuild semantic index from PostgreSQL MemoryEvent summaries.",
    }));
  }
}

async function lintGraphitiProvenance(pool: Pool, scope: Scope, findings: MemoryLintFinding[]): Promise<void> {
  if (!(await tableExists(pool, "graphiti_episode_provenance"))) {
    findings.push(systemFinding("graphiti_provenance_missing", "graphiti_episode_provenance table is missing.", "temporal-memory"));
    return;
  }
  const filter = scopedFilter("p", scope);
  const missingSources = await pool.query(
    `
      select p.id, p.tenant_id, p.elder_id, p.episode_name, source_ref.source_id
      from graphiti_episode_provenance p
      cross join lateral jsonb_array_elements_text(p.source_ids) as source_ref(source_id)
      left join memory_sources s on s.tenant_id = p.tenant_id and s.id = source_ref.source_id
      where s.id is null
        ${filter.sql}
      order by p.created_at desc
      limit 200
    `,
    filter.values,
  );
  for (const row of missingSources.rows) {
    findings.push(finding({
      severity: "high",
      type: "graphiti_source_provenance_unaligned",
      entityType: "graphiti_episode_provenance",
      entityId: row.id,
      tenantId: row.tenant_id,
      elderId: row.elder_id,
      reason: `Graphiti episode ${row.episode_name} references missing source ${row.source_id}.`,
      owner: "temporal-memory",
      suggestedAction: "Rebuild or drop the Graphiti episode; evidence must align to PostgreSQL source.",
    }));
  }

  const missingEvents = await pool.query(
    `
      select p.id, p.tenant_id, p.elder_id, p.episode_name, event_ref.event_id
      from graphiti_episode_provenance p
      cross join lateral jsonb_array_elements_text(p.event_ids) as event_ref(event_id)
      left join memory_events e on e.tenant_id = p.tenant_id and e.id = event_ref.event_id
      where e.id is null
        ${filter.sql}
      order by p.created_at desc
      limit 200
    `,
    filter.values,
  );
  for (const row of missingEvents.rows) {
    findings.push(finding({
      severity: "high",
      type: "graphiti_event_provenance_unaligned",
      entityType: "graphiti_episode_provenance",
      entityId: row.id,
      tenantId: row.tenant_id,
      elderId: row.elder_id,
      reason: `Graphiti episode ${row.episode_name} references missing event ${row.event_id}.`,
      owner: "temporal-memory",
      suggestedAction: "Rebuild or drop the Graphiti episode; evidence must align to PostgreSQL event.",
    }));
  }
}

async function lintContextLinks(pool: Pool, scope: Scope, findings: MemoryLintFinding[]): Promise<void> {
  const filter = scopedFilter("c", scope);
  const result = await pool.query(
    `
      select c.id, c.tenant_id, c.elder_id, c.from_event_id, c.to_event_id, c.reminder_id,
        from_event.id as from_exists,
        to_event.id as to_exists,
        reminder.id as reminder_exists
      from memory_context_links c
      left join memory_events from_event on from_event.tenant_id = c.tenant_id and from_event.id = c.from_event_id
      left join memory_events to_event on to_event.tenant_id = c.tenant_id and to_event.id = c.to_event_id
      left join reminders reminder on reminder.tenant_id = c.tenant_id and reminder.id = c.reminder_id
      where (from_event.id is null or to_event.id is null or (c.reminder_id is not null and reminder.id is null))
        ${filter.sql}
      order by c.created_at desc
      limit 200
    `,
    filter.values,
  );
  for (const row of result.rows) {
    findings.push(finding({
      severity: "medium",
      type: "context_link_orphan",
      entityType: "memory_context_link",
      entityId: row.id,
      tenantId: row.tenant_id,
      elderId: row.elder_id,
      reason: "Context link references a missing event or reminder.",
      owner: "memory-kernel",
      suggestedAction: "Reject orphan context links at write time or remove stale links during review.",
    }));
  }
}

async function lintVisibility(pool: Pool, scope: Scope, findings: MemoryLintFinding[]): Promise<void> {
  const filter = scopedFilter("e", scope);
  const highRisk = await pool.query(
    `
      select e.id, e.tenant_id, e.elder_id, e.risk_level, e.visibility
      from memory_events e
      where e.risk_level in ('financial', 'fraud_risk')
        and e.visibility <> 'family_required'
        ${filter.sql}
      order by e.created_at desc
      limit 200
    `,
    filter.values,
  );
  for (const row of highRisk.rows) {
    findings.push(finding({
      severity: "high",
      type: "high_risk_visibility_violation",
      entityType: "memory_event",
      entityId: row.id,
      tenantId: row.tenant_id,
      elderId: row.elder_id,
      reason: `${row.risk_level} event has visibility=${row.visibility}, expected family_required.`,
      owner: "permission-engine",
      suggestedAction: "Route financial/fraud events through deterministic permission enforcement.",
    }));
  }

  const sensitiveFullShare = await pool.query(
    `
      select e.id, e.tenant_id, e.elder_id, e.risk_level, e.visibility
      from memory_events e
      where e.risk_level in ('medical', 'sensitive')
        and e.visibility = 'shared_full'
        ${filter.sql}
      order by e.created_at desc
      limit 200
    `,
    filter.values,
  );
  for (const row of sensitiveFullShare.rows) {
    findings.push(finding({
      severity: "medium",
      type: "sensitive_full_share_visibility",
      entityType: "memory_event",
      entityId: row.id,
      tenantId: row.tenant_id,
      elderId: row.elder_id,
      reason: `${row.risk_level} event is shared_full; sensitive records should default to private or summary-only.`,
      owner: "permission-engine",
      suggestedAction: "Review visibility assignment and avoid raw/full sharing for sensitive events.",
    }));
  }
}

async function lintFamilyAssistPrivacy(pool: Pool, scope: Scope, findings: MemoryLintFinding[]): Promise<void> {
  const filter = scopedFilter("f", scope);
  const result = await pool.query(
    `
      select f.id, f.tenant_id, f.elder_id
      from family_tasks f
      where (
        f.title ~* '(raw_transcript|raw transcript|audio_url|audioUrl|fullEvidence|full evidence|debugTrace|debug trace)'
        or f.summary ~* '(raw_transcript|raw transcript|audio_url|audioUrl|fullEvidence|full evidence|debugTrace|debug trace)'
      )
        ${filter.sql}
      order by f.created_at desc
      limit 200
    `,
    filter.values,
  );
  for (const row of result.rows) {
    findings.push(finding({
      severity: "high",
      type: "family_assist_raw_leak_marker",
      entityType: "family_task",
      entityId: row.id,
      tenantId: row.tenant_id,
      elderId: row.elder_id,
      reason: "Family assist task contains raw/debug/evidence leak marker.",
      owner: "memory-kernel",
      suggestedAction: "Family assist DTOs and stored summaries must be minimal summaries, not raw transcript/debug payloads.",
    }));
  }
}

async function lintPendingFamilyTasks(pool: Pool, scope: Scope, findings: MemoryLintFinding[]): Promise<void> {
  const filter = scopedFilter("f", scope);
  const result = await pool.query(
    `
      select f.id, f.tenant_id, f.elder_id, f.created_at
      from family_tasks f
      where f.status = 'pending'
        and f.created_at < now() - interval '7 days'
        ${filter.sql}
      order by f.created_at asc
      limit 200
    `,
    filter.values,
  );
  for (const row of result.rows) {
    findings.push(finding({
      severity: "medium",
      type: "stale_pending_family_task",
      entityType: "family_task",
      entityId: row.id,
      tenantId: row.tenant_id,
      elderId: row.elder_id,
      reason: "Family assist task has been pending for more than 7 days.",
      owner: "memory-kernel",
      suggestedAction: "Triage stale family assist task as resolved, accepted risk, or needs follow-up.",
    }));
  }
}

function scopedFilter(alias: string, scope: Scope): { sql: string; values: string[] } {
  const clauses: string[] = [];
  const values: string[] = [];
  if (scope.tenantId) {
    values.push(scope.tenantId);
    clauses.push(`and ${alias}.tenant_id = $${values.length}`);
  }
  if (scope.elderId) {
    values.push(scope.elderId);
    clauses.push(`and ${alias}.elder_id = $${values.length}`);
  }
  if (!scope.includeTestData) {
    clauses.push(`and ${alias}.tenant_id not like 'mem-smoke%'`);
  }
  return { sql: clauses.join("\n"), values };
}

async function tableExists(pool: Pool, tableName: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>("select to_regclass($1) is not null as exists", [tableName]);
  return result.rows[0]?.exists === true;
}

function finding(input: Omit<MemoryLintFinding, "id" | "status">): MemoryLintFinding {
  return {
    ...input,
    id: `${input.type}:${input.entityType}:${input.entityId}`,
    status: "open",
  };
}

function systemFinding(type: string, reason: string, owner: string): MemoryLintFinding {
  return finding({
    severity: "high",
    type,
    entityType: "system",
    entityId: type,
    reason,
    owner,
    suggestedAction: "Run migrations and verify required memory infrastructure tables exist.",
  });
}

function countFindings(findings: MemoryLintFinding[]): Record<Severity, number> {
  return {
    low: findings.filter((finding) => finding.severity === "low").length,
    medium: findings.filter((finding) => finding.severity === "medium").length,
    high: findings.filter((finding) => finding.severity === "high").length,
  };
}

function severityRank(severity: Severity): number {
  return severity === "high" ? 3 : severity === "medium" ? 2 : 1;
}

function parseSeverity(value: string | undefined): Severity {
  if (value === "low" || value === "medium" || value === "high") return value;
  return "high";
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const failOn = parseSeverity(process.env.MEMORY_LINT_FAIL_ON);
  const report = await runMemoryLint({
    databaseUrl: requiredEnv("DATABASE_URL"),
    scope: {
      tenantId: process.env.MEMORY_LINT_TENANT_ID,
      elderId: process.env.MEMORY_LINT_ELDER_ID,
      includeTestData: process.env.MEMORY_LINT_INCLUDE_TEST_DATA === "true",
    },
    maxFindings: Number(process.env.MEMORY_LINT_MAX_FINDINGS ?? 500),
  });
  console.log(JSON.stringify(report, null, 2));
  const shouldFail = report.findings.some((finding) => severityRank(finding.severity) >= severityRank(failOn));
  if (shouldFail) process.exit(1);
}
