"""Hồi quy các liên kết và phiên cũ sau khi gộp tám mục User thành năm."""
import unittest
from copy import deepcopy
from smoke import ROOT, clean, login, navigate, widget
from streamlit.testing.v1 import AppTest


class UserNavigation(unittest.TestCase):
    def setUp(self):
        self.app = login(clean(AppTest.from_file(str(ROOT / "app.py"), default_timeout=30).run()), "user@example.test")

    def test_five_labels_and_old_session_migration(self):
        app = self.app
        self.assertEqual(widget(app.sidebar.radio, "Điều hướng").options,
            ["Trang chủ", "Trò chuyện AI", "Robot của tôi", "Cài đặt trợ lý", "Tài khoản"])
        # Nạp phiên cũ trước khi widget mới được dựng; AppTest không thể gửi
        # một giá trị đã bỏ khỏi options của cây widget đang hiển thị.
        previous_data = deepcopy(app.session_state["demo"])
        app = AppTest.from_file(str(ROOT / "app.py"), default_timeout=30)
        app.session_state["demo"] = previous_data
        app.session_state["identity"] = "user1"
        app.session_state["nav_user1"] = "Lịch sử hội thoại"
        clean(app.run())
        self.assertEqual(widget(app.sidebar.radio, "Điều hướng").value, "AI Chat")
        self.assertEqual(app.session_state["user_chat_section_user1"], "Lịch sử")
        self.assertTrue(any(b.label == "Tiếp tục phiên mẫu" for b in app.button))

    def test_history_resume_returns_to_chat(self):
        app = self.app
        navigate(app, "Lịch sử hội thoại")
        widget(app.button, "Tiếp tục phiên mẫu").click()
        clean(app.run())
        self.assertEqual(app.session_state["user_chat_section_user1"], "Trò chuyện")
        self.assertEqual(app.session_state["chat_selected_user1"], "CHAT-001")
        self.assertFalse(app.chat_input[0].disabled)
        navigate(app, "Quyền riêng tư")
        navigate(app, "AI Chat")
        self.assertEqual(app.session_state["chat_selected_user1"], "CHAT-001")
        self.assertFalse(app.chat_input[0].disabled)

    def test_legacy_destinations_select_correct_sections(self):
        app = self.app
        for destination, page, key, tab in [
            ("API Key cá nhân", "Cấu hình trợ lý AI", "user_assistant_section_user1", "Nâng cao"),
            ("Quyền riêng tư", "Tài khoản", "user_account_section_user1", "Quyền riêng tư"),
            ("AI Chat", "AI Chat", "user_chat_section_user1", "Trò chuyện"),
        ]:
            app.session_state["navigate_to"] = destination
            clean(app.run())
            self.assertEqual(widget(app.sidebar.radio, "Điều hướng").value, page)
            self.assertEqual(app.session_state[key], tab)
            self.assertNotIn("navigate_to", app.session_state)


if __name__ == "__main__":
    unittest.main()
