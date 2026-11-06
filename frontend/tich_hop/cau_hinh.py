"""API mặc định tới Backend local; DEMO chỉ bật tường minh, không đọc .env."""
from dataclasses import dataclass
import ipaddress
import math
import os
from urllib.parse import urlsplit

@dataclass(frozen=True)
class IntegrationConfig:
    mode: str = "API"
    base_url: str = "http://127.0.0.1:3001"
    timeout: float = 10.0
    chat_timeout: float = 100.0

    def __post_init__(self):
        try:
            url = urlsplit(self.base_url)
            port = url.port
            local = url.hostname == "localhost"
            try:
                local = local or ipaddress.ip_address(url.hostname or "").is_loopback
            except ValueError:
                pass
            valid = (url.scheme == "https" or url.scheme == "http" and local)
            valid = valid and bool(url.hostname) and not (url.username or url.password or url.query or url.fragment)
            valid = valid and url.path in ("", "/")
            valid = valid and not any(c.isspace() for c in self.base_url)
            if not valid or port is not None and not 1 <= port <= 65535:
                raise ValueError
            if self.mode not in ("DEMO", "API") or isinstance(self.timeout, bool) or not math.isfinite(self.timeout) or not 0 < self.timeout <= 60:
                raise ValueError
            if (isinstance(self.chat_timeout, bool) or not math.isfinite(self.chat_timeout)
                    or not 95 < self.chat_timeout <= 120):
                raise ValueError
        except (ValueError, TypeError):
            raise ValueError("Cấu hình tích hợp không hợp lệ.") from None

    @classmethod
    def from_env(cls, env=None):
        env = os.environ if env is None else env
        try:
            return cls(mode=env.get("AIVA_DATA_MODE", "API").upper(),
                       base_url=env.get("AIVA_BACKEND_BASE_URL", "http://127.0.0.1:3001"),
                       timeout=float(env.get("AIVA_BACKEND_TIMEOUT", "10")),
                       chat_timeout=float(env.get("AIVA_CHAT_TIMEOUT", "100")))
        except (ValueError, TypeError):
            raise ValueError("Kiểm tra AIVA_DATA_MODE, AIVA_BACKEND_BASE_URL và AIVA_BACKEND_TIMEOUT và AIVA_CHAT_TIMEOUT.") from None
