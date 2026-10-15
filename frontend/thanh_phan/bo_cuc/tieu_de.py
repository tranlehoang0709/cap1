"""Tiêu đề Portal và Login với cấu trúc render nguyên bản."""
import streamlit as st
from nen_tang.duong_dan import ASSETS_DIR
from thanh_phan.dung_chung.nut_chuyen_chu_de import render_theme_switch


def page_header(title, description):
    """Tiêu đề dùng chung, giữ nguyên DOM hook và thứ tự dựng giao diện."""
    with st.container(key="portal_page_header"):
        # Dùng nguyên script cục bộ trong phần tử thương hiệu hiện có.
        scroll_script = (ASSETS_DIR / 'layout' / 'header_scroll.js').read_text(encoding='utf-8')
        st.html('<div class="brand"><b>🤖 AIVA-IoT</b><span>AI Virtual Assistant & IoT Robot Management Platform</span><small>Bản demo frontend</small></div>'
                f'<script>{scroll_script}</script>', unsafe_allow_javascript=True)
        st.title(title)
        st.caption(description)



def render_login_header():
    with st.container(key="login_header"):
        logo, appearance = st.columns([4, 1.3], vertical_alignment="center")
        with logo:
            st.markdown('<div class="brand"><b>🤖 AIVA-IoT</b><span>AI Virtual Assistant & IoT Robot Management Platform</span></div>', unsafe_allow_html=True)
        with appearance:
            render_theme_switch()

