"""Animated theme switch backed by a native Streamlit toggle."""
from urllib.parse import quote
import streamlit as st


def render_theme_switch():
    if "aiva_theme_switch" not in st.session_state:
        st.session_state.aiva_theme_switch = st.session_state.get("appearance", "🌙 Tối") != "☀️ Sáng"

    def sync_theme():
        st.session_state.appearance = "🌙 Tối" if st.session_state.aiva_theme_switch else "☀️ Sáng"

    with st.container(key="aiva_theme_switch_scope"):
        st.toggle("Chế độ tối", key="aiva_theme_switch", on_change=sync_theme,
                  help="Bật để dùng giao diện tối, tắt để dùng giao diện sáng.")
    sync_theme()
    robot = quote('''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="s" x2="1" y2="1"><stop stop-color="white"/><stop offset="1" stop-color="#91aac8"/></linearGradient></defs><circle cx="20" cy="20" r="19" fill="url(#s)"/><path d="M20 9V5" stroke="#64809f" stroke-width="2"/><circle cx="20" cy="5" r="2" fill="#43ceff"/><rect x="8" y="10" width="24" height="22" rx="9" fill="#e7f0fc"/><rect x="11" y="13" width="18" height="13" rx="5" fill="#13263d"/><ellipse cx="16" cy="19" rx="2" ry="3" fill="#4edaff"/><ellipse cx="24" cy="19" rx="2" ry="3" fill="#4edaff"/><path d="M17 24q3 2 6 0" stroke="#4edaff" fill="none"/><circle cx="20" cy="29" r="2" fill="#59bbec"/></svg>''')
    st.markdown('''<style>
    .st-key-aiva_theme_switch{width:fit-content;margin-bottom:10px}
    .st-key-aiva_theme_switch [data-baseweb="checkbox"]{position:relative;min-height:50px;padding-left:118px;cursor:pointer;display:flex;align-items:center}
    .st-key-aiva_theme_switch [data-baseweb="checkbox"]>div:first-of-type{position:absolute;opacity:0;width:1px;height:1px;overflow:hidden}
    .st-key-aiva_theme_switch [data-baseweb="checkbox"]::before{content:"";position:absolute;left:0;top:3px;width:100px;height:44px;border-radius:30px;border:1px solid #9ac5df;background:radial-gradient(circle at 21px 14px,#fff9b5 0 7px,transparent 8px),radial-gradient(ellipse at 60px 32px,#fff 0 15px,transparent 16px),radial-gradient(ellipse at 80px 30px,#e2f5ff 0 20px,transparent 21px),linear-gradient(#66b8ec,#d4efff);box-shadow:inset 0 3px 6px #17426033,0 2px 5px #0002;transition:background .45s ease,border-color .45s ease}
    .st-key-aiva_theme_switch [data-baseweb="checkbox"]::after{content:"";position:absolute;left:4px;top:6px;width:38px;height:38px;border-radius:50%;background:#eff6ff url("data:image/svg+xml,ROBOT_DATA") center/contain no-repeat;box-shadow:0 3px 6px #0005;transform:translateX(0) rotate(-12deg);transition:transform .65s cubic-bezier(.34,1.56,.64,1),box-shadow .3s ease}
    .st-key-aiva_theme_switch [data-baseweb="checkbox"]:has(input:checked)::before{background:radial-gradient(circle at 22px 13px,#ecf4ff 0 1px,transparent 2px),radial-gradient(circle at 37px 32px,#bfccff 0 1px,transparent 2px),radial-gradient(circle at 48px 10px,#ecf4ff 0 1px,transparent 2px),radial-gradient(circle at 13px 28px,#bfcfff 0 1px,transparent 2px),linear-gradient(120deg,#111d38,#3c416b);border-color:#6676aa}
    .st-key-aiva_theme_switch [data-baseweb="checkbox"]:has(input:checked)::after{transform:translateX(56px) rotate(12deg);box-shadow:0 3px 8px #0006,0 0 12px #5ed5ff33}
    .st-key-aiva_theme_switch [data-baseweb="checkbox"]:hover::after{box-shadow:0 3px 8px #0005,0 0 16px #5ed5ff66}
    .st-key-aiva_theme_switch [data-baseweb="checkbox"]:has(input:focus-visible)::before{outline:2px solid #9588ff;outline-offset:4px}
    @media(prefers-reduced-motion:reduce){.st-key-aiva_theme_switch [data-baseweb="checkbox"]::before,.st-key-aiva_theme_switch [data-baseweb="checkbox"]::after{transition:none}}
    </style>'''.replace('ROBOT_DATA', robot)
        .replace('.st-key-aiva_theme_switch', '.st-key-aiva_theme_switch_scope')
        .replace('[data-baseweb="checkbox"]', 'label:has(input)'), unsafe_allow_html=True)
