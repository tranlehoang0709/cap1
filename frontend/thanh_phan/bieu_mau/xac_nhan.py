"""Điều khiển xác nhận, giữ nguyên nhãn và widget key."""
import streamlit as st


def confirm(key, label="Tôi xác nhận thao tác trên dữ liệu mẫu"):
    return st.checkbox(label, key=f"confirm_{key}")

