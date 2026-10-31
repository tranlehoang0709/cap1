# D2S205 — Monitoring & Heartbeat — 2026-10-30

## Requirement / implementation

Implemented heartbeat input/proof validation, monotonic lastSeen and online state,
conditional telemetry persistence, fresh reconnect, timeout offline materialization,
Admin/User monitoring APIs and lifecycle-managed presence sweeper. User explicitly
approved **60 seconds** when asked; it is the default and `.env.example` value.
No pre-existing heartbeat presence setting was found in repo/DB. Firmware MQTT ping
90 seconds is not a Backend timeout and cannot alone maintain 60-second presence.

API consumer entry point updated: `../API_CONTRACT.md`, section 8.

## Files / dependencies

Filled monitoring.controller.ts, monitoring.service.ts, monitoring.module.ts.
Added monitoring.repository.ts, dto/heartbeat.dto.ts, presence-sweeper.ts;
test/monitoring.spec.ts, test/monitoring.http.spec.ts and
scripts/check-monitoring-readonly.cjs. Changed DevicesModule to export OwnershipService,
OwnershipService to expose reusable connection-scoped ownership/device-proof checks,
app.module.ts registration, configuration.ts validation, .env.example and API contract.
No dependencies, schema, indexes, triggers, firmware, frontend or AI Server changed.

Reuses InternalDeviceGuard (AI_DEVICE_SERVICE_TOKEN + Device Auth approval gate),
AdminDeviceGuard/UserPairingGuard/JWT, OwnershipTransaction and Prompt 2's parent device/
assignment/user locks. Device proof + heartbeat are checked on one mysql2 transaction.
Admin monitoring rechecks persisted account and role inside the device transaction.
No fake identity is derived from ai_server_instances; per-instance auth is not yet agreed.

Function mapping: validateHeartbeatSource = InternalDeviceGuard plus
OwnershipService.validateAuthorizedDevice; processHeartbeat = MonitoringService;
updateDevicePresence/saveDeviceTelemetry/markDeviceOffline = MonitoringTransaction;
calculateDeviceStatus = exported pure helper; getDeviceMonitoring = MonitoringService;
handleDeviceReconnect = the fresh-event branch of processHeartbeat (no duplicate
reconnect endpoint/service). markExpiredDevicesOffline is the conditional batch helper.

## Execution flow / design

Heartbeat source guard -> strict DTO -> credential/approved ownership/lifecycle checks
under parent lock -> DB UTC time/lastSeen -> reject future, ignore stale/duplicate ->
conditional online/lastSeen update -> optional telemetry insert -> commit. A telemetry
failure rolls back presence. LastSeen uses trusted AI Server event receipt time, not
retry time. UTC whole-second precision matches the existing DATETIME schema and gives
durable duplicate suppression via last_seen_at; no in-memory dedupe cache is needed.
One accepted sample per device/second is the explicit contract limit, not arbitrary
eventId exactly-once support. No metrics means no unnecessary telemetry row.

Monitoring uses current approved User assignment authorization (or persisted Admin),
computes online/offline from DB now and 60 seconds, and projects latest supported
sample without payload/credentials. Never changes assignment/lifecycle. GET can
materialize offline using a conditional update. Background worker ticks once per
timeout with no overlap; conditional batch UPDATE protects newly reconnected rows.
During review, the batch predicate deliberately excluded lastSeen>statement-now:
a statement waiting on a lock must not misclassify a just-committed heartbeat as future.
Materialized list state may lag the exact deadline by a sweep cadence; Monitoring
calculates presence at read time. No new scheduler package was introduced.

## Verification

Final executed command evidence:

- PASS — `npm.cmd run build`.
- PASS — `npm.cmd test`: 12 suites / 322 tests; 58 new monitoring/helper tests plus all 264
  existing Prompt 1–4/User/configuration regression tests.
- PASS — `node scripts/check-monitoring-readonly.cjs`: actual metadata and SELECT/
  locking reads; EXPLAIN uses idx_device_telemetry_device_id_recorded_at with backward
  index scan. PREPARE/DEALLOCATE validated update/insert SQL syntax without executing DML.
- PASS — `git diff --check`; Windows line-ending notices only.

No fixtures, telemetry rows, device updates, timeout jobs or schema changes executed
against the live DB during development. Sweeper is tested with fake timers, not started
against production data. Running the Backend with defaults later enables the periodic
presence writer as documented.

## Acceptance matrix

| Criterion | Result / evidence |
|---|---|
| Valid heartbeat updates lastSeen/online + telemetry | PASS service model + HTTP + prepared SQL syntax |
| Invalid source/device/credential denied | PASS real guard HTTP, reused device authorization regression, unknown-device policy |
| Timeout at >=60 seconds -> offline | PASS boundary/service tests, approved config validation |
| Fresh reconnect -> online | PASS state transition tests |
| Offline retains assignment/lifecycle | PASS unchanged model ownership and SQL field review |
| Duplicate/stale/out-of-order cannot corrupt | PASS timestamp watermark + transaction model tests |
| Optional/malformed telemetry and payload | PASS DTO boundaries, empty sample suppression, SQL binding tests |
| User cannot monitor another User robot | PASS 404 HTTP/ownership delegation and previous isolation regression |
| Admin monitoring authorization | PASS HTTP and transaction persisted Admin check |
| Concurrent heartbeat/timeout | PASS both serialized state-model orderings + conditional SQL assertions; live populated two-connection race NOT VERIFIED |
| Telemetry failure rollback/release | PASS service model and repository failure/commit tests |
| Sweeper cadence/no overlap/shutdown | PASS fake timer lifecycle tests |
| Prompt 1–4 regressions | PASS full backend suite |
| No data/schema changes during development | PASS executed commands/diff; PREPARE is not EXECUTE |

## Blockers / readiness

Device Auth/credential provisioning and heartbeat forwarding contract still need
AI Server/Firmware agreement (Prompt 3 gate remains false by default). The hardware/
AI Server is not changed to send these events. Clock synchronization and cadence <60
seconds are integration prerequisites. Raw firmware timestamps/retries must not be
presented as fresh receipt events. No tolerance or heartbeat interval was invented.
No real populated MySQL INSERT/timeout race/rollback or hardware disconnect/reconnect
was run; state-model tests and SQL syntax checks are not engine/hardware proof.
Full end-to-end DoD is therefore not claimed complete. Prompt 6 can use parent-device
lock ordering and ownership/proof helpers for revoke/reset, preserving lastSeen and
invalidating sessions separately from offline presence.

## Recovery

No commit/push; pre-task HEAD c7ad00e with prior prompt/user changes uncommitted.
Preserve unrelated work. To recover Prompt 5, remove its monitoring files/tests/script/
registration/config fields; restore OwnershipService wrappers and DevicesModule export
only if no consumers remain. No DB rollback needed for development (no DML executed).
For deployment, HEARTBEAT_SWEEPER_ENABLED=false disables background writes; stop
forwarding heartbeat before reverting the endpoint. Never delete assignment/history
as a way to mark a robot offline.
