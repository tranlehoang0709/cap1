"""Trang Người dùng: khoa_api_ca_nhan."""
import streamlit as st
from nen_tang.trang_thai import data, current_user
from thanh_phan.dung_chung.khung_noi_dung import panel
from thanh_phan.dung_chung.quan_ly_khoa_api import key_manager


def personal_keys():
    store = data()["personal_keys"].setdefault(current_user()["id"], {})
    for col, name in zip(st.columns(2), ["OpenAI", "Gemini"]):
        with col, panel():
            st.subheader("✧ " + name)
            entry = store.get(name)
            st.caption("● Đã cấu hình" if entry else "● Chưa cấu hình")
            if entry:
                st.write("API Key: ••••••••••••")
                st.caption(f"Cập nhật: {entry['updated']}")
                st.caption(entry['status'])
            else:
                st.caption("Chưa có API Key được thêm.")
    with panel():
        key_manager(store, f"personal_{current_user()['id']}")

