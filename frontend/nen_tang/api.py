"""HTTP client for the AIVA backend.

The client is enabled when AIVA_API_URL is set. Without it the existing demo
data remains available for UI development.
"""
import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class ApiError(RuntimeError):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


class AivaApi:
    def __init__(self, base_url=None):
        self.base_url = (base_url or os.getenv("AIVA_API_URL", "")).rstrip("/")
        self.access_token = None
        self.refresh_token = None

    @property
    def enabled(self):
        return bool(self.base_url)

    def _request(self, method, path, payload=None, token=None):
        if not self.enabled:
            raise ApiError("AIVA_API_URL chưa được cấu hình")
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        bearer = token or self.access_token
        if bearer:
            headers["Authorization"] = f"Bearer {bearer}"
        request = Request(f"{self.base_url}{path}", data=body, headers=headers, method=method)
        try:
            with urlopen(request, timeout=15) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw) if raw else None
        except HTTPError as exc:
            try:
                detail = json.loads(exc.read().decode("utf-8"))
            except Exception:
                detail = {}
            message = detail.get("message") if isinstance(detail, dict) else None
            raise ApiError(message or f"Backend trả về HTTP {exc.code}", exc.code) from exc
        except URLError as exc:
            raise ApiError(f"Không kết nối được backend: {exc.reason}") from exc

    def login(self, email, password):
        tokens = self._request("POST", "/auth/login", {"email": email, "password": password})
        self.access_token = tokens["access_token"]
        self.refresh_token = tokens.get("refresh_token")
        return self.me()

    def register(self, email, display_name, password):
        return self._request("POST", "/auth/register", {"email": email, "display_name": display_name, "password": password})

    def me(self):
        return self._request("GET", "/auth/me")

    def logout(self):
        if self.access_token and self.refresh_token:
            self._request("POST", "/auth/logout", {"refresh_token": self.refresh_token})
        self.access_token = None
        self.refresh_token = None

    def get(self, path, query=None):
        if query:
            from urllib.parse import urlencode
            path = f"{path}?{urlencode(query)}"
        return self._request("GET", path)

    def post(self, path, payload):
        return self._request("POST", path, payload)

    def patch(self, path, payload):
        return self._request("PATCH", path, payload)

    def delete(self, path):
        return self._request("DELETE", path)
