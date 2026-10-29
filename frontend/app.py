"""AIVA-IoT frontend, using session-local demo data."""
import streamlit as st
from nen_tang.trang_thai import init_demo, current_user
from giao_dien.xac_thuc import dang_nhap as auth
from giao_dien.dinh_tuyen import USER_ROUTES, ADMIN_ROUTES
from nen_tang.chu_de import apply_theme
from nen_tang.dieu_huong import USER_LABELS
from thanh_phan.bo_cuc.tieu_de import page_header, render_login_header
from thanh_phan.bo_cuc.thanh_ben import render_sidebar

st.set_page_config(page_title="AIVA-IoT", page_icon="🤖", layout="wide")
init_demo()
account = current_user()
if not account:
    render_login_header()
    apply_theme()
    auth.render()
    st.stop()
if account["locked"]:
    st.session_state.identity = None
    st.error("Tài khoản đã bị khóa.")
    if st.button("Về đăng nhập"):
        st.rerun()
    st.stop()
routes = ADMIN_ROUTES if account["role"] == "Admin" else USER_ROUTES
page = render_sidebar(account, routes)

apply_theme()
if page != "AI Chat" or account["role"] == "User":
    descriptions = {
        "Dashboard": "Tổng quan robot, trợ lý AI và hoạt động gần đây.",
        "AI Chat": "Trò chuyện cùng AIVA và quản lý các phiên hội thoại.",
        "Thiết bị của tôi": "Theo dõi trạng thái và quản lý robot đã ghép nối.",
        "Cấu hình trợ lý AI": "Tùy chỉnh tính cách, giọng nói và dịch vụ AI của bạn.",
        "API Key cá nhân": "Quản lý khóa thử nghiệm cho các dịch vụ AI.",
        "Lịch sử hội thoại": "Xem lại hội thoại, bộ nhớ và tài liệu cá nhân.",
        "Quyền riêng tư": "Chọn cách lưu và quản lý dữ liệu cá nhân.",
        "Tài khoản": "Cập nhật thông tin cá nhân và mật khẩu.",
        "Quản lý người dùng": "Quản lý tài khoản, quyền truy cập và trạng thái.",
        "Quản lý thiết bị": "Quản lý robot và theo dõi kết nối hệ thống.",
        "AI Management": "Cấu hình và quản lý các dịch vụ AI.",
        "API Key & Quota": "Quản lý khóa hệ thống và giới hạn sử dụng.",
        "OTA Firmware": "Quản lý phiên bản và cập nhật firmware.",
        "Logs & Monitoring": "Theo dõi nhật ký và tài nguyên hệ thống.",
        "System Settings": "Thiết lập kết nối, bảo mật và thông báo.",
    }
    page_header(USER_LABELS.get(page, page) if account["role"] == "User" else page,
                descriptions.get(page, "Quản lý nền tảng AIVA-IoT"))
flash = st.session_state.pop("flash", None)
with st.container(key="portal_flash", border=False):
    if flash:
        st.markdown('<div class="success-animation" aria-hidden="true"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17"/><path d="M11 20l6 6 12-13"/></svg></div>', unsafe_allow_html=True)
        st.success(flash)
routes[page]()
