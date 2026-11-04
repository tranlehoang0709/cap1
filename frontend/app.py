"""AIVA-IoT entry point: authenticated Backend data only."""
import streamlit as st
from nen_tang.backend import BackendError, api, clear_auth
from nen_tang.chu_de import apply_theme
from giao_dien.live import login_screen, call, render_page, api_error

st.set_page_config(page_title="AIVA-IoT", page_icon="🤖", layout="wide")
apply_theme()
if not st.session_state.get("access_token"):
    login_screen()
    st.stop()

account = call("/auth/me")
if account is None:
    if not st.session_state.get("access_token"):
        st.info("Phiên đăng nhập hết hạn. Hãy đăng nhập lại.")
        login_screen()
    st.stop()
st.session_state.account = account
role = account.get("role")
if role not in ("ADMIN", "USER"):
    st.error("Backend trả về vai trò không hợp lệ.")
    clear_auth()
    st.stop()

user_pages = ["Tổng quan", "AI Chat", "Robot của tôi", "Trợ lý AI", "API Key cá nhân", "Lịch sử hội thoại", "Quyền riêng tư", "Tài khoản"]
admin_pages = ["Tổng quan", "Quản lý người dùng", "Quản lý thiết bị", "AI Management", "API Key & Quota", "OTA Firmware", "Logs & Monitoring", "System Settings"]
pages = admin_pages if role == "ADMIN" else user_pages
st.sidebar.title("🤖 AIVA-IoT")
st.sidebar.caption("Kết nối Backend · dữ liệu trực tiếp")
page = st.sidebar.radio("Điều hướng", pages, key=f"real_nav_{account.get('id', 'user')}")
st.sidebar.divider()
st.sidebar.write(f"**{account.get('display_name', '')}**")
st.sidebar.caption(f"{account.get('email', '')} · {role}")
if st.sidebar.button("Đăng xuất", width="stretch"):
    try:
        api("/auth/logout", "POST", {"refresh_token": st.session_state.get("refresh_token", "")})
    except BackendError:
        pass
    clear_auth()
    st.rerun()
st.title(page)
try:
    render_page(page, account)
except BackendError as error:
    api_error(error)
