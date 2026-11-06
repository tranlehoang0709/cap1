"""Restored UI contracts with isolated HTTP fixtures. Never LIVE evidence."""
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit, parse_qs
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import streamlit as st
from streamlit.testing.v1 import AppTest
from nen_tang.backend import BackendError
ROOT = Path(__file__).resolve().parents[1]


class UIBackendFixture:
    """Synthetic test responses only; production never imports this module."""
    def __init__(self):
        self.role = "USER"
        self.calls = []
        self.fail = {}
        self.devices = []
        self.conversations = []
        self.details = {}

    def account(self):
        return {"id": "1" if self.role == "ADMIN" else "7", "role": self.role,
                "email": "admin@fixture.invalid" if self.role == "ADMIN" else "user@fixture.invalid",
                "display_name": "Fixture Admin" if self.role == "ADMIN" else "Fixture User",
                "status": "active", "email_verified_at": "2026-01-01T00:00:00Z"}

    def page(self, records, query):
        query = query or {}
        page, limit = int(query.get("page", 1)), int(query.get("limit", 100))
        return {"items": records[(page-1)*limit:page*limit], "total": len(records),
                "page": page, "limit": limit, "total_pages": (len(records)+limit-1)//limit}

    def api(self, path, method="GET", body=None, *, auth=True, query=None, **kwargs):
        self.calls.append((path, method, body, query))
        if path in self.fail:
            raise BackendError(self.fail[path], "Fixture request failed")
        if path == "/auth/login":
            if body["password"] == "wrong":
                raise BackendError(401, "Wrong password fixture")
            self.role = "ADMIN" if body["email"].startswith("admin") else "USER"
            return {"access_token": "fixture-"+self.role.lower(), "refresh_token": "fixture-refresh",
                    "token_type": "Bearer", "expires_in": 600}
        if path == "/auth/me" or path == "/users/me":
            return self.account()
        if path == "/auth/register":
            return {"id": "8", "verification_token": "fixture-token-never-displayed"}
        if path in ("/auth/verify-email", "/auth/logout", "/auth/password"):
            return {"success": True}
        if path == "/usage":
            return [{"provider_id": "2", "requests": 3, "input_tokens": 20, "output_tokens": 10}]
        if path == "/ai/profile":
            return {"user_id": self.account()["id"], "assistant_name": "Fixture AIVA", "system_prompt": "Fixture prompt",
                    "preferred_provider_id": "2", "preferred_llm_model_id": "3", "language_code": "vi", "voice_code": None}
        if path == "/ai/providers":
            return [{"id": "2", "code": "GEMINI", "name": "Gemini", "is_enabled": True}]
        if path == "/ai/providers/2/models":
            return [{"id": "3", "provider_id": "2", "model_code": "fixture-model", "capability": "LLM", "is_enabled": True}]
        if path in ("/devices", "/devices/admin/all"):
            return self.page(self.devices, query)
        if path == "/conversations":
            return self.page(self.conversations, query)
        if path.startswith("/conversations/"):
            ident = path.rsplit("/", 1)[1]
            if method == "DELETE":
                self.conversations = [row for row in self.conversations if row["id"] != ident]
                return {"success": True}
            return self.details.get(ident)
        if path in ("/devices/pairing-requests/mine", "/devices/admin/pairing-requests", "/admin/logs", "/admin/audit-logs"):
            return self.page([], query)
        if path == "/users":
            return self.page([self.account()], query)
        if path == "/users/me/privacy":
            return {"save_history": False if method == "GET" else body["save_history"]}
        if path == "/admin/dashboard":
            return {"users": 2, "devices": len(self.devices), "assigned_devices": len(self.devices),
                    "online_devices": 0, "conversations": len(self.conversations), "generated_at": "2026-01-01T00:00:00Z"}
        if path in ("/quotas", "/admin/quotas", "/api-keys", "/admin/api-keys/system",
                    "/admin/monitoring/instances", "/admin/firmware", "/admin/system-settings"):
            return []
        raise BackendError(404, "Fixture has no matching contract")

    def open(self, request, timeout):
        parts = urlsplit(request.full_url)
        query = {k: v[0] for k,v in parse_qs(parts.query).items()}
        body = json.loads(request.data) if request.data else None
        value = self.api(parts.path, request.get_method(), body, query=query)
        class Response:
            status = 200
            headers = {"Content-Type": "application/json"}
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, size=None): return json.dumps(value).encode("utf-8")
        return Response()


def element(items, label):
    return next(item for item in items if item.label == label)


class RestoredAuthenticationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = UIBackendFixture()
        self.patches = [patch("giao_dien.live.api", side_effect=self.fixture.api),
                        patch("nen_tang.backend.api", side_effect=self.fixture.api),
                        patch("tich_hop.http_client.build_opener", return_value=self.fixture)]
        for handle in self.patches:
            handle.start()
            self.addCleanup(handle.stop)

    def app(self):
        return AppTest.from_file(str(ROOT/"app.py"), default_timeout=30).run()

    def assert_clean(self, app):
        self.assertFalse(app.exception, [e.message for e in app.exception])

    def test_split_login_has_no_demo_identity_or_default_credentials(self):
        app = self.app()
        self.assert_clean(app)
        self.assertEqual(element(app.text_input, "Email").value, "")
        self.assertNotIn("demo", app.session_state)
        self.assertFalse(any("Demo123" in m.value for m in app.markdown))
        self.assertTrue(any("Robot và trợ lý AI" in m.value for m in app.markdown))

    def test_wrong_password_does_not_create_authenticated_session(self):
        app = self.app()
        element(app.text_input, "Email").set_value("user@fixture.invalid")
        element(app.text_input, "Mật khẩu").set_value("wrong")
        element(app.button, "Đăng nhập").click().run()
        self.assert_clean(app)
        self.assertTrue(app.error)
        self.assertNotIn("access_token", app.session_state)

    def test_admin_and_user_authentication_keep_all_navigation(self):
        for role in ("USER", "ADMIN"):
            with self.subTest(role=role):
                app = self.app()
                element(app.text_input, "Email").set_value(role.lower()+"@fixture.invalid")
                element(app.text_input, "Mật khẩu").set_value("fixture-only")
                element(app.button, "Đăng nhập").click().run()
                self.assert_clean(app)
                self.assertEqual(len(element(app.sidebar.radio, "Điều hướng").options), 8)
                self.assertEqual(app.session_state["account"]["role"], role)

    def test_failed_identity_lookup_never_renders_dashboard(self):
        self.fixture.fail["/auth/me"] = 401
        app = AppTest.from_file(str(ROOT/"app.py"), default_timeout=30)
        app.session_state["access_token"] = "fixture-expired-access"
        app.run()
        self.assert_clean(app)
        self.assertTrue(app.error)
        self.assertFalse(app.metric)


    def test_dashboard_counts_every_page_and_preserves_real_navigation(self):
        self.fixture.devices = [{"id": str(i), "device_uid": "fixture-robot-"+str(i),
                                  "display_name": "Fixture robot", "connection_status": "offline"}
                                 for i in range(1, 202)]
        app = AppTest.from_file(str(ROOT/"app.py"), default_timeout=30)
        app.session_state["access_token"] = "fixture-user"
        app.run()
        self.assert_clean(app)
        self.assertEqual(element(app.metric, "Robot đã ghép").value, "201")
        self.assertEqual(len([c for c in self.fixture.calls if c[0] == "/devices"]), 3)
        self.assertEqual(len(element(app.sidebar.radio, "Điều hướng").options), 8)

    def test_theme_switch_and_dashboard_navigation(self):
        app = AppTest.from_file(str(ROOT/"app.py"), default_timeout=30)
        app.session_state["access_token"] = "fixture-user"
        app.run()
        element(app.sidebar.toggle, "Chế độ tối").set_value(False).run()
        self.assert_clean(app)
        self.assertEqual(app.session_state["appearance"], "☀️ Sáng")
        element(app.button, "Xem tất cả →").click().run()
        self.assert_clean(app)
        self.assertEqual(element(app.sidebar.radio, "Điều hướng").value, "Robot của tôi")

    def test_dashboard_api_failure_is_not_reported_as_zero_robots(self):
        self.fixture.fail["/devices"] = 503
        app = AppTest.from_file(str(ROOT/"app.py"), default_timeout=30)
        app.session_state["access_token"] = "fixture-user"
        app.run()
        self.assert_clean(app)
        self.assertTrue(app.error)
        self.assertEqual(element(app.metric, "Robot đã ghép").value, "Chưa có dữ liệu")



    def authenticated_app(self, page="Tổng quan", role="USER"):
        self.fixture.role = role
        app = AppTest.from_file(str(ROOT/"app.py"), default_timeout=30)
        app.session_state["access_token"] = "fixture-" + role.lower()
        app.session_state["real_nav_" + self.fixture.account()["id"]] = page
        return app.run()

    def test_all_eight_user_pages_render_without_losing_routes(self):
        for page in ["Tổng quan", "AI Chat", "Robot của tôi", "Trợ lý AI", "API Key cá nhân",
                     "Lịch sử hội thoại", "Quyền riêng tư", "Tài khoản"]:
            with self.subTest(page=page):
                app = self.authenticated_app(page)
                self.assert_clean(app)
                self.assertEqual(element(app.sidebar.radio, "Điều hướng").value, page)

    def test_model_selector_and_explicit_provider_clear_use_existing_contract(self):
        app = self.authenticated_app("Trợ lý AI")
        self.assert_clean(app)
        self.assertIn("fixture-model", element(app.selectbox, "Model LLM").options)
        element(app.selectbox, "Provider ưu tiên").set_value("").run()
        element(app.button, "Lưu cấu hình").click().run()
        self.assert_clean(app)
        writes = [c for c in self.fixture.calls if c[:2] == ("/ai/profile", "PATCH")]
        self.assertEqual(writes[-1][2], {"preferred_provider_id": None, "preferred_llm_model_id": None})

    def test_saved_chat_is_read_only_and_new_chat_never_creates_a_fake_turn(self):
        self.fixture.conversations = [{"id": "90", "user_id": "7", "title": "Saved fixture"}]
        self.fixture.details["90"] = {"id": "90", "user_id": "7",
                                     "messages": [{"role": "assistant", "content": "Saved fixture answer"}]}
        app = self.authenticated_app("AI Chat")
        element(app.button, "Saved fixture").click().run()
        self.assert_clean(app)
        self.assertTrue(app.chat_input[0].disabled)
        element(app.button, "＋ Đoạn chat mới").click().run()
        self.assert_clean(app)
        self.assertFalse(app.chat_input[0].disabled)
        self.assertFalse(any(c[1] == "POST" for c in self.fixture.calls))
        self.assertFalse(any(m.value == "Saved fixture answer" for m in app.markdown))

    def test_history_rejects_other_owner_before_displaying_content(self):
        self.fixture.conversations = [{"id": "90", "user_id": "7", "title": "Saved fixture"}]
        self.fixture.details["90"] = {"id": "90", "user_id": "8",
                                     "messages": [{"role": "assistant", "content": "Must never display"}]}
        app = self.authenticated_app("Lịch sử hội thoại")
        self.assert_clean(app)
        self.assertTrue(app.error)
        self.assertFalse(any("Must never display" in m.value for m in app.markdown))

    def test_delete_history_requires_fresh_confirmation(self):
        self.fixture.conversations = [{"id": "90", "user_id": "7", "title": "Saved fixture"}]
        self.fixture.details["90"] = {"id": "90", "user_id": "7", "messages": []}
        app = self.authenticated_app("Lịch sử hội thoại")
        element(app.button, "Xóa hội thoại").click().run()
        self.assert_clean(app)
        self.assertFalse(any(c[1] == "DELETE" for c in self.fixture.calls))
        self.assertTrue(element(app.button, "Xác nhận").disabled)
        element(app.checkbox, "Tôi xác nhận thao tác này").check().run()
        element(app.button, "Xác nhận").click().run()
        self.assert_clean(app)
        self.assertEqual(len([c for c in self.fixture.calls if c[:2] == ("/conversations/90", "DELETE")]), 1)

    def test_user_cannot_select_admin_route_through_frontend_state(self):
        app = self.authenticated_app("Quản lý người dùng")
        self.assert_clean(app)
        self.assertEqual(element(app.sidebar.radio, "Điều hướng").value, "Tổng quan")
        self.assertFalse(any(c[0] == "/users" for c in self.fixture.calls))



    def test_all_eight_admin_pages_render_without_any_automatic_write(self):
        pages = ["Tổng quan", "Quản lý người dùng", "Quản lý thiết bị", "AI Management",
                 "API Key & Quota", "OTA Firmware", "Logs & Monitoring", "System Settings"]
        for page in pages:
            with self.subTest(page=page):
                self.fixture.calls.clear()
                app = self.authenticated_app(page, "ADMIN")
                self.assert_clean(app)
                self.assertEqual(len(element(app.sidebar.radio, "Điều hướng").options), 8)
                self.assertFalse(any(c[1] != "GET" for c in self.fixture.calls))

    def test_device_cards_paginate_and_keep_existing_actions(self):
        self.fixture.devices = [{"id": str(i), "device_uid": "fixture-"+str(i), "display_name": "Fixture "+str(i),
                                  "connection_status": "online" if i == 1 else "offline"} for i in range(1, 7)]
        app = self.authenticated_app("Robot của tôi")
        self.assert_clean(app)
        self.assertEqual(len([b for b in app.button if b.label == "Hủy liên kết thiết bị"]), 4)
        element(app.number_input, "Trang robot").set_value(2).run()
        self.assert_clean(app)
        self.assertEqual(len([b for b in app.button if b.label == "Hủy liên kết thiết bị"]), 2)
        self.assertFalse(any(c[1] != "GET" for c in self.fixture.calls))

    def test_quota_creation_never_assumes_unlimited_policy(self):
        app = self.authenticated_app("API Key & Quota", "ADMIN")
        element(app.button, "Tạo chính sách quota").click().run()
        self.assert_clean(app)
        self.assertTrue(app.error)
        self.assertFalse(any(c[:2] == ("/admin/quotas", "POST") for c in self.fixture.calls))



    def test_registration_repeat_validation_never_calls_api_on_mismatch(self):
        app = self.app()
        element(app.text_input, "Họ tên").set_value("Fixture")
        element(app.text_input, "Email đăng ký").set_value("new@fixture.invalid")
        element(app.text_input, "Mật khẩu đăng ký").set_value("fixture-password")
        element(app.text_input, "Nhập lại mật khẩu").set_value("different")
        element(app.button, "Tạo tài khoản").click().run()
        self.assert_clean(app)
        self.assertTrue(app.error)
        self.assertFalse(any(c[0] == "/auth/register" for c in self.fixture.calls))

    def test_usage_queries_existing_api_only_after_explicit_request(self):
        app = self.authenticated_app()
        self.assertFalse(any(c[0] == "/usage" for c in self.fixture.calls))
        element(app.button, "Tải thống kê").click().run()
        self.assert_clean(app)
        calls = [c for c in self.fixture.calls if c[0] == "/usage"]
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1], "GET")
        self.assertEqual(set(calls[0][3]), {"from", "to"})


class RestoredClientSafetyTests(unittest.TestCase):
    def test_expired_mutation_is_never_replayed_after_401(self):
        import io
        import types
        from urllib.error import HTTPError
        from nen_tang import backend
        state = {"access_token": "fixture-expired", "refresh_token": "fixture-refresh"}
        error = HTTPError("http://fixture.invalid", 401, "", {}, io.BytesIO(b'{"message":"Unauthorized"}'))
        with patch.object(backend, "st", types.SimpleNamespace(session_state=state)), patch.object(
                backend, "urlopen", side_effect=error) as transport:
            with self.assertRaises(backend.BackendError):
                backend.api("/users/me", "PATCH", {"display_name": "Fixture"})
        self.assertEqual(transport.call_count, 1)
        self.assertNotIn("access_token", state)

    def test_get_without_refresh_clears_expired_session(self):
        import io
        import types
        from urllib.error import HTTPError
        from nen_tang import backend
        state = {"access_token": "fixture-expired"}
        error = HTTPError("http://fixture.invalid", 401, "", {}, io.BytesIO(b'{"message":"Unauthorized"}'))
        with patch.object(backend, "st", types.SimpleNamespace(session_state=state)), patch.object(
                backend, "urlopen", side_effect=error) as transport:
            with self.assertRaises(backend.BackendError):
                backend.api("/auth/me")
        self.assertEqual(transport.call_count, 1)
        self.assertNotIn("access_token", state)

    def test_actual_expired_session_returns_to_restored_login(self):
        import io
        from urllib.error import HTTPError
        error = HTTPError("http://fixture.invalid", 401, "", {}, io.BytesIO(b'{"message":"Unauthorized"}'))
        app = AppTest.from_file(str(ROOT/"app.py"), default_timeout=30)
        app.session_state["access_token"] = "fixture-expired"
        with patch("nen_tang.backend.urlopen", side_effect=error):
            app.run()
        self.assertFalse(app.exception, [e.message for e in app.exception])
        self.assertFalse(app.metric)
        self.assertNotIn("access_token", app.session_state)
        self.assertTrue(any(h.value == "Chào mừng đến AIVA-IoT" for h in app.title))

    def test_collection_rejects_incomplete_page_instead_of_counting_it_as_total(self):
        from giao_dien import live
        with patch.object(live, "api", return_value={"items": [], "total": 200}), patch.object(
                live, "api_error") as report:
            self.assertIsNone(live.collection("/devices"))
            report.assert_called_once()



if __name__ == "__main__":
    unittest.main()
