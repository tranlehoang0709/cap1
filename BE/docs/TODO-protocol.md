# Device protocol decisions pending

These HTTP endpoints are preparation interfaces for a future AI Server/device integration. They do not define the Xiaozhi WebSocket wire protocol and must not be configured into production firmware until the firmware owner confirms the protocol contract.

- Confirm the authenticated caller for `/devices/device/me` and `/devices/device/heartbeat`: directly from firmware, an AI Server with a service credential, or both with separate credentials.
- Confirm the credential delivery/provisioning path. The plaintext credential is returned once from the Admin API and only its SHA-256 hash is stored. No credential is logged.
- Confirm heartbeat cadence, offline timeout, telemetry payload schema and whether the AI Server forwards or terminates heartbeats.
- Confirm how pairing code reaches the human/device. Codes are opaque one-time 32-character random values, expire in 1–60 minutes, and are not a device credential.
- Confirm Xiaozhi WebSocket URL, TLS policy, protocol version, hello/session fields, audio framing, and device identity semantics against the approved firmware build.
- The user-unlink workflow currently revokes credentials and unassigns database ownership. Device-side factory reset acknowledgement and recovery backup jobs remain later work because no device control protocol is approved.
