"""Khung nội dung giữ nguyên chỉ số panel và CSS hook hiện có."""
import streamlit as st


def panel():
    index = st.session_state.get("aiva_panel_index", 0)
    st.session_state.aiva_panel_index = index + 1
    return st.container(border=True, key=f"aiva_panel_{index}")

