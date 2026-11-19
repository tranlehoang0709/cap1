# FE BFF → Backend API

Nguồn triển khai: `src/lib/operations.ts`. Chỉ các operation dưới đây được proxy; role được đọc lại qua `/auth/me`. Endpoint Backend không có prefix `/api`. Không có HTTP mock trong ứng dụng.

| Operation | Role | Method | Endpoint thật | Body fields từ browser |
|---|---|---|---|---|
| `chatReadiness` | USER | GET | `/ai/profile` | — |
| `adminUsage` | ADMIN | GET | `/admin/ai/usage` | — |
| `profile` | ANY | GET | `/users/me` | — |
| `profileSave` | ANY | PATCH | `/users/me` | display_name |
| `password` | ANY | PATCH | `/auth/password` | current_password, new_password |
| `privacy` | USER | GET | `/users/me/privacy` | — |
| `privacySave` | USER | PATCH | `/users/me/privacy` | save_history |
| `robots` | USER | GET | `/devices` | — |
| `robotRename` | USER | PATCH | `/devices/:id` | display_name |
| `pair` | USER | POST | `/devices/pairing-requests` | pairing_code |
| `pairings` | USER | GET | `/devices/pairing-requests/mine` | — |
| `assistant` | USER | GET | `/ai/profile` | — |
| `assistantSave` | USER | PATCH | `/ai/profile` | assistant_name, system_prompt, language_code, voice_code |
| `conversations` | USER | GET | `/conversations` | — |
| `conversation` | USER | GET | `/conversations/:id` | — |
| `conversationDelete` | USER | DELETE | `/conversations/:id` | — |
| `chat` | USER | POST | `/web-chat/messages` | content |
| `quotas` | USER | GET | `/quotas` | — |
| `usage` | USER | GET | `/usage` | — |
| `dashboard` | ADMIN | GET | `/admin/dashboard` | — |
| `users` | ADMIN | GET | `/users` | — |
| `userCreate` | ADMIN | POST | `/users` | email, display_name, password |
| `userRole` | ADMIN | PATCH | `/users/:id/role` | role |
| `userStatus` | ADMIN | PATCH | `/users/:id/status` | status |
| `allRobots` | ADMIN | GET | `/devices/admin/all` | — |
| `robotCreate` | ADMIN | POST | `/devices/admin` | device_uid, display_name, hardware_model |
| `pairingCode` | ADMIN | POST | `/devices/admin/:id/pairing-codes` | ttl_minutes |
| `allPairings` | ADMIN | GET | `/devices/admin/pairing-requests` | — |
| `approve` | ADMIN | POST | `/devices/admin/pairing-requests/:id/approve` | note |
| `reject` | ADMIN | POST | `/devices/admin/pairing-requests/:id/reject` | note |
| `recovery` | ADMIN | GET | `/admin/devices/:id/recovery` | — |
| `resetStatus` | ADMIN | GET | `/admin/devices/:id/reset-status` | — |
| `revoke` | ADMIN | POST | `/admin/devices/:id/revoke` | reason |
| `restore` | ADMIN | POST | `/admin/device-recovery/:id/restore` | — |
| `providers` | ADMIN | GET | `/ai/providers` | — |
| `providerSave` | ADMIN | PATCH | `/admin/ai/providers/:id` | is_enabled, health_status |
| `models` | ADMIN | GET | `/admin/ai/models` | — |
| `modelCreate` | ADMIN | POST | `/admin/ai/models` | provider_id, model_code, capability, is_enabled |
| `modelSave` | ADMIN | PATCH | `/admin/ai/models/:id` | model_code, is_enabled |
| `systemKeys` | ADMIN | GET | `/admin/api-keys/system` | — |
| `systemKeyCreate` | ADMIN | POST | `/admin/api-keys/system` | provider_id, label, secret |
| `systemKeyRevoke` | ADMIN | DELETE | `/admin/api-keys/system/:id` | — |
| `allQuotas` | ADMIN | GET | `/admin/quotas` | — |
| `quotaSave` | ADMIN | POST | `/admin/quotas` | user_id, provider_id, requests_per_minute, requests_per_day, tokens_per_month |
| `quotaDelete` | ADMIN | DELETE | `/admin/quotas/:id` | — |
| `firmware` | ADMIN | GET | `/admin/firmware` | — |
| `firmwareCreate` | ADMIN | POST | `/admin/firmware` | hardware_model, version, file_uri, checksum_sha256 |
| `firmwareRelease` | ADMIN | POST | `/admin/firmware/:id/release` | — |
| `instances` | ADMIN | GET | `/admin/monitoring/instances` | — |
| `logs` | ADMIN | GET | `/admin/logs` | — |
| `audits` | ADMIN | GET | `/admin/audit-logs` | — |
| `settings` | ADMIN | GET | `/admin/system-settings` | — |
| `settingSave` | ADMIN | PUT | `/admin/system-settings/:key` | value |

`chatReadiness` là phép đọc qua BFF: kiểm tra catalogue và scope, không phải endpoint Backend mới. `chat` thêm `provider_id` từ cấu hình server; cloud kiểm tra `/user/ai/profile` scope SYSTEM. `assistantSave` giữ lại provider/model từ `/ai/profile` trước PATCH. `revoke` gửi Idempotency-Key.

Auth: POST `/auth/login`, `/auth/register`, `/auth/verify-email`, `/auth/refresh`, `/auth/logout`; GET `/auth/me`. Token pair không được trả xuống browser.
