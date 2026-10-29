"""Biểu mẫu tài khoản, giữ nguyên xử lý mô phỏng và widget key."""
import streamlit as st
from nen_tang.trang_thai import current_user, data, done
from nen_tang.kiem_tra_du_lieu import email_valid


def account():
    u = current_user()
    profile, password = st.tabs(["Hồ sơ", "Đổi mật khẩu"])
    with profile:
        with st.form("profile"):
            name = st.text_input("Họ tên", value=u["name"])
            email = st.text_input("Email", value=u["email"])
            st.text_input("Vai trò", value=u["role"], disabled=True)
            save = st.form_submit_button("Lưu hồ sơ mẫu")
        if save:
            if not name.strip() or not email_valid(email.strip()):
                st.error("Họ tên và email phải hợp lệ.")
            elif any(x["id"] != u["id"] and x["email"].casefold() == email.strip().casefold() for x in data()["users"]):
                st.error("Email đã tồn tại.")
            else:
                u.update(name=name.strip(), email=email.strip())
                done("Cập nhật hồ sơ cá nhân", "Tài khoản")
    with password:
        st.caption("Chỉ dùng mật khẩu thử nghiệm; không nhập mật khẩu thật.")
        with st.form("password"):
            old = st.text_input("Mật khẩu hiện tại", type="password")
            new = st.text_input("Mật khẩu mới", type="password")
            repeat = st.text_input("Nhập lại mật khẩu mới", type="password")
            save = st.form_submit_button("Đổi mật khẩu mẫu")
        if save:
            if old != u["password"]:
                st.error("Mật khẩu hiện tại không đúng.")
            elif len(new) < 8 or new != repeat:
                st.error("Mật khẩu mới cần ít nhất 8 ký tự và khớp xác nhận.")
            else:
                u["password"] = new
                done("Đổi mật khẩu mẫu", "Tài khoản")

