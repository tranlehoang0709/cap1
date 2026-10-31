-- MANUAL MIGRATION PREPARED UNDER APPROVED DESIGN; NOT EXECUTED BY CODE OR TESTS.
-- Execution on the running database is NOT authorized in this task.
-- First test on an isolated V1.5 schema and review existing nonfinal usage records.
-- MySQL ALTER TABLE can lock/rebuild and auto-commit; do not assume transaction rollback.
-- Run once only after an explicit execution approval. No table is added/dropped.
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

-- Preserve ledger columns/data when disabling the feature. Dropping them destroys
-- request/report retry identity. No destructive automatic down migration is provided.
