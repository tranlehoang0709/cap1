"""Sidebar giữ nguyên thứ tự, widget key và cơ chế điều hướng."""
from html import escape
import streamlit as st
from thanh_phan.dung_chung.nut_chuyen_chu_de import render_theme_switch


def render_sidebar(account, routes):
    st.sidebar.markdown('<div class="sidebar-brand">🤖 AIVA-IoT' + (' Admin' if account["role"] == "Admin" else '') + '</div>', unsafe_allow_html=True)
    st.sidebar.caption("SYSTEM MANAGEMENT" if account["role"] == "Admin" else "USER PORTAL")
    nav_key = f"nav_{account['id']}"
    target = st.session_state.pop("navigate_to", None)
    if target in routes:
        st.session_state[nav_key] = target
    page = st.sidebar.radio("Điều hướng", list(routes), key=nav_key, label_visibility="collapsed")
    st.sidebar.divider()
    st.sidebar.markdown(f'<div class="sidebar-account"><span class="avatar">{escape(account["name"][:1])}</span><div><strong>{escape(account["name"])}</strong><small>{escape(account["email"])}</small></div></div>', unsafe_allow_html=True)
    if st.sidebar.button("Đăng xuất", width="stretch"):
        st.session_state.identity = None
        st.rerun()
    with st.sidebar:
        render_theme_switch()
    return page
