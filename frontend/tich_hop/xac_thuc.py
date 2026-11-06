"""Bốn API Auth đã đối chiếu controller/DTO/service; không retry request ghi."""
from .http_client import ApiClient, ApiError, IntegrationBlocked
from .phien_xac_thuc import AuthSession
from .cau_hinh import IntegrationConfig

class AuthService:
    def __init__(self, state, config=None, transport=None, clock=None):
        self.config = config or IntegrationConfig.from_env()
        self.session = AuthSession(state, clock) if clock else AuthSession(state)
        self.client = ApiClient(self.config, self.session, transport)

    def _require_api(self):
        if self.config.mode != "API": raise IntegrationBlocked("DEMO không gọi API Auth.")

    def login(self, email, password):
        self._require_api()
        self.session.clear()
        try:
            pair = self.client.post("/auth/login", body={"email":email, "password":password}, authenticated=False)
            self.session.set_pair(pair)
            return self.me(allow_refresh=False)
        except ApiError as error:
            if error.status != 403: self.session.clear()
            raise
        except ValueError:
            self.session.clear()
            raise ApiError("response") from None

    def refresh(self):
        self._require_api()
        try:
            old = self.session.refresh_token()
            # Refresh token được gửi đúng một lần; lỗi mạng không retry vì rotation có thể đã commit.
            pair = self.client.post("/auth/refresh", body={"refresh_token":old}, authenticated=False)
            if not isinstance(pair, dict) or pair.get("refresh_token") == old:
                raise ValueError("Rotation không hợp lệ.")
            self.session.set_pair(pair)
        except (ApiError, ValueError):
            self.session.clear()
            raise ApiError("unauthorized", 401) from None

    def me(self, allow_refresh=True):
        self._require_api()
        refreshed = False
        try:
            if allow_refresh and self.session.expired():
                self.refresh(); refreshed = True
            try:
                user = self.client.get("/auth/me", clear_auth_on_401=False)
            except ApiError as error:
                if error.status != 401 or not allow_refresh or refreshed: raise
                self.refresh(); refreshed = True
                # Chỉ GET an toàn này được gửi lại một lần sau rotation.
                user = self.client.get("/auth/me", clear_auth_on_401=False)
            return self.session.set_user(user)
        except ApiError as error:
            if error.status == 401: self.session.clear()
            raise
        except ValueError:
            self.session.clear()
            raise ApiError("response") from None

    def logout(self):
        self._require_api()
        try:
            if self.session.expired(): self.refresh()
            refresh = self.session.refresh_token()
            result = self.client.post("/auth/logout", body={"refresh_token":refresh}, clear_auth_on_401=False)
            if result != {"success":True}: raise ApiError("response")
        except ValueError:
            raise ApiError("unauthorized", 401) from None
        finally:
            self.session.clear()
