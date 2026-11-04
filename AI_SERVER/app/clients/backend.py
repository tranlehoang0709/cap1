"""Small async client for the BE service contract."""
import asyncio
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class BackendClient:
    def __init__(self, base_url: str, service_token: str, timeout: float = 10.0):
        self.base_url = base_url.rstrip("/")
        self.service_token = service_token
        self.timeout = timeout

    def _request_sync(self, method: str, path: str, payload: dict | None = None) -> dict:
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            f"{self.base_url}{path}",
            data=body,
            method=method,
            headers={"Accept": "application/json", "Content-Type": "application/json", "X-AI-Server-Token": self.service_token},
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError) as exc:
            raise RuntimeError(f"Backend request failed: {exc}") from exc

    async def health(self) -> dict:
        return await asyncio.to_thread(self._request_sync, "GET", "/internal/health")
