import streamlit as st
from nen_tang.trang_thai import data, uid, done
from nen_tang.kiem_tra_du_lieu import email_valid


def render():
    from thanh_phan.robot.khung_hien_thi import render_robot_scene
    left, right = st.columns([1.25, 1], gap="large")
    with left, st.container(border=True, key="login_brand_panel"):
        st.markdown('<h2 class="login-heading">Robot và trợ lý AI,<br>trong một không gian.</h2><p class="login-copy">Theo dõi Xiaozhi, tùy chỉnh trợ lý và quản lý hội thoại của bạn.</p>', unsafe_allow_html=True)
        render_robot_scene(hero=True)
    with right, st.container(border=True, key="login_form_panel"):
        render_forms()


def render_forms():
    st.title("Chào mừng đến AIVA-IoT")
    st.caption("Quản lý robot Xiaozhi và trợ lý AI · Bản mô phỏng giao diện")
    with st.expander("Tài khoản trải nghiệm"):
        st.info("Chỉ nhập thông tin thử nghiệm. Admin: admin@example.test · User có robot: user@example.test · User chờ duyệt: new@example.test. Mật khẩu mẫu: Demo123!")
    login, register = st.tabs(["Đăng nhập", "Đăng ký User"])
    with login:
        with st.form("login"):
            email = st.text_input("Email", value="user@example.test", autocomplete="username")
            password = st.text_input("Mật khẩu", type="password", autocomplete="current-password")
            st.checkbox("Ghi nhớ đăng nhập trong phiên", value=True)
            submitted = st.form_submit_button("Đăng nhập mẫu", type="primary", width="stretch")
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
            name = st.text_input("Họ tên", autocomplete="name")
            email = st.text_input("Email đăng ký", autocomplete="email")
            password = st.text_input("Mật khẩu đăng ký", type="password", autocomplete="new-password")
            repeat = st.text_input("Nhập lại mật khẩu", type="password", autocomplete="new-password")
            submitted = st.form_submit_button("Tạo tài khoản User mẫu", width="stretch")
        if submitted:
            if not name.strip() or not email_valid(email.strip()) or len(password) < 8 or password != repeat:
                st.error("Nhập họ tên, email hợp lệ và mật khẩu ít nhất 8 ký tự; hai mật khẩu phải trùng nhau.")
            elif any(u["email"].casefold() == email.strip().casefold() for u in data()["users"]):
                st.error("Email đã tồn tại trong dữ liệu mẫu.")
            else:
                data()["users"].append({"id": uid("USR"), "name": name.strip(), "email": email.strip(), "password": password, "role": "User", "locked": False})
                done("Tạo tài khoản User mẫu; hãy đăng nhập để yêu cầu ghép nối", "Tài khoản")
