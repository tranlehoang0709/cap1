"""Trang Người dùng: khoa_api_ca_nhan."""
import streamlit as st
from nen_tang.trang_thai import data, current_user, api_enabled, api_client
from thanh_phan.dung_chung.khung_noi_dung import panel
from thanh_phan.dung_chung.quan_ly_khoa_api import key_manager


def personal_keys():
    if api_enabled():
        _backend_keys()
        return
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


def _backend_keys():
    try:
        keys = api_client().get("/api-keys") or []
    except Exception as exc:
        st.error(str(exc))
        return
    provider_ids = {"OpenAI": "openai", "Gemini": "gemini", "Local AI": "local"}
    with panel():
        st.caption("Khóa được mã hóa tại backend; giá trị bí mật không được hiển thị lại.")
        for item in keys:
            st.write(f"{item.get('label', 'API key')} · {item.get('secret_hint', '****')}")
            if st.button("Thu hồi", key=f"revoke_api_key_{item.get('id')}"):
                try:
                    api_client().delete(f"/api-keys/{item['id']}")
                    st.success("Đã thu hồi khóa.")
                    st.rerun()
                except Exception as exc:
                    st.error(str(exc))
        provider = st.selectbox("Provider", list(provider_ids), key="backend_key_provider")
        label = st.text_input("Nhãn khóa", key="backend_key_label")
        secret = st.text_input("API Key", type="password", key="backend_key_secret")
        if st.button("Thêm khóa", key="backend_key_add"):
            if len(secret.strip()) < 8 or not label.strip():
                st.error("Nhãn và API key hợp lệ là bắt buộc.")
            else:
                try:
                    api_client().post("/api-keys", {"provider_id": provider_ids[provider], "label": label.strip(), "secret": secret.strip()})
                    st.success("Đã thêm khóa vào backend.")
                    st.rerun()
                except Exception as exc:
                    st.error(str(exc))

