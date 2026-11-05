"""HTTP client không retry, không redirect và không ghi payload/token vào log."""
import json
import math
import re
import socket
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit, unquote
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler

class ApiError(Exception):
    def __init__(self, kind, status=None, code=None):
        self.kind, self.status = kind, status
        self.code = code if isinstance(code,str) and re.fullmatch(r"[A-Z][A-Z0-9_]{0,63}",code) else None
        messages = {
            "validation": "Dữ liệu chưa hợp lệ. Vui lòng kiểm tra lại.",
            "unauthorized": "Phiên đăng nhập không hợp lệ hoặc tài khoản chưa được phép. Vui lòng đăng nhập lại.",
            "forbidden": "Tài khoản không có quyền thực hiện thao tác này.",
            "not_found": "Không tìm thấy dữ liệu được yêu cầu.",
            "conflict": "Dữ liệu đã thay đổi hoặc thao tác đang xung đột.",
            "rate_limit": "Quá nhiều yêu cầu. Vui lòng thử lại sau.",
            "server": "Backend chưa xử lý được yêu cầu. Vui lòng thử lại sau.",
            "connection": "Chưa kết nối được Backend. Vui lòng kiểm tra dịch vụ.",
            "timeout": "Backend phản hồi quá lâu. Vui lòng thử lại sau.",
            "response": "Phản hồi Backend không hợp lệ.",
            "redirect": "Backend yêu cầu chuyển địa chỉ ngoài luồng được phép.",
        }
        super().__init__(messages.get(kind, "Không thể hoàn tất yêu cầu Backend."))

class IntegrationBlocked(Exception):
    """Chưa có contract được thống nhất; không chuyển sang mock thay thế."""

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

class ApiClient:
    def __init__(self, config, auth=None, transport=None):
        self.config, self.auth = config, auth
        self._open = transport or build_opener(ProxyHandler({}), NoRedirect()).open

    def request(self, method, path, *, body=None, query=None, authenticated=True, clear_auth_on_401=True, timeout=None):
        if self.config.mode != "API":
            raise IntegrationBlocked("DEMO mode không gọi HTTP request.")
        budget = self.config.timeout if timeout is None else timeout
        if isinstance(budget, bool) or not isinstance(budget, (int, float)) or not math.isfinite(budget) or not 0 < budget <= 120:
            raise ValueError("Invalid request timeout")
        method = method.upper()
        parts = urlsplit(path)
        decoded = unquote(path)
        if (method not in {"GET", "POST", "PATCH", "PUT", "DELETE"} or not path.startswith("/")
            or path.startswith("//") or parts.scheme or parts.netloc or parts.query or parts.fragment
            or "\\" in decoded or ".." in decoded.split("/") or any(ord(c) < 32 for c in decoded)):
            raise ValueError("Method hoặc đường dẫn request không hợp lệ.")
        headers = {"Accept": "application/json"}
        if authenticated:
            token = self.auth.access_token() if self.auth else None
            if not token:
                raise ApiError("unauthorized", 401)
            headers["Authorization"] = "Bearer " + token
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        url = self.config.base_url.rstrip("/") + path
        if query:
            url += "?" + urlencode(query, doseq=True)
        request = Request(url, data=data, headers=headers, method=method)
        try:
            with self._open(request, timeout=budget) as response:
                raw = response.read(1048577)
                if len(raw) > 1048576:
                    raise ApiError("response")
                if response.status == 204:
                    return None
                if response.headers.get("Content-Type", "").split(";")[0].lower() != "application/json":
                    raise ApiError("response")
                try:
                    return json.loads(raw.decode("utf-8"))
                except (ValueError, UnicodeError):
                    raise ApiError("response") from None
        except HTTPError as error:
            status = error.code
            code = None
            try:
                raw = error.read(1048577)
                payload = json.loads(raw.decode("utf-8")) if len(raw)<=1048576 else None
                code = payload.get("code") if isinstance(payload,dict) else None
            except (ValueError, UnicodeError, OSError, AttributeError):
                pass
            finally:
                error.close()
            if status == 401 and self.auth and clear_auth_on_401:
                self.auth.clear()
            kind = {400: "validation", 401: "unauthorized", 403: "forbidden", 404: "not_found",
                    409: "conflict", 422: "validation", 429: "rate_limit", 504: "timeout"}.get(status,
                    "server" if status >= 500 else "redirect" if 300 <= status < 400 else "http")
            raise ApiError(kind, status, code) from None
        except (TimeoutError, socket.timeout):
            raise ApiError("timeout") from None
        except URLError as error:
            raise ApiError("timeout" if isinstance(error.reason, TimeoutError) else "connection") from None
        except OSError:
            raise ApiError("connection") from None

    def get(self, path, **kwargs): return self.request("GET", path, **kwargs)
    def post(self, path, **kwargs): return self.request("POST", path, **kwargs)
    def patch(self, path, **kwargs): return self.request("PATCH", path, **kwargs)
    def put(self, path, **kwargs): return self.request("PUT", path, **kwargs)
    def delete(self, path, **kwargs): return self.request("DELETE", path, **kwargs)
