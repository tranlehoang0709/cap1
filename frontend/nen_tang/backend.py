"""Small session-authenticated client for the AIVA-IoT Backend API."""
import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import streamlit as st


class BackendError(RuntimeError):
    def __init__(self, status, message):
        self.status = status
        self.message = message
        super().__init__(message)


def base_url():
    return os.environ.get("AIVA_BACKEND_URL", "http://127.0.0.1:3000").rstrip("/")


def _request(path, method="GET", body=None, *, auth=True, _retried=False):
    headers = {"Accept": "application/json"}
    token = st.session_state.get("access_token") if auth else None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    payload = None
    if body is not None:
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(f"{base_url()}{path}", data=payload, headers=headers, method=method)
    try:
        with urlopen(request, timeout=10) as response:
            raw = response.read()
            return json.loads(raw.decode("utf-8")) if raw else None
    except HTTPError as error:
        raw = error.read()
        try:
            detail = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeError):
            detail = None
        message = detail.get("message") if isinstance(detail, dict) else None
        if isinstance(message, list):
            message = "; ".join(str(item) for item in message)
        if not isinstance(message, str):
            message = detail.get("code") if isinstance(detail, dict) else None
        if not isinstance(message, str):
            message = detail.get("reason") if isinstance(detail, dict) else None
        if error.code == 401 and auth and not _retried and path not in ("/auth/login", "/auth/refresh"):
            refresh_token = st.session_state.get("refresh_token")
            if refresh_token:
                try:
                    pair = _request("/auth/refresh", "POST", {"refresh_token": refresh_token}, auth=False)
                    st.session_state.access_token = pair["access_token"]
                    st.session_state.refresh_token = pair["refresh_token"]
                    return _request(path, method, body, auth=True, _retried=True)
                except (BackendError, KeyError, TypeError):
                    clear_auth()
        raise BackendError(error.code, message or f"Backend trả mã HTTP {error.code}.") from None
    except (URLError, TimeoutError, OSError):
        raise BackendError(0, f"Không kết nối được Backend tại {base_url()}.") from None
    except (ValueError, UnicodeError):
        raise BackendError(0, "Backend trả về dữ liệu không đọc được.") from None


def api(path, method="GET", body=None, *, auth=True, query=None):
    if query:
        path = f"{path}?{urlencode(query)}"
    return _request(path, method, body, auth=auth)


def clear_auth():
    for key in ("access_token", "refresh_token", "account"):
        st.session_state.pop(key, None)
