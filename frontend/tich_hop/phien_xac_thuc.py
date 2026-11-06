"""Danh tính và token Backend chỉ thuộc một phiên Streamlit."""
from dataclasses import dataclass
from .thiet_bi_dto import identifier
import math
import time

AUTH_KEY = "aiva_api_auth"

@dataclass(frozen=True)
class BackendIdentity:
    id: str
    email: str
    display_name: str
    role: str

    @classmethod
    def parse(cls, value):
        if (not isinstance(value, dict) or value.get("role") not in ("ADMIN", "USER")
            or not all(isinstance(value.get(k), str) and value[k].strip() for k in ("id", "email", "display_name"))):
            raise ValueError("Danh tính Backend không hợp lệ.")
        return cls(identifier(value["id"]),*(value[k] for k in ("email", "display_name", "role")))

    def ui_account(self):
        return {"id": "backend:" + self.id, "backend_id": self.id, "email": self.email,
                "name": self.display_name, "role": {"ADMIN":"Admin", "USER":"User"}[self.role],
                "locked": False, "identity_kind": "BackendIdentity"}

@dataclass(frozen=True)
class DemoIdentity:
    id: str
    role: str

class AuthSession:
    def __init__(self, state, clock=time.time):
        self._state, self._clock = state, clock

    @staticmethod
    def valid_token(token):
        return isinstance(token, str) and bool(token) and token.isascii() and not any(c.isspace() for c in token)

    def set_access_token(self, token):
        if not self.valid_token(token): raise ValueError("Access token không hợp lệ.")
        self._state[AUTH_KEY] = {"access_token": token}

    def value(self):
        value = self._state.get(AUTH_KEY)
        if value is None: return None
        if not isinstance(value, dict) or not self.valid_token(value.get("access_token")):
            raise ValueError("Trạng thái xác thực không hợp lệ.")
        return value

    def access_token(self):
        value = self.value()
        return value["access_token"] if value else None

    def refresh_token(self):
        value = self.value()
        token = value.get("refresh_token") if value else None
        if not self.valid_token(token): raise ValueError("Không có refresh token hợp lệ.")
        return token

    def set_pair(self, pair):
        ttl = pair.get("expires_in") if isinstance(pair, dict) else None
        if (not isinstance(pair, dict) or pair.get("token_type") != "Bearer"
            or not self.valid_token(pair.get("access_token")) or not self.valid_token(pair.get("refresh_token"))
            or type(ttl) not in (int, float) or not math.isfinite(ttl) or ttl <= 0):
            raise ValueError("Token response không hợp lệ.")
        previous = self.value() or {}
        self._state[AUTH_KEY] = {"access_token": pair["access_token"], "refresh_token": pair["refresh_token"],
                                "expires_at": self._clock() + ttl, "user": previous.get("user")}

    def expired(self):
        value = self.value()
        return bool(value and self._clock() >= value.get("expires_at", 0))

    def set_user(self, user):
        identity = BackendIdentity.parse(user)
        value = dict(self.value() or {})
        if not value: raise ValueError("Chưa có phiên xác thực.")
        value["user"] = {k:getattr(identity,k) for k in ("id", "email", "display_name", "role")}
        self._state[AUTH_KEY] = value
        return identity

    def identity(self):
        value = self.value()
        return BackendIdentity.parse(value["user"]) if value and value.get("user") else None

    def clear(self):
        self._state.pop(AUTH_KEY, None)
