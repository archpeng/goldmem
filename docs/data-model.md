# Initial Data Model

This document defines the first PostgreSQL truth-source tables. semantic recall index is the multilingual recall engine, not the source of business truth.

## users

- id
- name
- role: elder | family | admin
- phone
- created_at

## elder_profiles

- id
- user_id
- display_name
- timezone
- created_at

## family_links

- id
- elder_id
- family_user_id
- relationship
- permission_level
- created_at

## memory_sources

- id
- elder_id
- type: voice | text | family_input
- audio_url
- transcript
- asr_confidence
- created_at
- local_created_at

## memory_events

- id
- elder_id
- source_id
- type
- title
- summary
- event_time_start
- event_time_end
- time_confidence
- importance
- confidence
- risk_level
- requires_confirmation
- visibility
- status
- created_at

## memory_entities

- id
- elder_id
- type
- name
- aliases
- created_at

## memory_event_entities

- event_id
- entity_id
- relation

## reminders

- id
- elder_id
- source_id
- event_id
- title
- description
- remind_at
- status
- confirmation_required
- confidence
- reason
- confirmed_by
- confirmed_at
- created_at

## risk_flags

- id
- elder_id
- source_id
- event_id
- type
- severity
- summary
- requires_family_review
- created_at

## family_tasks

- id
- elder_id
- family_user_id
- type
- title
- summary
- status
- visibility
- urgency
- related_event_id
- confirmed_by
- confirmed_at
- created_at

## feedback

- id
- elder_id
- source_id
- event_id
- actor_user_id
- feedback_type
- correction_json
- created_at

## audit_logs

- id
- elder_id
- source_id
- type
- payload_json
- created_at

## Implementation status

The first concrete truth-store implementation uses Drizzle + PostgreSQL.

- Schema source: `packages/memory-store/src/postgres-schema.ts`
- Migration directory: `infra/db/migrations`
- Drizzle config: `drizzle.config.ts`

Pgvector semantic recall memory is a rebuildable auxiliary index in PostgreSQL. Every canonical write must carry `sourceId` and, when available, `eventId` metadata so its contents remain traceable to PostgreSQL truth records.
