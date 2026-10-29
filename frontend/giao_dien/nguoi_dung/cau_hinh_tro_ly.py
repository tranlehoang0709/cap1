"""Trang Người dùng: cau_hinh_tro_ly."""
import streamlit as st
from nen_tang.trang_thai import data, current_user, preferences, done, allowed_providers
from thanh_phan.dung_chung.khung_noi_dung import panel


def assistant():
    p = preferences(current_user()["id"])
    persona, language, voice = st.tabs(["Thông tin", "Ngôn ngữ", "Giọng nói"])
    with persona:
        with st.form("assistant_persona"):
            name = st.text_input("Tên trợ lý", value=p["name"])
            personality = st.text_input("Tính cách", value=p["personality"])
            address = st.text_input("Cách xưng hô", value=p["address"])
            with st.expander("Nâng cao: hướng dẫn cho AI"):
                prompt = st.text_area("System prompt", value=p["prompt"])
            save = st.form_submit_button("Lưu cá nhân hóa mẫu")
        if save:
            if not all(v.strip() for v in [name, personality, address, prompt]):
                st.error("Các trường không được để trống.")
            else:
                p.update(name=name.strip(), personality=personality.strip(), address=address.strip(), prompt=prompt.strip())
                done("Lưu cá nhân hóa trợ lý", "Cấu hình AI")
    with language:
        st.caption("Tiếng Việt theo Proposal. Các ngôn ngữ khác cần xác nhận dịch vụ ASR/TTS hỗ trợ trước khi bổ sung.")
        with st.form("assistant_language"):
            value = st.selectbox("Ngôn ngữ hỗ trợ trong demo", ["Tiếng Việt"])
            save = st.form_submit_button("Lưu ngôn ngữ mẫu")
        if save:
            p["language"] = value
            done("Lưu ngôn ngữ mẫu", "Cấu hình AI")
    with voice:
        st.caption("Giọng và tốc độ được lưu để minh họa; chưa kết nối dịch vụ TTS.")
        with st.form("assistant_voice"):
            voices = ["Giọng mẫu A", "Giọng mẫu B"]
            value = st.selectbox("Giọng TTS mẫu", voices, index=voices.index(p["voice"]))
            speed = st.slider("Tốc độ giọng nói", .5, 2., float(p.get("speed", 1.)), .1)
            save = st.form_submit_button("Lưu giọng nói mẫu")
        if save:
            p["voice"] = value
            p["speed"] = speed
            done("Lưu giọng TTS mẫu", "Cấu hình AI")



def provider():
    p = preferences(current_user()["id"])
    allowed = allowed_providers()
    st.caption(f"Chính sách mẫu: {data()['provider_policy']}. Danh sách do Admin bật/tắt.")
    if not allowed:
        st.warning("Admin chưa bật Provider nào.")
        return
    with st.form("user_provider"):
        selected = st.selectbox("AI Provider", allowed, index=allowed.index(p["provider"]) if p["provider"] in allowed else 0)
        save = st.form_submit_button("Lưu lựa chọn mẫu")
    if save:
        p["provider"] = selected
        done(f"Chọn Provider {selected}", "Cấu hình AI")



def render_page():
    from giao_dien.nguoi_dung.khoa_api_ca_nhan import personal_keys
    personal, advanced = st.tabs(["Cá nhân hóa", "Nâng cao"],
        key=f"user_assistant_section_{current_user()['id']}", on_change="rerun")
    if personal.open:
        with personal, panel():
            st.subheader("Thông tin trợ lý")
            assistant()
    if advanced.open:
        with advanced:
            with panel():
                st.subheader("Dịch vụ AI")
                provider()
            st.subheader("Khóa kết nối AI (API Key)")
            personal_keys()

