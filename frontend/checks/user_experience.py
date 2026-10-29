"""Hồi quy UX có nguồn dữ liệu: không giả lập trạng thái robot thời gian thực."""
from copy import deepcopy
import unittest
from smoke import ROOT, clean, login, navigate, widget
from streamlit.testing.v1 import AppTest


class UserExperience(unittest.TestCase):
    def setUp(self):
        self.app = login(clean(AppTest.from_file(str(ROOT / "app.py"), default_timeout=30).run()), "user@example.test")

    def text(self, elements):
        return "\n".join(e.value for e in elements)

    def test_status_uses_owned_devices_and_updates_in_chat(self):
        app = self.app
        self.assertIn("2 đang trực tuyến", self.text(app.markdown))
        self.assertIn("1 đang ngoại tuyến", self.text(app.markdown))
        self.assertIn("Dữ liệu mẫu", self.text(app.caption))
        for device in app.session_state["demo"]["devices"]:
            if device["owner"] == "user1":
                device["online"] = False
        clean(app.run())
        self.assertIn("0 đang trực tuyến", self.text(app.markdown))
        self.assertIn("3 đang ngoại tuyến", self.text(app.markdown))
        navigate(app, "AI Chat")
        self.assertIn("0 đang trực tuyến", self.text(app.markdown))
        self.assertIn("3 đang ngoại tuyến", self.text(app.markdown))
        self.assertIn("chưa phản ánh kết nối với thiết bị thật", self.text(app.caption))

    def test_no_owned_devices_does_not_claim_connectivity(self):
        app = self.app
        for device in app.session_state["demo"]["devices"]:
            if device["owner"] == "user1":
                device["owner"] = None
        clean(app.run())
        self.assertIn("Chưa có robot được duyệt", self.text(app.markdown))
        self.assertNotIn("đang trực tuyến", self.text(app.markdown))
        navigate(app, "AI Chat")
        self.assertIn("chat mô phỏng", self.text(app.caption))
        widget(app.button, "Xem cách ghép nối robot").click()
        clean(app.run())
        self.assertEqual(widget(app.sidebar.radio, "Điều hướng").value, "Thiết bị của tôi")
        self.assertEqual(app.get("progress")[0].proto.value, 0)

    def test_pairing_validation_submission_and_duplicate(self):
        app = self.app
        navigate(app, "Thiết bị của tôi")
        before = deepcopy(app.session_state["demo"]["requests"])
        self.assertEqual(app.get("progress")[0].proto.value, 0)
        for code, guidance in [("", "Bạn chưa nhập mã"), ("NO_SUCH_DEMO_CODE", "Không tìm thấy mã"), ("PAIR001", "đã được liên kết")]:
            widget(app.text_input, "Mã ghép nối robot").set_value(code)
            widget(app.button, "Gửi yêu cầu mẫu").click()
            clean(app.run())
            self.assertIn(guidance, self.text(app.error))
            self.assertEqual(app.session_state["demo"]["requests"], before)
        widget(app.text_input, "Mã ghép nối robot").set_value("PAIR002")
        widget(app.button, "Gửi yêu cầu mẫu").click()
        clean(app.run())
        requests = app.session_state["demo"]["requests"]
        self.assertEqual(len(requests), len(before) + 1)
        self.assertEqual(requests[-1]["status"], "Chờ duyệt")
        self.assertEqual(app.get("progress")[0].proto.value, 66)
        self.assertIsNone(next(d for d in app.session_state["demo"]["devices"] if d["id"] == "XB-002")["owner"])
        widget(app.button, "Gửi yêu cầu mẫu").click()
        clean(app.run())
        self.assertIn("không cần gửi lại", self.text(app.error))
        self.assertEqual(len(app.session_state["demo"]["requests"]), len(before) + 1)

    def test_pairing_feedback_follows_decision_and_current_ownership(self):
        app = self.app
        navigate(app, "Thiết bị của tôi")
        widget(app.text_input, "Mã ghép nối robot").set_value("PAIR002")
        widget(app.button, "Gửi yêu cầu mẫu").click()
        clean(app.run())
        # Đầu vào test đại diện cho bản ghi do luồng phê duyệt hiện có cập nhật.
        request = app.session_state["demo"]["requests"][-1]
        request["status"] = "Đã duyệt"
        robot = next(d for d in app.session_state["demo"]["devices"] if d["id"] == "XB-002")
        robot["owner"] = "user1"
        clean(app.run())
        self.assertEqual(app.get("progress")[0].proto.value, 100)
        self.assertIn("đã được liên kết với tài khoản", self.text(app.success))
        robot["owner"] = None
        clean(app.run())
        self.assertIn("hiện không liên kết", self.text(app.info))
        self.assertFalse(app.success)
        request["status"] = "Từ chối"
        clean(app.run())
        self.assertIn("không được duyệt", self.text(app.warning))
        self.assertFalse(app.get("progress"))

    def test_chat_unavailable_guidance_preserves_diagnostics_and_history(self):
        app = self.app
        for provider in app.session_state["demo"]["providers"].values():
            provider["enabled"] = False
        navigate(app, "AI Chat")
        self.assertIn("chưa có dịch vụ AI", self.text(app.warning))
        self.assertIn("allowed_providers() đang rỗng", self.text(app.caption))
        self.assertFalse(app.chat_input)
        navigate(app, "Lịch sử hội thoại")
        self.assertTrue(app.chat_message)


if __name__ == "__main__":
    unittest.main()
