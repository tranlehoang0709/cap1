"""P0 HTTP fixtures and Streamlit flows; no live writes or real credentials."""
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, parse_qs

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tich_hop.cau_hinh import IntegrationConfig
from tich_hop.portal import PortalService
from tich_hop.http_client import ApiError, IntegrationBlocked
from tich_hop.phien_xac_thuc import AUTH_KEY


class Response:
    status = 200
    headers = {"Content-Type": "application/json"}
    def __init__(self, value): self.raw = json.dumps(value).encode()
    def read(self, size): return self.raw[:size]
    def __enter__(self): return self
    def __exit__(self, *args): pass


class Backend:
    def __init__(self, role="USER"):
        self.role, self.calls, self.generation = role, [], 0
        self.used, self.failures, self.overrides = set(), {}, {}
        self.allowed = True
        self.timeouts = []
        self.device_rows = [{"id": "42", "deviceUid": "robot-fixture", "displayName": "Robot fixture", "connectionStatus": "offline"}]
        self.requests = [{"id": "7", "deviceId": "42", "userId": "9", "status": "PENDING", "reviewNote": None}]
        self.profile_name = "Fixture User"

    def pair(self):
        self.generation += 1
        return {"access_token": f"access-{self.generation}", "refresh_token": f"refresh-{self.generation}",
                "token_type": "Bearer", "expires_in": 60}

    def error(self, request, status):
        raise HTTPError(request.full_url, status, "fixture", {}, io.BytesIO(b'{"code":"FIXTURE_ERROR"}'))

    def open(self, request, timeout):
        self.timeouts.append(timeout)
        url = urlsplit(request.full_url)
        path, method = url.path, request.get_method()
        body = json.loads(request.data) if request.data else None
        self.calls.append((method, path, body, request.get_header("Authorization")))
        failure = self.failures.get(path)
        if isinstance(failure, list):
            failure = failure.pop(0) if failure else None
        if isinstance(failure, Exception): raise failure
        if failure: self.error(request, failure)
        if path in self.overrides: return Response(self.overrides[path])
        if path == "/auth/login":
            if body["password"] in ("wrong", "locked", "unverified"): self.error(request, 401)
            return Response(self.pair())
        if path == "/auth/me":
            return Response({"id": "9", "email": "fixture@example.test", "display_name": self.profile_name, "role": self.role})
        if path == "/auth/refresh":
            if body["refresh_token"] in self.used: self.error(request, 401)
            self.used.add(body["refresh_token"])
            return Response(self.pair())
        if path == "/auth/logout":
            self.used.add(body["refresh_token"])
            return Response({"success": True})
        if path == "/auth/register":
            return Response({"id": "10", "email": body["email"], "display_name": body["display_name"], "verification_token": "fixture-verification-not-for-ui"})
        if path == "/user/dashboard/access":
            return Response({"allowed": self.allowed, "reason": None if self.allowed else "NO_APPROVED_DEVICE"})
        if path == "/user/devices": return Response({"devices": self.device_rows, "total": len(self.device_rows)})
        if path == "/user/devices/42": return Response(self.device_rows[0])
        if path in ("/user/devices/pairing-requests", "/admin/pairing-requests"):
            if method == "POST": return Response({"id": "8", "deviceId": "42", "status": "PENDING"})
            query = parse_qs(url.query)
            return Response({"items": self.requests, "pagination": {"page": int(query["page"][0]), "limit": int(query["limit"][0]), "total": len(self.requests)}})
        if path.startswith("/admin/pairing-requests/"):
            status = "APPROVED" if path.endswith("/approve") else "REJECTED"
            self.requests[0]["status"] = status
            return Response({"status": status})
        if path == "/devices/admin/all":
            return Response({"items": [{"id": "42", "device_uid": "robot-fixture", "display_name": "Robot fixture", "connection_status": "offline"}],
                             "page": 1, "limit": 100, "total": 1, "total_pages": 1})
        if path == "/admin/dashboard":
            return Response({"users": 2, "devices": 1, "assigned_devices": 1, "online_devices": 0, "conversations": 0, "usage_today": 0})
        if path == "/ai/profile":
            return Response({"assistant_name": "Fixture assistant", "system_prompt": "Fixture prompt",
                             "preferred_provider_id": "2", "preferred_llm_model_id": "3",
                             "language_code": "vi", "voice_code": None})
        if path == "/conversations":
            query = parse_qs(url.query)
            return Response({"items": [], "total": 0, "page": int(query["page"][0]), "limit": int(query["limit"][0])})
        if path == "/ai/providers":
            return Response([{"id": "2", "name": "Fixture Gemini", "code": "GEMINI", "is_enabled": True}])
        if path == "/web-chat/messages":
            return Response({"id": "11", "user_id": "9", "messages": [
                {"role": "user", "content": body["content"]}, {"role": "assistant", "content": "Fixture answer"}]})
        if path == "/users/me":
            if body: self.profile_name = body["display_name"]
            return Response({"id": "9", "display_name": self.profile_name, "email": "fixture@example.test", "status": "active", "email_verified_at": "2026-11-01T00:00:00Z"})
        raise AssertionError(f"Unexpected fixture endpoint: {method} {path}")


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.backend, self.state, self.now = Backend(), {}, 100
        self.api = PortalService(self.state, IntegrationConfig(), self.backend.open, lambda: self.now)
        self.api.login("fixture@example.test", "fixture-password")
        self.backend.calls.clear()

    def test_login_identity_and_expiry(self):
        self.assertEqual(self.api.session.identity().id, "9")
        self.assertEqual(self.state[AUTH_KEY]["expires_at"], 160)

    def test_login_errors_clear_auth(self):
        for password in ("wrong", "locked", "unverified"):
            with self.assertRaises(ApiError): self.api.login("fixture@example.test", password)
            self.assertNotIn(AUTH_KEY, self.state)

    def test_register_pending_discards_verification(self):
        value = self.api.register("Fixture", "new@example.test", "fixture-password")
        self.assertEqual(value, {"id": "10", "pending_verification": True})
        self.assertNotIn("fixture-verification-not-for-ui", repr(self.state) + repr(value))
        self.assertFalse(any(c[1] == "/auth/verify-email" for c in self.backend.calls))

    def test_refresh_expired_and_rotation(self):
        old = self.api.session.refresh_token(); self.now = 161
        self.api.devices()
        self.assertNotEqual(old, self.api.session.refresh_token())
        self.assertIn(old, self.backend.used)
        with self.assertRaises(ApiError):
            self.api.client.post("/auth/refresh", body={"refresh_token": old}, authenticated=False)

    def test_get_401_refreshes_only_once(self):
        self.backend.failures["/user/devices"] = [401, 401]
        with self.assertRaises(ApiError): self.api.devices()
        self.assertEqual(sum(c[1] == "/auth/refresh" for c in self.backend.calls), 1)
        self.assertNotIn(AUTH_KEY, self.state)

    def test_me_401_refreshes_once(self):
        self.backend.failures["/auth/me"] = [401, None]
        self.assertEqual(self.api.me().role, "USER")
        self.assertEqual(sum(c[1] == "/auth/refresh" for c in self.backend.calls), 1)

    def test_refresh_failure_clears_session(self):
        self.now = 161; self.backend.failures["/auth/refresh"] = URLError("fixture offline")
        with self.assertRaises(ApiError): self.api.devices()
        self.assertNotIn(AUTH_KEY, self.state)

    def test_mutation_not_replayed_on_401(self):
        self.backend.failures["/user/devices/pairing-requests"] = 401
        with self.assertRaises(ApiError): self.api.pair("PAIRFIXTURE")
        self.assertEqual(len(self.backend.calls), 1)
        self.assertNotIn(AUTH_KEY, self.state)

    def test_forbidden_keeps_session(self):
        self.backend.failures["/user/devices"] = 403
        with self.assertRaises(ApiError) as caught: self.api.devices()
        self.assertEqual(caught.exception.status, 403)
        self.assertIn(AUTH_KEY, self.state)

    def test_network_and_timeout_no_fallback(self):
        for failure, kind in ((URLError("offline"), "connection"), (TimeoutError(), "timeout")):
            self.backend.failures["/user/devices"] = failure
            with self.assertRaises(ApiError) as caught: self.api.devices()
            self.assertEqual(caught.exception.kind, kind)

    def test_404_409_preserve_status(self):
        for status in (404, 409):
            self.backend.failures["/user/devices/42"] = status
            with self.assertRaises(ApiError) as caught: self.api.detail("42")
            self.assertEqual(caught.exception.status, status)
            self.assertEqual(caught.exception.code, "FIXTURE_ERROR")

    def test_devices_offline_and_detail(self):
        self.assertEqual(self.api.devices()[0]["connectionStatus"], "offline")
        self.assertEqual(self.api.detail("42")["id"], "42")

    def test_empty_and_multiple_devices(self):
        self.backend.device_rows = []; self.assertEqual(self.api.devices(), [])
        self.backend.device_rows = [{"id": str(i), "deviceUid": str(i), "displayName": None, "connectionStatus": "online"} for i in (42, 43)]
        self.assertEqual(len(self.api.devices()), 2)

    def test_access_denied_does_not_prevent_pairing(self):
        self.backend.allowed = False
        self.assertFalse(self.api.access().allowed)
        self.assertEqual(self.api.pair("PAIRFIXTURE")["status"], "PENDING")
        self.assertEqual(self.backend.calls[-1][2], {"pairingCode": "PAIRFIXTURE"})

    def test_role_isolation(self):
        with self.assertRaises(ApiError): self.api.dashboard()
        with self.assertRaises(ApiError): self.api.review("7", True, "")
        self.assertEqual(self.backend.calls, [])

    def test_pairing_ownership_response_checked(self):
        self.backend.requests[0]["userId"] = "99"
        with self.assertRaises(ApiError): self.api.pairing_requests()

    def test_profile_read_update(self):
        self.assertEqual(self.api.profile()["id"], "9")
        self.api.update_profile("New name")
        self.assertEqual(self.backend.calls[-1][2], {"display_name": "New name"})

    def test_admin_routes_review_and_pagination(self):
        self.backend.role = "ADMIN"; self.api.me()
        self.assertEqual(self.api.dashboard()["users"], 2)
        self.assertEqual(self.api.devices()[0]["device_uid"], "robot-fixture")
        self.assertEqual(self.api.pairing_requests()[0]["id"], "7")
        self.api.review("7", True, "Approved fixture")
        self.assertEqual(self.backend.calls[-1][1:3], ("/admin/pairing-requests/7/approve", {"reviewNote": "Approved fixture"}))
        self.api.review("7", False, "Rejected fixture")
        self.assertEqual(self.backend.calls[-1][1], "/admin/pairing-requests/7/reject")

    def test_malformed_access_fail_closed(self):
        self.backend.overrides["/user/dashboard/access"] = {"allowed": "true", "reason": None}
        with self.assertRaises(ApiError): self.api.access()

    def test_pagination_all_pages(self):
        self.backend.role = "ADMIN"; self.api.me()
        count = 0
        def request(method, path, **kwargs):
            nonlocal count
            count += 1
            page = kwargs["query"]["page"]
            return {"items": [{"id": str(i)} for i in range(1, 101)] if page == 1 else [{"id": "101"}],
                    "page": page, "limit": 100, "total": 101}
        with patch.object(self.api, "request", request):
            self.assertEqual(len(self.api.devices()), 101)
        self.assertEqual(count, 2)

    def test_pagination_mismatch_rejected(self):
        self.backend.overrides["/user/devices/pairing-requests"] = {"items": [], "pagination": {"page": 1, "limit": 100, "total": 1}}
        with self.assertRaises(ApiError): self.api.pairing_requests()

    def test_invalid_pair_code_never_sent(self):
        for code in ("bad", "with spaces", "PAIRCODE\n"):
            with self.assertRaises(ApiError): self.api.pair(code)
        self.assertEqual(self.backend.calls, [])

    def test_logout_clears_local_even_offline(self):
        self.backend.failures["/auth/logout"] = URLError("offline")
        with self.assertRaises(ApiError): self.api.logout()
        self.assertNotIn(AUTH_KEY, self.state)

    def test_logout_success(self):
        self.api.logout(); self.assertNotIn(AUTH_KEY, self.state)
        self.assertEqual(self.backend.calls[-1][0:2], ("POST", "/auth/logout"))

    def test_demo_never_calls_http(self):
        api = PortalService({}, IntegrationConfig(mode="DEMO"), self.backend.open)
        with self.assertRaises(IntegrationBlocked): api.login("demo@example.test", "fixture")
        self.assertEqual(self.backend.calls, [])

    def test_sessions_do_not_share_tokens(self):
        other_state = {}
        other = PortalService(other_state, IntegrationConfig(), self.backend.open)
        other.login("other@example.test", "fixture-password")
        self.assertNotEqual(self.api.session.access_token(), other.session.access_token())
        other.session.clear()
        self.assertIn(AUTH_KEY, self.state)


    def test_chat_uses_saved_profile_and_dedicated_timeout(self):
        self.assertEqual(self.api.ai_profile()["preferred_provider_id"], "2")
        result = self.api.chat("Xin chào")
        self.assertEqual(result["messages"][-1]["content"], "Fixture answer")
        call = self.backend.calls[-1]
        self.assertEqual(call[0:3], ("POST", "/web-chat/messages", {"content": "Xin chào"}))
        self.assertEqual(self.backend.timeouts[-1], 100.0)
        self.api.devices()
        self.assertEqual(self.backend.timeouts[-1], 10.0)

    def test_chat_timeout_and_401_never_replay_post(self):
        for failure in (TimeoutError("private detail"), 401, 503):
            self.backend.calls.clear()
            self.backend.failures["/web-chat/messages"] = failure
            if self.api.session.value() is None:
                self.api.login("fixture@example.test", "fixture-password")
            with self.assertRaises(ApiError) as caught:
                self.api.chat("Question")
            self.assertNotIn("private detail", str(caught.exception))
            self.assertEqual(sum(c[1] == "/web-chat/messages" for c in self.backend.calls), 1)

    def test_chat_rejects_foreign_owner_and_empty_answer(self):
        self.backend.overrides["/web-chat/messages"] = {"id": "11", "user_id": "8",
            "messages": [{"role": "assistant", "content": "Foreign"}]}
        with self.assertRaises(ApiError):
            self.api.chat("Question")
        self.backend.overrides["/web-chat/messages"] = {"id": "11", "user_id": "9", "messages": []}
        with self.assertRaises(ApiError):
            self.api.chat("Question")

    def test_chat_validates_content_before_sending(self):
        for content in ("", "   ", "x" * 16001, "😀" * 8001):
            with self.assertRaises(ApiError):
                self.api.chat(content)
        self.assertFalse(any(c[1] == "/web-chat/messages" for c in self.backend.calls))

    def test_chat_timeout_budget_does_not_change_regular_requests(self):
        self.assertEqual(IntegrationConfig().timeout, 10)
        self.assertEqual(IntegrationConfig().chat_timeout, 100)
        for timeout in (0, 95, 121, float("nan"), True):
            with self.assertRaises(ValueError):
                IntegrationConfig(chat_timeout=timeout)



def widget(elements, label):
    return next(item for item in elements if item.label == label)


class AppTests(unittest.TestCase):
    def setUp(self):
        from streamlit.testing.v1 import AppTest
        self.backend = Backend()
        self.env = patch.dict(os.environ, {"AIVA_DATA_MODE": "API", "AIVA_BACKEND_BASE_URL": "http://127.0.0.1:3001"})
        self.env.start(); self.addCleanup(self.env.stop)
        self.transport = patch("tich_hop.http_client.build_opener", return_value=self.backend)
        self.transport.start(); self.addCleanup(self.transport.stop)
        self.app = AppTest.from_string('import streamlit as st\nst.set_page_config(layout="wide")\nfrom tich_hop.giao_dien import run\nrun()', default_timeout=30).run()
        self.clean()

    def clean(self): self.assertFalse(self.app.exception, [e.message for e in self.app.exception])
    def login(self):
        widget(self.app.text_input, "Email").set_value("fixture@example.test")
        widget(self.app.text_input, "Mật khẩu").set_value("fixture-password")
        widget(self.app.button, "Đăng nhập").click().run(); self.clean()
    def navigate(self, page):
        widget(self.app.sidebar.radio, "Điều hướng").set_value(page).run(); self.clean()

    def test_user_dashboard_robot_account_logout(self):
        self.login()
        self.assertEqual(len(widget(self.app.sidebar.radio, "Điều hướng").options), 5)
        self.assertEqual(self.app.metric[0].value, "1")
        self.navigate("Thiết bị của tôi")
        self.assertTrue(any(i.label == "Gửi yêu cầu" for i in self.app.button))
        widget(self.app.text_input, "Mã ghép nối robot").set_value("PAIRFIXTURE")
        widget(self.app.button, "Gửi yêu cầu").click().run(); self.clean()
        self.navigate("Tài khoản")
        self.assertEqual(widget(self.app.text_input, "Email").value, "fixture@example.test")
        self.navigate("AI Chat")
        self.assertTrue(self.app.chat_input)
        self.assertTrue(any("cấu hình trợ lý" in i.value for i in self.app.caption))
        widget(self.app.sidebar.button, "Đăng xuất").click().run(); self.clean()
        self.assertNotIn(AUTH_KEY, self.app.session_state)
        self.assertTrue(any(i.label == "Đăng nhập" for i in self.app.button))


    def test_chat_ui_posts_once_and_renders_backend_answer(self):
        self.login()
        self.navigate("AI Chat")
        self.app.chat_input[0].set_value("Xin chào").run()
        self.clean()
        calls = [c for c in self.backend.calls if c[1] == "/web-chat/messages"]
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][2], {"content": "Xin chào"})
        self.assertTrue(any(i.value == "Fixture answer" for i in self.app.markdown))

    def test_chat_ui_failure_has_no_fabricated_answer_or_retry(self):
        self.backend.failures["/web-chat/messages"] = 503
        self.login()
        self.navigate("AI Chat")
        self.app.chat_input[0].set_value("Question").run()
        self.clean()
        self.assertTrue(self.app.error)
        self.assertFalse(any(i.value == "Fixture answer" for i in self.app.markdown))
        self.assertEqual(sum(c[1] == "/web-chat/messages" for c in self.backend.calls), 1)

    def test_denied_dashboard_still_has_robot_navigation(self):
        self.backend.allowed = False; self.login()
        self.assertFalse(self.app.metric)
        self.navigate("Thiết bị của tôi")
        self.assertTrue(any(i.label == "Gửi yêu cầu" for i in self.app.button))

    def test_api_failure_never_renders_mock(self):
        self.backend.failures["/user/devices"] = URLError("offline")
        self.login()
        self.assertTrue(self.app.error)
        self.assertFalse(self.app.metric)
        self.assertNotIn("demo", self.app.session_state)

    def test_admin_confirmation_and_navigation(self):
        self.backend.role = "ADMIN"; self.login()
        self.assertEqual(len(widget(self.app.sidebar.radio, "Điều hướng").options), 8)
        self.navigate("Quản lý thiết bị")
        widget(self.app.button, "Xác nhận").click().run(); self.clean()
        self.assertFalse(any(c[1].endswith("/approve") for c in self.backend.calls))
        widget(self.app.checkbox, "Xác nhận quyết định cho robot này").check()
        widget(self.app.button, "Xác nhận").click().run(); self.clean()
        self.assertEqual(sum(c[1].endswith("/approve") for c in self.backend.calls), 1)

    def test_register_ui_never_displays_token(self):
        widget(self.app.text_input, "Họ tên").set_value("New Fixture")
        widget(self.app.text_input, "Email đăng ký").set_value("new@example.test")
        widget(self.app.text_input, "Mật khẩu đăng ký").set_value("fixture-password")
        widget(self.app.text_input, "Nhập lại mật khẩu").set_value("fixture-password")
        widget(self.app.button, "Tạo tài khoản User").click().run(); self.clean()
        self.assertTrue(any("chờ xác minh" in i.value for i in self.app.success))
        self.assertNotIn("fixture-verification-not-for-ui", str(self.app))
        self.assertNotIn(AUTH_KEY, self.app.session_state)

    def test_confirmation_does_not_move_to_another_request(self):
        self.backend.role = "ADMIN"
        self.backend.requests.append({"id": "8", "deviceId": "43", "userId": "9", "status": "PENDING"})
        self.login(); self.navigate("Quản lý thiết bị")
        widget(self.app.checkbox, "Xác nhận quyết định cho robot này").check().run(); self.clean()
        widget(self.app.selectbox, "Yêu cầu chờ duyệt").select("8").run(); self.clean()
        self.assertFalse(widget(self.app.checkbox, "Xác nhận quyết định cho robot này").value)
        widget(self.app.button, "Xác nhận").click().run(); self.clean()
        self.assertFalse(any(c[1].endswith("/approve") for c in self.backend.calls))

    def test_multiple_online_robot_cards_render(self):
        self.backend.device_rows = [{"id": str(i), "deviceUid": str(i), "displayName": "Fixture", "connectionStatus": "online"} for i in (42, 43)]
        self.backend.overrides["/user/devices/43"] = self.backend.device_rows[1]
        self.login(); self.navigate("Thiết bị của tôi")
        self.assertFalse(self.app.error)




class MainChatAdapterTests(unittest.TestCase):
    def setup_portal(self, backend=None):
        from tich_hop.portal import AuthenticatedChatPortal
        self.backend = backend or Backend()
        self.cleared = []
        account = {"id": "9", "email": "fixture@example.test", "display_name": "Fixture", "role": "USER"}
        return AuthenticatedChatPortal(account, "fixture-main-access", "http://127.0.0.1:3001",
                                       lambda: self.cleared.append(True), self.backend.open)

    def test_main_session_chat_has_bound_identity_timeout_and_no_override(self):
        portal = self.setup_portal()
        result = portal.chat("Question")
        self.assertTrue(result["messages"])
        self.assertEqual(self.backend.calls[-1],
                         ("POST", "/web-chat/messages", {"content": "Question"}, "Bearer fixture-main-access"))
        self.assertEqual(self.backend.timeouts[-1], 100)
        self.assertEqual(portal.session.identity().id, "9")

    def test_main_session_does_not_refresh_or_replay_a_chat_401(self):
        portal = self.setup_portal()
        self.backend.failures["/web-chat/messages"] = 401
        with self.assertRaises(ApiError):
            portal.chat("Question")
        self.assertEqual(len(self.backend.calls), 1)
        self.assertEqual(self.cleared, [True])

    def test_main_session_refuses_admin_chat_before_http(self):
        from tich_hop.portal import AuthenticatedChatPortal
        backend = Backend()
        portal = AuthenticatedChatPortal(
            {"id": "1", "email": "admin@example.test", "display_name": "Admin", "role": "ADMIN"},
            "fixture-main-access", "http://127.0.0.1:3001", lambda: None, backend.open)
        with self.assertRaises(ApiError):
            portal.chat("Question")
        self.assertEqual(backend.calls, [])

    def test_actual_main_entrypoint_preserves_navigation_and_uses_chat_adapter(self):
        from streamlit.testing.v1 import AppTest
        backend = Backend()
        account = {"id": "9", "email": "fixture@example.test", "display_name": "Fixture", "role": "USER"}
        with patch("nen_tang.backend.api", return_value=account), patch(
                "giao_dien.live.api", return_value=account), patch(
                "tich_hop.http_client.build_opener", return_value=backend):
            app = AppTest.from_file(str(ROOT / "app.py"), default_timeout=30)
            app.session_state["access_token"] = "fixture-main-access"
            app.session_state["refresh_token"] = "fixture-main-refresh"
            app.session_state["real_nav_9"] = "AI Chat"
            app.run()
            self.assertFalse(app.exception, [e.message for e in app.exception])
            self.assertEqual(len(widget(app.sidebar.radio, "Điều hướng").options), 8)
            app.chat_input[0].set_value("Question").run()
            self.assertFalse(app.exception, [e.message for e in app.exception])
            calls = [c for c in backend.calls if c[1] == "/web-chat/messages"]
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0][2], {"content": "Question"})
            self.assertTrue(any("Fixture answer" in item.value for item in app.markdown))

if __name__ == "__main__":
    unittest.main()
