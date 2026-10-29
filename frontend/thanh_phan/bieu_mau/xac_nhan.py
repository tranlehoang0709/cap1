"""Điều khiển xác nhận, giữ nguyên nhãn và widget key."""
import streamlit as st


def confirm(key, label="Tôi xác nhận thao tác trên dữ liệu mẫu", *, scope=None):
    if scope is not None:
        scope_key = f"confirmation_scope_{key}"
        if st.session_state.get(scope_key) != scope:
            if f"confirm_{key}" in st.session_state:
                st.session_state[f"confirm_{key}"] = False
            st.session_state[scope_key] = scope
    return st.checkbox(label, key=f"confirm_{key}")

