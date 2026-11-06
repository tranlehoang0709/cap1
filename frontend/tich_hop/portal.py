"""P0 REST bindings verified against the Backend controllers, never mock fallback."""
import re
from .xac_thuc import AuthService
from .http_client import ApiError
from .thiet_bi_dto import identifier, DashboardAccessDTO, DeviceDetailDTO


def object_response(value):
    if not isinstance(value, dict):
        raise ApiError("response")
    return value


class PortalService(AuthService):
    def request(self, method, path, **kwargs):
        # Refresh only before sending a mutation. Never replay POST/PATCH on 401.
        if self.session.expired():
            self.refresh()
        try:
            return self.client.request(method, path, clear_auth_on_401=False, **kwargs)
        except ApiError as error:
            if error.status != 401:
                raise
            if method != "GET":
                self.session.clear()
                raise
            self.refresh()
            try:
                return self.client.get(path, clear_auth_on_401=False, **kwargs)
            except ApiError as retry_error:
                if retry_error.status == 401:
                    self.session.clear()
                raise

    def register(self, name, email, password):
        self._require_api()
        if not name.strip() or len(name.strip()) > 150 or not 8 <= len(password) <= 72 or len(password.encode()) > 72:
            raise ApiError("validation", 400)
        result = self.client.post("/auth/register", authenticated=False,
                                  body={"display_name": name.strip(), "email": email.strip(), "password": password})
        # Discard verification_token immediately; never put it in state or the UI.
        result = object_response(result)
        try:
            return {"id": identifier(result.get("id")), "pending_verification": True}
        except ValueError:
            raise ApiError("response") from None

    def _role(self, role):
        user = self.session.identity()
        if user is None or user.role != role:
            raise ApiError("forbidden", 403)
        return user

    def access(self):
        self._role("USER")
        try:
            return DashboardAccessDTO.parse(self.request("GET", "/user/dashboard/access"))
        except ValueError:
            raise ApiError("response") from None

    def devices(self):
        user = self.session.identity()
        if user is None:
            raise ApiError("unauthorized", 401)
        if user.role == "USER":
            result = object_response(self.request("GET", "/user/devices"))
            rows = result.get("devices")
            if not isinstance(rows, list) or type(result.get("total")) is not int or result["total"] != len(rows):
                raise ApiError("response")
            try:
                return [self.device_view(DeviceDetailDTO.parse(row)) for row in rows]
            except ValueError:
                raise ApiError("response") from None
        self._role("ADMIN")
        return self._pages("/devices/admin/all", envelope=False)

    @staticmethod
    def device_view(device):
        return {"id": device.id, "deviceUid": device.deviceUid, "displayName": device.displayName,
                "connectionStatus": device.connectionStatus}

    def detail(self, device_id):
        self._role("USER")
        try:
            value = DeviceDetailDTO.parse(self.request("GET", "/user/devices/" + identifier(device_id)))
            if value.id != device_id:
                raise ValueError("Mismatched device")
            return self.device_view(value)
        except ValueError:
            raise ApiError("response") from None

    def _pages(self, path, *, envelope):
        rows, page, expected_total = [], 1, None
        while True:
            value = object_response(self.request("GET", path, query={"page": page, "limit": 100}))
            meta = object_response(value.get("pagination")) if envelope else value
            batch, total = value.get("items"), meta.get("total")
            if (not isinstance(batch, list) or type(total) is not int or total < 0
                or type(meta.get("page")) is not int or meta["page"] != page or meta.get("limit") != 100
                or len(batch) > 100 or expected_total is not None and total != expected_total):
                raise ApiError("response")
            expected_total = total
            rows.extend(batch)
            if len(rows) > total or not batch and len(rows) < total:
                raise ApiError("response")
            if len(rows) == total:
                try:
                    ids = [identifier(object_response(row).get("id")) for row in rows]
                    if len(ids) != len(set(ids)):
                        raise ValueError("Duplicate IDs")
                except ValueError:
                    raise ApiError("response") from None
                return rows
            page += 1
            if page > 1000:
                raise ApiError("response")

    def pairing_requests(self):
        user = self.session.identity()
        if user is None:
            raise ApiError("unauthorized", 401)
        path = "/admin/pairing-requests" if user.role == "ADMIN" else "/user/devices/pairing-requests"
        rows = self._pages(path, envelope=True)
        for row in rows:
            try:
                identifier(row.get("deviceId")); identifier(row.get("userId"))
            except ValueError:
                raise ApiError("response") from None
            if row.get("status") not in ("PENDING", "APPROVED", "REJECTED", "CANCELLED"):
                raise ApiError("response")
            if user.role == "USER" and row["userId"] != user.id:
                raise ApiError("response")
        return rows

    def pair(self, code):
        self._role("USER")
        if not isinstance(code, str) or not re.fullmatch(r"[A-Za-z0-9_-]{6,128}", code):
            raise ApiError("validation", 400)
        result = object_response(self.request("POST", "/user/devices/pairing-requests", body={"pairingCode": code}))
        if result.get("status") != "PENDING":
            raise ApiError("response")
        return result

    def review(self, request_id, approved, note):
        self._role("ADMIN")
        if type(approved) is not bool or not isinstance(note, str) or len(note) > 500 or re.search(r"[\x00-\x1f\x7f]", note):
            raise ApiError("validation", 400)
        action = "approve" if approved else "reject"
        result = object_response(self.request("POST", f"/admin/pairing-requests/{identifier(request_id)}/{action}",
                                              body={"reviewNote": note}))
        if result.get("status") != ("APPROVED" if approved else "REJECTED"):
            raise ApiError("response")
        return result

    def dashboard(self):
        self._role("ADMIN")
        value = object_response(self.request("GET", "/admin/dashboard"))
        for field in ("users", "devices", "assigned_devices", "online_devices", "conversations", "usage_today"):
            if type(value.get(field)) is not int or value[field] < 0:
                raise ApiError("response")
        return value

    def profile(self):
        value = object_response(self.request("GET", "/users/me"))
        user = self.session.identity()
        if user is None or value.get("id") != user.id or not isinstance(value.get("display_name"), str) or not isinstance(value.get("email"), str):
            raise ApiError("response")
        return {k: value.get(k) for k in ("id", "display_name", "email", "status", "email_verified_at")}

    def update_profile(self, name):
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 150:
            raise ApiError("validation", 400)
        return self.request("PATCH", "/users/me", body={"display_name": name.strip()})

    def ai_profile(self):
        self._role("USER")
        value = object_response(self.request("GET", "/ai/profile"))
        for field in ("preferred_provider_id", "preferred_llm_model_id"):
            if value.get(field) is not None:
                try:
                    identifier(value[field])
                except ValueError:
                    raise ApiError("response") from None
        for field in ("assistant_name", "system_prompt", "language_code", "voice_code"):
            if value.get(field) is not None and not isinstance(value[field], str):
                raise ApiError("response")
        return {field: value.get(field) for field in (
            "assistant_name", "system_prompt", "preferred_provider_id", "preferred_llm_model_id",
            "language_code", "voice_code")}

    def chat(self, content):
        user = self._role("USER")
        if (not isinstance(content, str) or not content.strip()
                or len(content.encode("utf-16-le")) // 2 > 16000):
            raise ApiError("validation", 400)
        value = object_response(self.request("POST", "/web-chat/messages",
            body={"content": content}, timeout=self.config.chat_timeout))
        try:
            identifier(value.get("id"))
            if value.get("user_id") != user.id or not isinstance(value.get("messages"), list):
                raise ValueError("Invalid conversation owner")
            messages = []
            for item in value["messages"]:
                if (not isinstance(item, dict) or item.get("role") not in ("user", "assistant", "system")
                        or not isinstance(item.get("content"), str)):
                    raise ValueError("Invalid message")
                messages.append({"role": item["role"], "content": item["content"]})
            if not any(item["role"] == "assistant" and item["content"].strip() for item in messages):
                raise ValueError("Missing answer")
        except ValueError:
            raise ApiError("response") from None
        return {"id": value["id"], "messages": messages}


    def conversations(self, page=1, limit=10):
        self._role("USER")
        if type(page) is not int or page < 1 or type(limit) is not int or not 1 <= limit <= 100:
            raise ApiError("validation", 400)
        value = object_response(self.request("GET", "/conversations", query={"page": page, "limit": limit}))
        if (not isinstance(value.get("items"), list) or type(value.get("total")) is not int
                or value["total"] < 0 or len(value["items"]) > limit):
            raise ApiError("response")
        for item in value["items"]:
            try:
                identifier(object_response(item).get("id"))
            except ValueError:
                raise ApiError("response") from None
            if item.get("user_id") is not None and item["user_id"] != self.session.identity().id:
                raise ApiError("response")
        return value

    def conversation(self, conversation_id):
        user = self._role("USER")
        value = object_response(self.request("GET", "/conversations/" + identifier(conversation_id)))
        if value.get("id") != conversation_id or value.get("user_id") != user.id:
            raise ApiError("response")
        messages = value.get("messages")
        if (not isinstance(messages, list) or any(not isinstance(m, dict)
                or m.get("role") not in ("user", "assistant", "system")
                or not isinstance(m.get("content"), str) for m in messages)):
            raise ApiError("response")
        return {"id": conversation_id, "messages": [{"role": m["role"], "content": m["content"]} for m in messages]}



class AuthenticatedChatPortal(PortalService):
    """Reuse main's verified login session for chat without a second auth store.

    main refreshes identity with /auth/me before rendering. This adapter never
    refreshes or replays a chat POST; a 401 clears main's session.
    """
    def __init__(self, account, access_token, base_url, clear_auth, transport=None):
        from .cau_hinh import IntegrationConfig
        from .http_client import ApiClient
        from .phien_xac_thuc import BackendIdentity, AuthSession
        identity = BackendIdentity.parse(account)
        if not AuthSession.valid_token(access_token):
            raise ApiError("unauthorized", 401)
        class Session:
            def identity(self):
                return identity
            def access_token(self):
                return access_token
            def clear(self):
                clear_auth()
        self.config = IntegrationConfig(base_url=base_url)
        self.session = Session()
        self.client = ApiClient(self.config, self.session, transport)

    def request(self, method, path, **kwargs):
        return self.client.request(method, path, **kwargs)
