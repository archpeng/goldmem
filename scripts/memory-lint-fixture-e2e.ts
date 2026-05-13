import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { runMemoryLint } from "./memory-lint.js";

const databaseUrl = requiredEnv("DATABASE_URL");
const tenantId = process.env.MEMORY_LINT_E2E_TENANT_ID ?? "tenant-mvp";
const elderId = process.env.MEMORY_LINT_E2E_ELDER_ID ?? `memory-lint-e2e-${Date.now()}`;
const pool = new Pool({ connectionString: databaseUrl });

try {
  await seedDirtyState(pool, tenantId, elderId);
  const report = await runMemoryLint({ databaseUrl, scope: { tenantId, elderId } });
  const types = new Set(report.findings.map((finding) => finding.type));
  const requiredTypes = [
    "reminder_confirmation_state_conflict",
    "semantic_metadata_missing_provenance",
    "graphiti_source_provenance_unaligned",
    "graphiti_event_provenance_unaligned",
    "context_link_orphan",
    "high_risk_visibility_violation",
    "family_assist_raw_leak_marker",
    "stale_pending_family_task",
  ];
  for (const type of requiredTypes) {
    assert(types.has(type), `memory lint fixture missing finding type ${type}`);
  }
  assert(report.counts.high >= 5, `expected at least 5 high severity findings, got ${report.counts.high}`);
  assert(report.findings.every((finding) => finding.status === "open"), "all fixture findings should be open");
  console.log(JSON.stringify({ ok: true, tenantId, elderId, counts: report.counts, types: [...types].sort() }, null, 2));
} finally {
  await cleanupDirtyState(pool, tenantId, elderId);
  await pool.end();
}

async function seedDirtyState(pool: Pool, tenantId: string, elderId: string): Promise<void> {
  await cleanupDirtyState(pool, tenantId, elderId);
  const now = new Date();
  const old = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
  const sourceId = `lint-source-${randomUUID()}`;
  const eventId = `lint-event-${randomUUID()}`;
  const reminderId = `lint-reminder-${randomUUID()}`;
  const familyTaskId = `lint-family-${randomUUID()}`;
  const contextLinkId = `lint-context-${randomUUID()}`;
  const semanticId = `lint-semantic-${randomUUID()}`;
  const provenanceId = `lint-provenance-${randomUUID()}`;

  await pool.query(
    `
      insert into memory_sources (id, tenant_id, elder_id, type, transcript, created_at, metadata)
      values ($1, $2, $3, 'text', 'lint fixture source', $4, '{}'::jsonb)
    `,
    [sourceId, tenantId, elderId, now],
  );
  await pool.query(
    `
      insert into memory_events (
        id, tenant_id, elder_id, source_id, type, title, summary, time_text,
        time_confidence, entities, importance, confidence, risk_level,
        requires_confirmation, visibility, evidence, status, created_at
      )
      values (
        $1, $2, $3, $4, 'finance', 'lint fixture financial event',
        'financial event with invalid private visibility', 'today',
        0.8, '[]'::jsonb, 0.8, 0.8, 'financial',
        true, 'private', $5::jsonb, 'active', $6
      )
    `,
    [eventId, tenantId, elderId, sourceId, JSON.stringify([{ sourceId, quote: "financial fixture" }]), now],
  );
  await pool.query(
    `
      insert into reminders (
        id, tenant_id, elder_id, source_id, event_id, title, description, time_text,
        remind_at, time_confidence, status, confirmation_required, confidence,
        reason, confirmed_by, confirmed_at, created_at
      )
      values ($1, $2, $3, $4, $5, 'lint confirmed reminder', null, 'today',
        $6, 0.8, 'confirmed', true, 0.9, 'fixture conflict', 'elder', $6, $6)
    `,
    [reminderId, tenantId, elderId, sourceId, eventId, now],
  );
  await pool.query(
    `
      insert into memory_context_links (
        id, tenant_id, elder_id, from_event_id, to_event_id, reminder_id,
        type, status, confidence, reason, evidence, created_at
      )
      values ($1, $2, $3, $4, 'missing-event-id', 'missing-reminder-id',
        'possibly_related', 'active', 0.9, 'fixture orphan link', '[]'::jsonb, $5)
    `,
    [contextLinkId, tenantId, elderId, eventId, now],
  );
  await pool.query(
    `
      insert into family_tasks (
        id, tenant_id, elder_id, type, title, summary, status, visibility,
        urgency, related_event_id, created_at
      )
      values ($1, $2, $3, 'risk_review', 'RAW_TRANSCRIPT leaked fixture',
        'RAW_TRANSCRIPT: full original words should not be here', 'pending',
        'family_required', 'high', $4, $5)
    `,
    [familyTaskId, tenantId, elderId, eventId, old],
  );
  await pool.query(
    `
      insert into semantic_memories (
        id, tenant_id, elder_id, source_id, event_id, memory, metadata_json, embedding, created_at
      )
      values ($1, $2, $3, null, null, 'semantic fixture missing provenance',
        '{}'::jsonb, $4::vector, $5)
    `,
    [semanticId, tenantId, elderId, vectorLiteral(1536), now],
  );
  await pool.query(
    `
      insert into graphiti_episode_provenance (
        id, group_id, tenant_id, elder_id, episode_name, source_ids, event_ids,
        metadata_json, body_text, body_hash, reference_time, created_at
      )
      values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb,
        '{}'::jsonb, 'graphiti provenance fixture', 'fixture-hash', $8, $8)
    `,
    [
      provenanceId,
      `tenant-${tenantId}-elder-${elderId}`,
      tenantId,
      elderId,
      `lint-fixture-${randomUUID()}`,
      JSON.stringify(["missing-source-id"]),
      JSON.stringify(["missing-event-id"]),
      now,
    ],
  );
}

async function cleanupDirtyState(pool: Pool, tenantId: string, elderId: string): Promise<void> {
  await pool.query("delete from graphiti_episode_provenance where tenant_id = $1 and elder_id = $2", [tenantId, elderId]);
  await pool.query("delete from semantic_memories where tenant_id = $1 and elder_id = $2", [tenantId, elderId]);
  await pool.query("delete from memory_context_links where tenant_id = $1 and elder_id = $2", [tenantId, elderId]);
  await pool.query("delete from family_tasks where tenant_id = $1 and elder_id = $2", [tenantId, elderId]);
  await pool.query("delete from reminders where tenant_id = $1 and elder_id = $2", [tenantId, elderId]);
  await pool.query("delete from memory_events where tenant_id = $1 and elder_id = $2", [tenantId, elderId]);
  await pool.query("delete from memory_sources where tenant_id = $1 and elder_id = $2", [tenantId, elderId]);
}

function vectorLiteral(dimensions: number): string {
  return `[${Array.from({ length: dimensions }, () => "0").join(",")}]`;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
