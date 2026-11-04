"""Compatibility routes backed by authenticated Backend requests."""
import streamlit as st
from nen_tang.backend import BackendError, api
from giao_dien import live


def render(target, *, admin=False):
    try:
        account = api("/auth/me")
        if account.get("role") not in ("ADMIN", "USER"):
            st.error("Backend trả về vai trò không hợp lệ.")
            return
        if admin and account.get("role") != "ADMIN":
            st.error("Chức năng này chỉ dành cho quản trị viên.")
            return
        if target in ("dashboard_user", "account_page"):
            return getattr(live, target)(account)
        if target == "quota_admin":
            return live.quota_admin(admin)
        return getattr(live, target)()
    except BackendError as error:
        live.api_error(error)


def unavailable(feature):
    st.info(f"{feature}: Backend chưa cung cấp API cho chức năng này.")
