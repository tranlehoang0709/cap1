"""Yêu cầu chuyển trang qua cơ chế điều hướng Streamlit hiện có."""
import streamlit as st


def go(page):
    st.session_state.navigate_to = page
    st.rerun()
