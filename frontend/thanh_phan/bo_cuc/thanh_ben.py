"""Sidebar giữ nguyên thứ tự, widget key và cơ chế điều hướng."""
from html import escape
import streamlit as st
from thanh_phan.dung_chung.nut_chuyen_chu_de import render_theme_switch
from nen_tang.dieu_huong import USER_LABELS, user_destination
from nen_tang.trang_thai import api_client


def render_sidebar(account, routes):
    st.sidebar.markdown('<div class="sidebar-brand">🤖 AIVA-IoT' + (' Admin' if account["role"] == "Admin" else '') + '</div>', unsafe_allow_html=True)
    st.sidebar.caption("SYSTEM MANAGEMENT" if account["role"] == "Admin" else "USER PORTAL")
    nav_key = f"nav_{account['id']}"
    target = st.session_state.pop("navigate_to", None)
    if account["role"] == "User":
        # Chuyển phiên đang ở một mục đã gộp trước khi dựng widget điều hướng.
        if target is None and st.session_state.get(nav_key) not in routes:
            target = st.session_state.get(nav_key)
        if target is not None:
            target, section, tab = user_destination(target)
            if section:
                st.session_state[f"{section}_{account['id']}"] = tab
    if target in routes:
        st.session_state[nav_key] = target
    page = st.sidebar.radio("Điều hướng", list(routes), key=nav_key, label_visibility="collapsed",
                            format_func=USER_LABELS.get if account["role"] == "User" else str)
    st.sidebar.divider()
    st.sidebar.markdown(f'<div class="sidebar-account"><span class="avatar">{escape(account["name"][:1])}</span><div><strong>{escape(account["name"])}</strong><small>{escape(account["email"])}</small></div></div>', unsafe_allow_html=True)
    if st.sidebar.button("Đăng xuất", width="stretch"):
        from tich_hop.phien_xac_thuc import AUTH_KEY
        if AUTH_KEY in st.session_state:
            from tich_hop.giao_dien import service, clear_widgets
            from tich_hop.http_client import ApiError
            try:
                service().logout()
            except ApiError:
                st.session_state.logout_warning = "Đã xóa phiên giao diện; chưa xác nhận thu hồi phiên tại Backend."
            clear_widgets()
            st.rerun()
        client = api_client()
        if client and client.enabled:
            try:
                client.logout()
            except Exception:
                pass
        st.session_state.pop("api_user", None)
        st.session_state.identity = None
        st.rerun()
    with st.sidebar:
        render_theme_switch()
    return page
