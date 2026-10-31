-- REVIEW ONLY: DO NOT EXECUTE without explicit approval to alter the target database.
-- Minimal additive proposal; no new tables, no system_settings request ledger.
-- Legacy rows remain NULL; new admissions must supply a request ID/context and policy.
-- Preflight legacy nonfinal requests, duplicate external IDs and migration locking first.
ALTER TABLE usage_records
  ADD COLUMN request_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN request_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN quota_policy_id BIGINT NULL,
  ADD COLUMN reserved_tokens BIGINT NULL,
  ADD COLUMN report_due_at DATETIME NULL,
  ADD COLUMN report_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN finalized_at DATETIME NULL,
  ADD UNIQUE KEY uq_usage_records_request_id (request_id),
  ADD CONSTRAINT fk_usage_records_quota_policy_id
    FOREIGN KEY (quota_policy_id) REFERENCES quota_policies(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

-- Rollback policy: disable the new admission API and retain ledger columns/data.
-- No DROP script is proposed: dropping identity/reservation history loses retry safety.
