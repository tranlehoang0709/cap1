import streamlit as st
from ui.state import data, uid, done
from ui.common import email_valid


def render():
    from ui.motion import render_robot_scene
    left, right = st.columns([1.2, 1])
    with left, st.container(border=True, key="login_brand_panel"):
        st.markdown("## 🤖 AIVA-IoT")
        st.markdown("### System Management Portal")
        st.write("Quản lý hệ thống robot Xiaozhi và nền tảng AI tập trung")
        render_robot_scene(hero=True)
        st.caption("Kết nối thông minh · Trợ lý cá nhân · Quản lý tập trung")
    with right, st.container(border=True, key="login_form_panel"):
        render_forms()


def render_forms():
    st.title("Chào mừng đến AIVA-IoT")
    st.caption("Quản lý robot Xiaozhi và trợ lý AI · Bản mô phỏng giao diện")
    st.info("Chỉ nhập thông tin thử nghiệm. Admin: admin@example.test · User có robot: user@example.test · User chờ duyệt: new@example.test. Mật khẩu mẫu: Demo123!")
    login, register = st.tabs(["Đăng nhập", "Đăng ký User"])
    with login:
        with st.form("login"):
            email = st.text_input("Email", value="user@example.test")
            password = st.text_input("Mật khẩu", type="password")
            st.checkbox("Ghi nhớ đăng nhập trong phiên", value=True)
            submitted = st.form_submit_button("Đăng nhập mẫu", type="primary")
        if submitted:
            account = next((u for u in data()["users"] if u["email"].casefold() == email.strip().casefold() and u["password"] == password), None)
            if not account:
                st.error("Email hoặc mật khẩu mẫu không đúng.")
            elif account["locked"]:
                st.error("Tài khoản mẫu đang bị khóa.")
            else:
                st.session_state.identity = account["id"]
                done("Đăng nhập tài khoản mẫu", "Tài khoản")
        with st.expander("Quên mật khẩu"):
            reset_email = st.text_input("Email khôi phục")
            if st.button("Gửi yêu cầu khôi phục"):
                if not email_valid(reset_email.strip()):
                    st.error("Nhập email hợp lệ.")
                else:
                    st.info("Đã mô phỏng yêu cầu khôi phục. Chưa kết nối backend nên chưa gửi email.")
    with register:
        if not data()["settings"].get("registration", True):
            st.info("Hệ thống đang tạm đóng đăng ký tài khoản mới.")
            return
        with st.form("register"):
            name = st.text_input("Họ tên")
            email = st.text_input("Email đăng ký")
            password = st.text_input("Mật khẩu đăng ký", type="password")
            repeat = st.text_input("Nhập lại mật khẩu", type="password")
            submitted = st.form_submit_button("Tạo tài khoản User mẫu")
        if submitted:
            if not name.strip() or not email_valid(email.strip()) or len(password) < 8 or password != repeat:
                st.error("Nhập họ tên, email hợp lệ và mật khẩu ít nhất 8 ký tự; hai mật khẩu phải trùng nhau.")
            elif any(u["email"].casefold() == email.strip().casefold() for u in data()["users"]):
                st.error("Email đã tồn tại trong dữ liệu mẫu.")
            else:
                data()["users"].append({"id": uid("USR"), "name": name.strip(), "email": email.strip(), "password": password, "role": "User", "locked": False})
                done("Tạo tài khoản User mẫu; hãy đăng nhập để yêu cầu ghép nối", "Tài khoản")
