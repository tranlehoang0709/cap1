"""Dữ liệu mô phỏng trong phiên; không lưu bền vững hoặc truyền ra ngoài."""
from datetime import datetime
from uuid import uuid4

import streamlit as st
from nen_tang.api import AivaApi

PROVIDERS = ["Local AI", "OpenAI", "Gemini"]


def uid(prefix):
    return f"{prefix}-{uuid4().hex[:8]}"


def now():
    # Dùng độ lệch UTC cố định để không cần cơ sở dữ liệu múi giờ trên Windows.
    from datetime import timezone, timedelta
    return datetime.now(timezone(timedelta(hours=7))).strftime("%Y-%m-%d %H:%M:%S")


def init_demo():
    if "demo" in st.session_state:
        st.session_state.setdefault("api", AivaApi())
        return
    st.session_state.identity = None
    st.session_state.api = AivaApi()
    st.session_state.demo = {
        "users": [
            {"id": "admin", "name": "Quản trị viên mẫu", "email": "admin@example.test", "password": "Demo123!", "role": "Admin", "locked": False},
            {"id": "user1", "name": "Minh Anh", "email": "user@example.test", "password": "Demo123!", "role": "User", "locked": False},
            {"id": "user2", "name": "Người dùng mới", "email": "new@example.test", "password": "Demo123!", "role": "User", "locked": False},
        ],
        "devices": [
            {"id": "XB-001", "code": "PAIR001", "name": "Xiaozhi phòng khách", "owner": "user1", "online": True, "heartbeat": "2026-10-10 09:00:00", "battery": 86, "rssi": -48, "firmware": "1.1.0"},
            {"id": "XB-002", "code": "PAIR002", "name": "Xiaozhi bàn làm việc", "owner": None, "online": False, "heartbeat": "2026-10-09 20:00:00", "battery": 42, "rssi": -72, "firmware": "1.0.0"},
            {"id": "XB-003", "code": "PAIR003", "name": "Xiaozhi mới", "owner": None, "online": True, "heartbeat": "2026-10-10 09:00:00", "battery": 95, "rssi": -53, "firmware": "1.1.0"},
            {"id": "XB-004", "code": "PAIR004", "name": "Xiaozhi - Phòng ngủ", "owner": "user1", "online": True, "heartbeat": "2026-10-12 10:45:00", "battery": 72, "rssi": -56, "firmware": "1.1.0"},
            {"id": "XB-005", "code": "PAIR005", "name": "Xiaozhi - Văn phòng", "owner": "user1", "online": False, "heartbeat": "2026-10-11 22:30:00", "battery": 38, "rssi": -68, "firmware": "1.0.0"},
        ],
        "requests": [{"id": "REQ-001", "device": "XB-003", "user": "user2", "status": "Chờ duyệt", "created": "2026-10-10 08:30:00", "note": ""}],
        "providers": {p: {"enabled": True, "model": {"Local AI": "local-model-demo", "OpenAI": "cloud-model-demo", "Gemini": "gemini-model-demo"}[p], "endpoint": "", "status": "Sẵn sàng (mẫu)"} for p in PROVIDERS},
        "provider_policy": "User lựa chọn", "system_keys": {}, "personal_keys": {},
        "quotas": [{"id": "Q-001", "scope": "User", "target": "user1", "provider": "OpenAI", "daily": 10000, "rpm": 20}],
        "firmware": [{"id": "FW-001", "version": "1.1.0", "file": "xiaozhi-demo.bin", "size": 1048576, "notes": "Bản mẫu", "available": True}],
        "ota": [], "logs": [{"id": "LOG-001", "time": "2026-10-10 08:30:00", "level": "INFO", "actor": "user2", "type": "Ghép nối", "event": "Yêu cầu XB-003 (mẫu)"}, {"id": "LOG-002", "time": "2026-10-09 20:00:00", "level": "WARNING", "actor": "Hệ thống mẫu", "type": "Thiết bị", "event": "XB-002 offline (mẫu)"}],
        "settings": {"timeout": 30, "connections": 100, "heartbeat": 15},
        "assistant": {}, "privacy": {},
        "conversations": [{"id": "CHAT-001", "user": "user1", "title": "Chào Xiaozhi", "provider": "Local AI", "created": "2026-10-10 08:00:00", "active": False, "messages": [{"role": "user", "content": "Xin chào"}, {"role": "assistant", "content": "Xin chào! Đây là phản hồi mẫu, không được tạo bởi AI."}]}],
        "memory": [{"id": "MEM-001", "user": "user1", "content": "Người dùng mẫu thích câu trả lời ngắn gọn."}],
        "knowledge": [],
        "usage": [{"user": "user1", "date": f"2026-10-{day:02}", "provider": p, "sessions": day + 2, "tokens": (day + 2) * 120} for day in range(1, 11) for p in PROVIDERS],
    }


def data():
    return st.session_state.demo


def current_user():
    api_user = st.session_state.get("api_user")
    if api_user:
        return api_user
    return next((u for u in data()["users"] if u["id"] == st.session_state.identity), None)


def api_client():
    return st.session_state.get("api")


def api_enabled():
    client = api_client()
    return bool(client and client.enabled)


def set_api_user(user):
    normalized = dict(user)
    normalized["name"] = normalized.get("name") or normalized.get("display_name") or normalized.get("email", "User")
    normalized["email"] = normalized.get("email", "")
    normalized["role"] = "Admin" if str(normalized.get("role", "")).upper() == "ADMIN" else "User"
    normalized["locked"] = str(normalized.get("status", "")).upper() in {"LOCKED", "SUSPENDED"}
    st.session_state.api_user = normalized
    st.session_state.identity = normalized.get("id")


def sync_api_data():
    """Load the backend-backed read models into the existing page adapters."""
    client = api_client()
    user = current_user()
    if not client or not client.enabled or not user:
        return
    uid_value = str(user["id"])
    try:
        privacy_value = client.get("/users/me/privacy")
        data()["privacy"][uid_value] = {"history": bool(privacy_value.get("save_history", True)), "memory": False}

        profile = client.get("/ai/profile")
        data()["assistant"][uid_value] = {
            "name": profile.get("assistant_name") or "Xiaozhi",
            "personality": "Thân thiện",
            "address": "Bạn",
            "prompt": profile.get("system_prompt") or "Trả lời rõ ràng, lịch sự bằng tiếng Việt.",
            "language": profile.get("language_code") or "Tiếng Việt",
            "voice": profile.get("voice_code") or "Giọng mẫu A",
            "provider": profile.get("preferred_provider_id") or "Local AI",
        }

        device_result = client.get("/devices")
        devices = device_result.get("items", device_result if isinstance(device_result, list) else [])
        data()["devices"] = [{
            "id": str(item.get("device_uid") or item.get("deviceUid") or item.get("id")),
            "code": str(item.get("device_uid") or item.get("deviceUid") or item.get("id")),
            "name": item.get("display_name") or item.get("displayName") or "Xiaozhi",
            "owner": uid_value,
            "online": (item.get("connection_status") or item.get("connectionStatus")) == "online",
            "heartbeat": str(item.get("last_seen_at") or item.get("lastSeenAt") or "Chưa có"),
            "battery": item.get("battery_percent") or item.get("batteryPercent") or 0,
            "rssi": item.get("wifi_rssi") or item.get("wifiRssi") or 0,
            "firmware": "Chưa rõ",
        } for item in devices]

        pairing_requests = client.get("/devices/pairing-requests/mine", {"page": 1, "limit": 100})
        request_items = pairing_requests.get("items", []) if isinstance(pairing_requests, dict) else []
        data()["requests"] = [{
            "id": str(item.get("id")),
            "device": str(item.get("device_id") or item.get("deviceId")),
            "user": uid_value,
            "status": str(item.get("status", "pending")),
            "created": str(item.get("created_at") or item.get("createdAt") or ""),
            "note": item.get("review_note") or item.get("reviewNote") or "",
        } for item in request_items]

        providers = client.get("/ai/providers")
        for provider in providers if isinstance(providers, list) else []:
            name = provider.get("name") or provider.get("code")
            if name:
                data()["providers"].setdefault(name, {})
                data()["providers"][name].update({"enabled": bool(provider.get("is_enabled", provider.get("isEnabled", False))), "status": provider.get("health_status") or provider.get("healthStatus") or "Chưa kiểm tra"})

        conversations = client.get("/conversations", {"page": 1, "limit": 100})
        items = conversations.get("items", []) if isinstance(conversations, dict) else []
        data()["conversations"] = [{"id": str(item.get("id")), "user": uid_value, "title": item.get("title") or "Hội thoại", "provider": item.get("provider_id") or item.get("providerId") or "Local AI", "created": str(item.get("started_at") or item.get("startedAt") or ""), "active": item.get("status") == "active", "messages": []} for item in items]

        if str(user.get("role", "")).upper() == "ADMIN":
            users = client.get("/users", {"page": 1, "limit": 100})
            user_items = users.get("items", []) if isinstance(users, dict) else []
            data()["users"] = [{
                "id": str(item.get("id")), "name": item.get("display_name") or item.get("displayName") or item.get("email", "User"),
                "email": item.get("email", ""), "role": "Admin" if str(item.get("role", "")).upper() == "ADMIN" else "User",
                "locked": str(item.get("status", "")).upper() in {"LOCKED", "SUSPENDED"},
            } for item in user_items]
            all_devices = client.get("/devices/admin/all", {"page": 1, "limit": 100})
            device_items = all_devices.get("items", []) if isinstance(all_devices, dict) else []
            data()["devices"] = [{
                "id": str(item.get("device_uid") or item.get("deviceUid") or item.get("id")),
                "code": str(item.get("device_uid") or item.get("deviceUid") or item.get("id")),
                "name": item.get("display_name") or item.get("displayName") or "Xiaozhi", "owner": item.get("owner_id") or item.get("ownerId"),
                "online": (item.get("connection_status") or item.get("connectionStatus")) == "online",
                "heartbeat": str(item.get("last_seen_at") or item.get("lastSeenAt") or "Chưa có"),
                "battery": item.get("battery_percent") or item.get("batteryPercent") or 0, "rssi": item.get("wifi_rssi") or item.get("wifiRssi") or 0, "firmware": "Chưa rõ",
            } for item in device_items]
            admin_requests = client.get("/devices/admin/pairing-requests", {"page": 1, "limit": 100})
            request_items = admin_requests.get("items", []) if isinstance(admin_requests, dict) else []
            data()["requests"] = [{"id": str(item.get("id")), "device": str(item.get("device_id") or item.get("deviceId")), "user": str(item.get("user_id") or item.get("userId")), "status": str(item.get("status")), "created": str(item.get("created_at") or item.get("createdAt") or ""), "note": item.get("review_note") or item.get("reviewNote") or ""} for item in request_items]
            logs = client.get("/admin/logs", {"page": 1, "limit": 100})
            log_items = logs.get("items", []) if isinstance(logs, dict) else []
            data()["logs"] = [{"id": str(item.get("id")), "time": str(item.get("created_at") or item.get("createdAt") or ""), "level": item.get("severity") or "INFO", "actor": item.get("actor_user_id") or item.get("actorUserId") or "system", "type": item.get("component") or "system", "event": item.get("message") or ""} for item in log_items]
    except Exception:
        # A failed optional read must not prevent the user from entering the portal.
        return


def approved_devices(user_id):
    return [d for d in data()["devices"] if d["owner"] == user_id]


def preferences(user_id):
    return data()["assistant"].setdefault(user_id, {"name": "Xiaozhi", "personality": "Thân thiện", "address": "Bạn", "prompt": "Trả lời rõ ràng, lịch sự bằng tiếng Việt.", "language": "Tiếng Việt", "voice": "Giọng mẫu A", "provider": "Local AI"})


def privacy(user_id):
    return data()["privacy"].setdefault(user_id, {"history": True, "memory": False})


def audit(event, kind="Quản trị", level="INFO"):
    actor = current_user()
    data()["logs"].append({"id": uid("LOG"), "time": now(), "actor": actor["id"] if actor else "Khách mẫu", "level": level, "type": kind, "event": event})


def done(message, kind="Quản trị"):
    audit(message, kind)
    st.session_state.flash = f"Mô phỏng: {message}. Chỉ cập nhật trong phiên, chưa lưu vào hệ thống thật."
    st.rerun()


def mine(collection):
    return [r for r in data()[collection] if r["user"] == current_user()["id"]]


def allowed_providers():
    return [p for p in PROVIDERS if data()["providers"][p]["enabled"]]
