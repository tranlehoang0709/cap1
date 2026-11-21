-- REVIEW ONLY. No statement in this file has been applied.
-- Design target: the existing aiva_iot 37-table schema.

-- Group II: keep soft deletion distinct from cancellation; keep PA-15 ordinal
-- distinct from step_order until the product contract proves equivalence.
ALTER TABLE personal_tasks
  ADD COLUMN deleted_at DATETIME NULL,
  ADD COLUMN session_number INT NULL,
  ADD COLUMN event_id BIGINT NULL,
  ADD COLUMN cancelled_at DATETIME NULL,
  ADD COLUMN cancel_reason VARCHAR(500) NULL,
  ADD INDEX idx_pa_tasks_event (event_id),
  ADD CONSTRAINT fk_pa_tasks_event FOREIGN KEY (event_id)
    REFERENCES personal_events (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- A plan can declare sessions that have not yet been materialized. Backfill
-- total_sessions from verified plan data before enforcing a NOT NULL contract.
-- Preferred: keep start_date/end_date as API fields and map to the existing
-- start_at/target_end_at after date and timezone rules are approved.
ALTER TABLE personal_plans
  ADD COLUMN deleted_at DATETIME NULL,
  ADD COLUMN total_sessions INT NULL;

-- Alternative ONLY if calendar dates must be stored independently of the
-- instants. Approve one strategy, not both.
-- ALTER TABLE personal_plans
--   ADD COLUMN start_date DATE NULL,
--   ADD COLUMN end_date DATE NULL;

-- Preserve the 500-character text contract. Continue to use title for the
-- short label and reminder_deliveries.idempotency_key for stable alert keys.
ALTER TABLE personal_reminders
  ADD COLUMN message VARCHAR(500) NULL;

-- Calendar alternative that keeps 37 tables. The event owns the receipts
-- for its own voice changes. Do not store them in audit_logs or reminders.
ALTER TABLE personal_events
  ADD COLUMN voice_create_key BINARY(32) NULL,
  ADD COLUMN voice_mutation_receipts JSON NULL,
  ADD UNIQUE KEY uq_pa_event_voice_create (user_id, voice_create_key);

-- Prepare returns a short-lived signed confirmation bound to the authorized
-- user/device and server session, operation ID/action, canonical request
-- digest, target event ID and target state digest for update/cancel.
-- Verify active device proof and ownership again in the write transaction.
-- Take the existing user row lock for conflict serialization and the target
-- event row lock for update/cancel; recheck the target digest before mutation.
-- Authoring clients must not replace voice_mutation_receipts as part of edits.
--
-- Create stores a hash of the server operation ID as voice_create_key and
-- writes the result receipt in the same INSERT. A duplicate unique key must
-- resolve to the stored request receipt, or return conflict for a mismatch.
-- Update/cancel stores a receipt in JSON keyed by operation ID on the target.
-- Scope retries to the same target and verify user/device/session/action and
-- payload hash before returning the same event ID and outcome. Retain
-- cancelled events and receipts for retries; no generic hard-delete endpoint.
-- A signed confirmation past expiry cannot be executed, even if its receipt
-- has been pruned. Bound JSON size and keep unexpired receipts; on reaching
-- capacity reject new writes rather than evicting live receipts.
-- Review receipt retention and every existing event writer before enabling.
