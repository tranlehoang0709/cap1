"""AIVA-IoT entry point: authenticated Backend data only."""
import streamlit as st
from nen_tang.backend import BackendError, api, clear_auth
from nen_tang.chu_de import apply_theme
from giao_dien.live import login_screen, call, render_page, api_error
from thanh_phan.bo_cuc.tieu_de import render_login_header, page_header
from thanh_phan.bo_cuc.thanh_ben import render_sidebar

st.set_page_config(page_title="AIVA-IoT", page_icon="🤖", layout="wide")
if not st.session_state.get("access_token"):
    render_login_header()
    apply_theme()
    login_screen()
    st.stop()

apply_theme()
account = call("/auth/me")
if account is None:
    if not st.session_state.get("access_token"):
        st.info("Phiên đăng nhập hết hạn. Hãy đăng nhập lại.")
        render_login_header()
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
def logout_backend():
    try:
        api("/auth/logout", "POST", {"refresh_token": st.session_state.get("refresh_token", "")})
    except BackendError:
        st.session_state.logout_warning = "Đã xóa phiên giao diện; chưa xác nhận thu hồi phiên tại Backend."
    clear_auth()
    st.session_state.pop("pending_api_confirmation", None)
    for key in list(st.session_state):
        if key.startswith(("api_chat_", "chat_selected_", "history_", "confirm_", "confirmation_scope_", "real_nav_")):
            del st.session_state[key]


# This view model is presentation only. Backend still authenticates every API call.
view = {"id": account["id"], "name": account.get("display_name") or account.get("email", ""),
        "email": account.get("email", ""), "role": "Admin" if role == "ADMIN" else "User"}
page = render_sidebar(view, pages, logout=logout_backend,
                      navigation_key=f"real_nav_{account['id']}")
apply_theme()
descriptions = {
    "Tổng quan": "Tổng quan robot, trợ lý và hoạt động của bạn." if role == "USER" else "Tổng quan nền tảng AIVA-IoT.",
    "AI Chat": "Trò chuyện cùng AIVA và quản lý các phiên hội thoại.",
    "Robot của tôi": "Theo dõi trạng thái và quản lý robot đã ghép nối.",
    "Trợ lý AI": "Tùy chỉnh trợ lý, model và giọng nói.",
    "API Key cá nhân": "Quản lý khóa kết nối AI của bạn.",
    "Lịch sử hội thoại": "Xem và quản lý các hội thoại đã lưu.",
    "Quyền riêng tư": "Chọn cách lưu và quản lý dữ liệu cá nhân.",
    "Tài khoản": "Cập nhật thông tin cá nhân và mật khẩu.",
}
st.session_state.ui_active_page = page
st.session_state.api_table_index = 0
page_header(page, descriptions.get(page, "Quản lý nền tảng AIVA-IoT"))
notice = st.session_state.pop("ui_notice", None)
with st.container(key="portal_flash", border=False):
    if notice:
        st.markdown('<div class="success-animation" aria-hidden="true"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17"/><path d="M11 20l6 6 12-13"/></svg></div>', unsafe_allow_html=True)
        st.success(notice)
try:
    if page == "AI Chat" and role == "USER":
        from nen_tang.backend import base_url
        from tich_hop.giao_dien import api_chat
        from tich_hop.portal import AuthenticatedChatPortal
        from tich_hop.http_client import ApiError
        try:
            api_chat(AuthenticatedChatPortal(account, st.session_state.get("access_token"), base_url(), clear_auth))
        except ApiError as error:
            st.error(str(error))
            if error.kind in ("timeout", "connection", "server"):
                st.caption("Yêu cầu có thể đã được xử lý. Hãy kiểm tra kết quả trước khi gửi lại.")
    else:
        render_page(page, account)
except BackendError as error:
    api_error(error)

from thanh_phan.bieu_mau.xac_nhan import render_pending_confirmation
render_pending_confirmation()
