"""Nút chuyển theme sử dụng toggle Streamlit và tài nguyên hiện có."""
from urllib.parse import quote
from nen_tang.duong_dan import FRONTEND_ROOT
import streamlit as st


def render_theme_switch():
    if "aiva_theme_switch" not in st.session_state:
        st.session_state.aiva_theme_switch = st.session_state.get("appearance", "🌙 Tối") != "☀️ Sáng"

    def sync_theme():
        st.session_state.appearance = "🌙 Tối" if st.session_state.aiva_theme_switch else "☀️ Sáng"

    with st.container(key="aiva_theme_switch_scope"):
        st.toggle("Chế độ tối", key="aiva_theme_switch", on_change=sync_theme,
                  label_visibility="collapsed",
                  help="Bật để dùng giao diện tối, tắt để dùng giao diện sáng.")
    sync_theme()
    robot = quote('''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="s" x2="1" y2="1"><stop stop-color="white"/><stop offset="1" stop-color="#91aac8"/></linearGradient></defs><circle cx="20" cy="20" r="19" fill="url(#s)"/><path d="M20 9V5" stroke="#64809f" stroke-width="2"/><circle cx="20" cy="5" r="2" fill="#43ceff"/><rect x="8" y="10" width="24" height="22" rx="9" fill="#e7f0fc"/><rect x="11" y="13" width="18" height="13" rx="5" fill="#13263d"/><ellipse cx="16" cy="19" rx="2" ry="3" fill="#4edaff"/><ellipse cx="24" cy="19" rx="2" ry="3" fill="#4edaff"/><path d="M17 24q3 2 6 0" stroke="#4edaff" fill="none"/><circle cx="20" cy="29" r="2" fill="#59bbec"/></svg>''')
    st.html(("<style>" + (FRONTEND_ROOT / "kieu_dang" / "theme_switch.css").read_text(encoding="utf-8") + "</style>").replace('ROBOT_DATA', robot)
        .replace('.st-key-aiva_theme_switch', '.st-key-aiva_theme_switch_scope')
        .replace('[data-baseweb="checkbox"]', 'label:has(input)'))
