"""AIVA-IoT frontend, using session-local demo data."""
import streamlit as st
from ui.state import init_demo, current_user
from ui import auth
from ui.portal import USER_ROUTES, ADMIN_ROUTES
from ui.theme import apply_theme
from ui.theme_switch import render_theme_switch
from ui.fields_theme import apply_fields_theme

st.set_page_config(page_title="AIVA-IoT", page_icon="🤖", layout="wide")
render_theme_switch()
apply_theme()
apply_fields_theme(st.session_state.get("appearance") == "☀️ Sáng")
init_demo()
st.markdown('<div class="brand"><b>🤖 AIVA-IoT</b><span>AI Virtual Assistant & IoT Robot Management Platform</span><small>FRONTEND DEMO • Chưa kết nối backend</small></div>', unsafe_allow_html=True)
account = current_user()
if not account:
    auth.render()
    st.stop()
if account["locked"]:
    st.session_state.identity = None
    st.error("Tài khoản đã bị khóa.")
    if st.button("Về đăng nhập"):
        st.rerun()
    st.stop()
routes = ADMIN_ROUTES if account["role"] == "Admin" else USER_ROUTES
st.sidebar.markdown("### 🤖 AIVA-IoT" + (" Admin" if account["role"] == "Admin" else ""))
st.sidebar.caption("SYSTEM MANAGEMENT" if account["role"] == "Admin" else "USER PORTAL")
nav_key = f"nav_{account['id']}"
target = st.session_state.pop("navigate_to", None)
if target in routes:
    st.session_state[nav_key] = target
page = st.sidebar.radio("Điều hướng", list(routes), key=nav_key, label_visibility="collapsed")
st.sidebar.divider()
st.sidebar.markdown(f"**{account['name']}**")
st.sidebar.caption(account["email"])
if st.sidebar.button("Đăng xuất", width="stretch"):
    st.session_state.identity = None
    st.rerun()
if page != "AI Chat":
    st.title(page)
    st.caption("Quản lý nền tảng AIVA-IoT" if account["role"] == "Admin" else "Không gian trợ lý AI và robot của bạn")
flash = st.session_state.pop("flash", None)
if flash:
    st.markdown('<div class="success-animation" aria-hidden="true"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17"/><path d="M11 20l6 6 12-13"/></svg></div>', unsafe_allow_html=True)
    st.success(flash)
routes[page]()
