"""Kiểm tra chuyển phạm vi xác nhận, không kích hoạt bất kỳ nút xóa nào."""
import unittest
from copy import deepcopy
from smoke import ROOT, clean, login, navigate, widget
from streamlit.testing.v1 import AppTest


class PrivacyConfirmation(unittest.TestCase):
    def test_category_transition_and_rerun(self):
        app = login(clean(AppTest.from_file(str(ROOT / "app.py"), default_timeout=30).run()), "user@example.test")
        navigate(app, "Quyền riêng tư")
        before = deepcopy(app.session_state["demo"])
        consent = lambda: widget(app.checkbox, "Xác nhận xóa dữ liệu mẫu đã chọn")
        category = lambda: widget(app.selectbox, "Dữ liệu cần xóa")
        self.assertFalse(consent().value)
        consent().check().run()
        self.assertTrue(consent().value)
        clean(app.run())
        self.assertTrue(consent().value, "Rerun không đổi phạm vi phải giữ xác nhận")
        category().set_value("Lịch sử hội thoại").run()
        self.assertTrue(consent().value, "Chọn lại cùng danh mục không xóa xác nhận")
        category().set_value("Toàn bộ dữ liệu AI cá nhân").run()
        self.assertFalse(consent().value)
        consent().check().run()
        self.assertTrue(consent().value)
        category().set_value("Lịch sử hội thoại").run()
        self.assertFalse(consent().value, "A → B → A luôn cần xác nhận lại")
        clean(app.run())
        self.assertFalse(consent().value)
        self.assertEqual(app.session_state["demo"], before, "Chỉ đổi UI, không xóa dữ liệu")
        self.assertFalse(app.exception)


if __name__ == "__main__":
    unittest.main()
