"""Kiểm tra trạng thái rỗng và xác nhận theo đúng mục tiêu trong dữ liệu mẫu."""
import unittest
from smoke import ROOT, clean, widget
from streamlit.testing.v1 import AppTest


def page(module, function, setup=""):
    source = f'''
import sys
sys.path.insert(0, {str(ROOT)!r})
import streamlit as st
from nen_tang.trang_thai import init_demo, data
init_demo()
st.session_state.identity = "admin"
{setup}
from giao_dien.quan_tri.{module} import {function}
{function}()
'''
    return clean(AppTest.from_string(source, default_timeout=30).run())


class AdminStabilization(unittest.TestCase):
    def test_empty_devices(self):
        app = page("quan_ly_thiet_bi", "devices", 'data()["devices"] = []; data()["requests"] = []')
        self.assertTrue(any("Chưa có robot để gán" in i.value for i in app.info))

    def test_empty_ota_targets(self):
        app = page("firmware_ota", "firmware", 'data()["devices"] = []')
        self.assertTrue(widget(app.button, "Cung cấp bản cập nhật mẫu").disabled)
        self.assertTrue(any("Chưa có robot nhận" in i.value for i in app.info))

    def test_empty_quota_users(self):
        app = page("khoa_api_va_han_muc", "quotas", 'data()["users"] = [u for u in data()["users"] if u["role"] == "Admin"]; data()["quotas"] = []')
        self.assertTrue(widget(app.button, "Lưu hạn mức mẫu").disabled)
        self.assertEqual(app.session_state["demo"]["quotas"], [])

    def assert_switch(self, app, selector, label, consent, submit=None):
        box = lambda: widget(app.checkbox, consent)
        def check():
            box().check()
            if submit:
                widget(app.button, submit).click()
            clean(app.run())
        check()
        self.assertTrue(box().value)
        clean(app.run())
        self.assertTrue(box().value)
        select = widget(getattr(app, selector), label)
        original = select.value
        other = next(o for o in select.options if o != original)
        select.set_value(other).run()
        clean(app)
        self.assertFalse(box().value)
        check()
        widget(getattr(app, selector), label).set_value(original).run()
        clean(app)
        self.assertFalse(box().value)

    def test_assignment_confirmation(self):
        app = page("quan_ly_thiet_bi", "devices")
        self.assert_switch(app, "selectbox", "Chọn robot", "Tôi xác nhận thao tác trên dữ liệu mẫu")
        self.assert_switch(app, "selectbox", "Gán cho", "Tôi xác nhận thao tác trên dữ liệu mẫu")

    def test_ota_confirmation(self):
        app = page("firmware_ota", "firmware")
        self.assert_switch(app, "selectbox", "Robot nhận bản cập nhật", "Xác nhận mô phỏng cung cấp bản cập nhật")
        if len(widget(app.selectbox, "Phiên bản cập nhật").options) > 1:
            self.assert_switch(app, "selectbox", "Phiên bản cập nhật", "Xác nhận mô phỏng cung cấp bản cập nhật")

    def test_role_target_confirmation(self):
        app = page("quan_ly_nguoi_dung", "roles")
        self.assert_switch(app, "selectbox", "Chọn tài khoản", "Xác nhận thay đổi quyền mẫu", "Cập nhật Role")
        before = [(u["id"], u["role"]) for u in app.session_state["demo"]["users"]]
        widget(app.checkbox, "Xác nhận thay đổi quyền mẫu").check().run()
        role = widget(app.selectbox, "Role")
        role.set_value("User" if role.value == "Admin" else "Admin")
        widget(app.button, "Cập nhật Role").click().run()
        clean(app)
        self.assertEqual(before, [(u["id"], u["role"]) for u in app.session_state["demo"]["users"]])

    def test_role_change_after_fresh_confirmation(self):
        app = page("quan_ly_nguoi_dung", "roles")
        widget(app.selectbox, "Chọn tài khoản").set_value("user1").run()
        widget(app.selectbox, "Role").set_value("Admin")
        widget(app.checkbox, "Xác nhận thay đổi quyền mẫu").check()
        widget(app.button, "Cập nhật Role").click().run()
        clean(app)
        self.assertEqual(next(u for u in app.session_state["demo"]["users"] if u["id"] == "user1")["role"], "User")
        widget(app.checkbox, "Xác nhận thay đổi quyền mẫu").check()
        widget(app.button, "Cập nhật Role").click().run()
        clean(app)
        self.assertEqual(next(u for u in app.session_state["demo"]["users"] if u["id"] == "user1")["role"], "Admin")

    def test_delete_target_confirmation(self):
        app = page("quan_ly_nguoi_dung", "render_page")
        self.assert_switch(app, "selectbox", "Tài khoản cần xóa", "Xác nhận xóa tài khoản và dữ liệu demo liên quan")


if __name__ == "__main__":
    unittest.main()
