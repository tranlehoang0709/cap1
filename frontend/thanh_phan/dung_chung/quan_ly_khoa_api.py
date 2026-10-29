"""Quản lý khóa mô phỏng dùng chung cho User và Admin."""
import streamlit as st
from nen_tang.trang_thai import now, done
from thanh_phan.bieu_mau.xac_nhan import confirm


def key_manager(store, prefix):
    st.warning("Chỉ nhập chuỗi thử nghiệm (ví dụ demo-key-123). Không nhập API Key thật. Giá trị được che; kiểm tra chỉ mô phỏng.")
    provider_name = st.selectbox("Provider", ["OpenAI", "Gemini"], key=f"key_provider_{prefix}")
    entry = store.get(provider_name)
    if entry:
        st.write(f"Khóa mẫu: •••••••• · Cập nhật: {entry['updated']} · Kiểm tra: {entry['status']}")
    else:
        st.info("Chưa có khóa mẫu cho Provider này.")
    with st.form(f"key_form_{prefix}_{provider_name}", clear_on_submit=True):
        value = st.text_input("Chuỗi API Key thử nghiệm", type="password")
        save = st.form_submit_button("Thêm / thay thế khóa mẫu")
    if save:
        if len(value.strip()) < 8:
            st.error("Chuỗi thử nghiệm cần ít nhất 8 ký tự.")
        else:
            store[provider_name] = {"value": value.strip(), "updated": now(), "status": "Chưa kiểm tra"}
            done(f"Thêm / thay thế {provider_name} Key mẫu", "API Key")
    if entry:
        if st.button("Kiểm tra khóa mẫu", key=f"test_key_{prefix}"):
            entry["status"] = "Đạt kiểm tra kịch bản mẫu; chưa xác thực với Provider"
            done(f"Kiểm tra mô phỏng {provider_name} Key; không gọi Provider", "API Key")
        accept = confirm(f"delete_key_{prefix}_{provider_name}")
        if st.button("Xóa khóa mẫu", key=f"delete_key_{prefix}"):
            if not accept:
                st.error("Cần xác nhận xóa.")
            else:
                del store[provider_name]
                done(f"Xóa {provider_name} Key mẫu", "API Key")

