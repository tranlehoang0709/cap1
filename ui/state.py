"""Session-local mock data boundary. Nothing is persisted or transmitted."""
from datetime import datetime
from uuid import uuid4

import streamlit as st

PROVIDERS = ["Local AI", "OpenAI", "Gemini"]


def uid(prefix):
    return f"{prefix}-{uuid4().hex[:8]}"


def now():
    # Fixed UTC offset avoids requiring a timezone database on Windows.
    from datetime import timezone, timedelta
    return datetime.now(timezone(timedelta(hours=7))).strftime("%Y-%m-%d %H:%M:%S")


def init_demo():
    if "demo" in st.session_state:
        return
    st.session_state.identity = None
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
    return next((u for u in data()["users"] if u["id"] == st.session_state.identity), None)


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
