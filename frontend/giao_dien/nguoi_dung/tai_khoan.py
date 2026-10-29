"""Gộp tài khoản và quyền riêng tư; tái sử dụng nguyên các biểu mẫu hiện có."""
import streamlit as st
from nen_tang.trang_thai import current_user
from thanh_phan.dung_chung.bieu_mau_tai_khoan import account
from giao_dien.nguoi_dung.quyen_rieng_tu import privacy_page


def render_page():
    profile, privacy = st.tabs(["Thông tin tài khoản", "Quyền riêng tư"],
        key=f"user_account_section_{current_user()['id']}", on_change="rerun")
    if profile.open:
        with profile:
            account()
    if privacy.open:
        with privacy:
            privacy_page()
