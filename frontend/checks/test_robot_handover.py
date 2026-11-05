"""Offline Streamlit smoke tests. All writes go to the in-memory test double."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from streamlit.testing.v1 import AppTest
from giao_dien import live
from nen_tang.backend import BackendError
from nen_tang import backend


class TestBackend:
    def __init__(self):
        self.devices = []
        self.requests = []
        self.calls = []
        self.profile = {"preferred_provider_id": "1", "preferred_llm_model_id": "11"}
        self.timeout_revoke = False
        self.failures = {}
        self.models_override = None
        self.account = {'id': 'test', 'role': 'USER'}
        self.keys = []

    def __call__(self, path, method="GET", body=None, **kwargs):
        self.calls.append((path, method, body, kwargs))
        if (path, method) in self.failures:
            raise self.failures[path, method]
        if path == '/auth/me':
            return self.account
        if path in ("/devices/admin/all", "/devices"):
            return {"items": self.devices[:], "total_pages": 1}
        if path in ("/devices/admin/pairing-requests", "/devices/pairing-requests/mine"):
            return {"items": self.requests[:], "total_pages": 1}
        if path == "/devices/admin":
            if any(d["device_uid"] == body["device_uid"] for d in self.devices):
                raise BackendError(400, "Device UID is already registered")
            d = dict(body, id=str(len(self.devices) + 1), lifecycle_status="available")
            self.devices.append(d)
            return d
        if path.endswith("/pairing-codes"):
            return {"pairing_code": "0" * 32, "expires_at": "2026-11-05T12:00:00Z"}
        if path.endswith("/revoke"):
            if self.timeout_revoke:
                raise BackendError(0, "test timeout")
            self.devices[0]["lifecycle_status"] = "reset_pending"
            return {"status": "RESET_PENDING", "resetStatus": "PENDING"}
        if path.endswith("/reset-status"):
            return {"status": "PENDING", "deviceId": path.split("/")[3]}
        if path == "/devices/pairing-requests":
            if self.requests:
                raise BackendError(400, "Pairing code is invalid, expired, or already used")
            r = {"id": "41", "device_id": "1", "user_id": "7", "status": "pending"}
            self.requests.append(r)
            return r
        if path.endswith("/approve") or path.endswith("/reject"):
            self.requests[0]["status"] = "approved" if path.endswith("/approve") else "rejected"
            return self.requests[0]
        if path == "/ai/profile":
            if method == "PATCH":
                self.profile = body
            return self.profile
        if path == "/ai/providers":
            return [{"id": "1", "name": "OpenAI", "code": "OPENAI", "is_enabled": True},
                    {"id": "2", "name": "Gemini", "code": "GEMINI", "is_enabled": True}]
        if path == "/api-keys":
            if method == "POST":
                self.keys.append({"id": str(len(self.keys) + 1), "provider_id": body["provider_id"],
                                  "label": body["label"], "secret_hint": "configured", "is_active": True})
                return self.keys[-1]
            return self.keys
        if path.startswith("/api-keys/"):
            ident = path.rsplit("/", 1)[-1]
            key = next((item for item in self.keys if item["id"] == ident), None)
            if key is None:
                raise BackendError(404, "API key was not found")
            if method == "PATCH":
                key.update(label=body["label"], secret_hint="configured")
            elif method == "DELETE":
                key["is_active"] = False
            return key
        if path.endswith("/models"):
            if self.models_override is not None:
                return self.models_override
            p = path.split("/")[3]
            return [{"id": p + "1", "provider_id": p, "model_code": "model" + p, "capability": "LLM", "is_enabled": True}]
        if path == "/conversations":
            return {"items": [{"id": "1", "device_id": "9", "title": "old robot"}], "total_pages": 1}
        if path == "/conversations/1":
            return {"messages": [{"role": "user", "content": "history retained"}]}
        raise AssertionError((path, method))


class RobotSmokeTests(unittest.TestCase):
    def setUp(self):
        self.be = TestBackend()
        p = patch.object(live, "api", self.be)
        p.start()
        self.addCleanup(p.stop)

    def app(self, page):
        app = AppTest.from_string(f'from giao_dien.live import render_page\nrender_page({page!r}, {{"role": "ADMIN"}})')
        app.run()
        self.assertFalse(app.exception)
        return app

    def button(self, app, label):
        return next(b for b in app.button if b.label == label)

    def input(self, app, label):
        return next(b for b in app.text_input if b.label == label)

    def device(self, ident="1", status="available"):
        return {"id": ident, "device_uid": "test-" + ident, "lifecycle_status": status}

    def test_register_code_and_duplicate_preserves_input(self):
        a = self.app("Quản lý thiết bị")
        self.input(a, "Device UID").set_value("test-new")
        self.button(a, "Đăng ký thiết bị").click().run()
        self.assertFalse(a.exception)
        self.assertEqual(len(self.be.devices), 1)
        self.assertEqual(self.input(a, "Device UID").value, "")
        self.button(a, "Xuất mã ghép nối").click().run()
        writes = [(p, b) for p, m, b, _ in self.be.calls if m == "POST"]
        self.assertEqual(writes[-1], ("/devices/admin/1/pairing-codes", {"ttl_minutes": 10}))
        self.assertEqual(a.code[0].value, "0" * 32)
        self.input(a, "Device UID").set_value("test-new")
        self.button(a, "Đăng ký thiết bị").click().run()
        self.assertEqual(self.input(a, "Device UID").value, "test-new")
        self.assertTrue(a.error)

    def test_personal_key_add_replace_and_revoke_never_renders_secret(self):
        a = self.app("API Key cá nhân")
        self.input(a, "Nhãn khóa").set_value("Gemini cá nhân")
        self.input(a, "API key").set_value("fixture-secret-never-persist")
        self.button(a, "Lưu khóa vào Backend").click().run()
        self.assertEqual(self.be.keys[0]["secret_hint"], "configured")
        self.assertNotIn("fixture-secret-never-persist", repr(self.be.keys))
        self.input(a, "Nhãn mới").set_value("Gemini thay thế")
        self.input(a, "API key mới").set_value("replacement-fixture-secret")
        self.button(a, "Thay thế khóa").click().run()
        self.assertEqual(self.be.keys[0]["label"], "Gemini thay thế")
        self.assertNotIn("replacement-fixture-secret", repr(self.be.keys))
        self.button(a, "Thu hồi khóa Gemini thay thế").click().run()
        self.assertFalse(self.be.keys[0]["is_active"])

    def test_code_gates_pending_assigned_reset_and_unknown(self):
        for status, requests, blocked in [
            ("available", [], False), ("assigned", [], True), ("reset_pending", [], True),
            ("available", [{"id": "41", "device_id": "1", "status": "pending"}], True)]:
            self.be.devices = [self.device(status=status)]
            self.be.requests = requests
            a = self.app("Quản lý thiết bị")
            self.assertEqual(self.button(a, "Xuất mã ghép nối").disabled, blocked)

    def test_pair_keeps_leading_zero_clears_success_and_rejects_reuse(self):
        a = self.app("Robot của tôi")
        self.input(a, "Pairing code").set_value("0" * 32)
        self.button(a, "Gửi yêu cầu ghép nối").click().run()
        self.assertFalse(a.exception)
        self.assertEqual(self.input(a, "Pairing code").value, "")
        self.assertTrue(any("Chờ Admin duyệt" in s.value for s in a.success))
        sent = [b for p, m, b, _ in self.be.calls if m == "POST" and p == "/devices/pairing-requests"]
        self.assertEqual(sent, [{"pairing_code": "0" * 32}])
        self.input(a, "Pairing code").set_value("0" * 32)
        self.button(a, "Gửi yêu cầu ghép nối").click().run()
        self.assertTrue(a.error)
        self.assertFalse(a.success)

    def test_review_uses_request_id(self):
        self.be.requests = [{"id": "41", "device_id": "9", "status": "pending"}]
        a = self.app("Quản lý thiết bị")
        self.button(a, "Duyệt").click().run()
        self.assertFalse(a.exception)
        self.assertTrue(any(p == "/devices/admin/pairing-requests/41/approve" for p, m, _, _ in self.be.calls if m == "POST"))
        self.assertFalse(any(b.label == "Duyệt" for b in a.button))

    def test_two_robots_then_one_and_no_user_unlink(self):
        self.be.devices = [self.device("1", "assigned"), self.device("2", "assigned")]
        a = self.app("Robot của tôi")
        self.assertEqual(len(a.expander), 2)
        self.assertFalse(any(b.label == "Hủy liên kết thiết bị" for b in a.button))
        self.be.devices.pop(0)
        self.button(a, "Làm mới danh sách").click().run()
        self.assertEqual(len(a.expander), 1)
        self.assertIn("2", a.expander[0].label)

    def test_revoke_confirmation_timeout_refresh_reuses_key(self):
        self.be.devices = [self.device(status="assigned")]
        self.be.timeout_revoke = True
        a = self.app("Quản lý thiết bị")
        self.button(a, "Gỡ người dùng và reset").click().run()
        self.assertFalse(any(p.endswith("/revoke") for p, _, _, _ in self.be.calls))
        a.text_area[0].set_value("test transfer")
        a.checkbox[0].check()
        self.button(a, "Gỡ người dùng và reset").click().run()
        self.button(a, "Làm mới trạng thái reset").click().run()
        a.checkbox[0].check()
        self.button(a, "Gỡ người dùng và reset").click().run()
        writes = [(b, kw) for p, m, b, kw in self.be.calls if m == "POST" and p.endswith("/revoke")]
        self.assertEqual(len(writes), 2)
        self.assertEqual(writes[0], writes[1])
        self.assertEqual(writes[0][0], {"reason": "test transfer"})
        self.assertEqual(len(writes[0][1]["headers"]["Idempotency-Key"]), 32)

    def test_model_gate_change_save_reload(self):
        a = self.app("Trợ lý AI")
        self.assertFalse(a.selectbox)
        self.be.devices = [self.device(status="assigned")]
        a.run()
        a.selectbox[0].select("Gemini (GEMINI)").run()
        self.assertEqual(a.selectbox[1].value, "Không chọn")
        a.selectbox[1].select("model2 · ID 21").run()
        self.button(a, "Lưu cấu hình").click().run()
        self.assertFalse(a.exception)
        self.assertEqual(self.be.profile["preferred_provider_id"], "2")
        self.assertEqual(self.be.profile["preferred_llm_model_id"], "21")
        a.run()
        self.assertEqual(a.selectbox[1].value, "model2 · ID 21")

    def test_history_without_robot_and_filter(self):
        a = self.app("Lịch sử hội thoại")
        self.assertTrue(any("history retained" in m.value for m in a.markdown))
        a.selectbox[0].select("Không gắn robot").run()
        self.assertFalse(any(s.label == "Mở hội thoại" for s in a.selectbox))

    def test_model_empty_failed_and_foreign_models_cannot_save(self):
        self.be.devices = [self.device(status="assigned")]
        for models in ([], [{"id": "999", "provider_id": "2", "model_code": "foreign", "capability": "LLM", "is_enabled": True}]):
            self.be.models_override = models
            a = self.app("Trợ lý AI")
            self.assertTrue(self.button(a, "Lưu cấu hình").disabled)
        self.be.failures['/ai/providers/1/models', 'GET'] = BackendError(503, 'test unavailable')
        a = self.app("Trợ lý AI")
        self.assertTrue(a.error)
        self.assertTrue(self.button(a, "Lưu cấu hình").disabled)
        self.assertFalse(any(m == "PATCH" for _, m, _, _ in self.be.calls))

    def test_request_load_error_disables_code_and_errors_do_not_show_success(self):
        self.be.devices = [self.device()]
        self.be.failures['/devices/admin/pairing-requests', 'GET'] = BackendError(503, 'test unavailable')
        a = self.app("Quản lý thiết bị")
        self.assertTrue(self.button(a, "Xuất mã ghép nối").disabled)
        self.be.failures.clear()
        for code in (400, 401, 403, 409, 500, 0):
            self.be.failures['/devices/pairing-requests', 'POST'] = BackendError(code, 'test failure')
            a = self.app("Robot của tôi")
            self.input(a, "Pairing code").set_value('0' * 32)
            self.button(a, "Gửi yêu cầu ghép nối").click().run()
            self.assertTrue(a.error)
            self.assertFalse(a.success)
            self.assertEqual(self.input(a, "Pairing code").value, '0' * 32)

    def test_code_replacement_and_reset_completion(self):
        self.be.devices = [self.device()]
        a = self.app("Quản lý thiết bị")
        self.button(a, "Xuất mã ghép nối").click().run()
        replacement = {"pairing_code": "1" * 32, "expires_at": "2026-11-05T13:00:00Z"}
        previous = live.api
        def api(path, method="GET", body=None, **kwargs):
            if path.endswith('/pairing-codes'):
                self.be.calls.append((path, method, body, kwargs))
                return replacement
            return previous(path, method, body, **kwargs)
        with patch.object(live, 'api', api):
            self.button(a, "Xuất mã ghép nối").click().run()
        self.assertEqual(len(a.code), 1)
        self.assertEqual(a.code[0].value, '1' * 32)
        writes = [c for c in self.be.calls if c[0].endswith('/pairing-codes')]
        self.assertEqual(len(writes), 2)
        self.be.devices[0]['lifecycle_status'] = 'reset_pending'
        a.run()
        self.assertTrue(self.button(a, "Xuất mã ghép nối").disabled)
        self.assertFalse(a.code)
        self.be.devices[0]['lifecycle_status'] = 'available'
        self.button(a, "Làm mới trạng thái reset").click().run()
        self.assertFalse(self.button(a, "Xuất mã ghép nối").disabled)
        self.assertFalse(a.code)

    def test_admin_and_user_entrypoint_navigation(self):
        self.be.devices = [self.device()]
        for role, page in [('ADMIN', 'Quản lý thiết bị'), ('USER', 'Robot của tôi')]:
            self.be.account = {'id': 'test', 'role': role}
            with patch.object(backend, 'api', return_value={'id': 'test', 'role': role}):
                a = AppTest.from_file(str(Path(__file__).resolve().parents[1] / 'app.py'))
                a.session_state['access_token'] = 'test-only'
                # First page is dashboard; avoid unrelated dashboard endpoints.
                a.session_state['real_nav_test'] = page
                a.run()
            self.assertFalse(a.exception)
            self.assertEqual(a.title[0].value, page)

    def test_pending_request_on_later_page_is_not_overlooked(self):
        with patch.object(live, 'call', side_effect=[
            {'items': [{'id': '1', 'status': 'approved'}], 'total_pages': 2},
            {'items': [{'id': '2', 'device_id': '9', 'status': 'pending'}], 'total_pages': 2}
        ]) as read:
            requests = live.all_records('/devices/admin/pairing-requests')
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[-1]['status'], 'pending')
        self.assertEqual(read.call_args_list[-1].kwargs['query']['page'], 2)


if __name__ == "__main__":
    unittest.main()
