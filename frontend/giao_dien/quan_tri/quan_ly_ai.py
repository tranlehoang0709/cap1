"""Trang Quản trị: quan_ly_ai."""
import streamlit as st
from nen_tang.trang_thai import data, done, PROVIDERS
from thanh_phan.dung_chung.khung_noi_dung import panel
from thanh_phan.dung_chung.bang_du_lieu import table


def providers():
    p = st.selectbox("AI Provider", PROVIDERS)
    config = data()["providers"][p]
    with st.form(f"provider_{p}"):
        enabled = st.checkbox("Cho phép User chọn", value=config["enabled"])
        model = st.text_input("Tên model (mẫu)", value=config["model"])
        endpoint = st.text_input("Địa chỉ dịch vụ (chỉ lưu cấu hình mẫu, không kết nối)", value=config["endpoint"])
        policies = ["User lựa chọn", "Ưu tiên Local AI", "Ưu tiên Cloud AI"]
        policy = st.selectbox("Chính sách lựa chọn", policies, index=policies.index(data()["provider_policy"]))
        save = st.form_submit_button("Lưu cấu hình Provider mẫu")
    if save:
        if not model.strip():
            st.error("Nhập tên model mẫu.")
        else:
            config.update(enabled=enabled, model=model.strip(), endpoint=endpoint)
            data()["provider_policy"] = policy
            done(f"Cập nhật Provider {p}; chính sách chỉ mô phỏng")



def server():
    st.metric("AI Server mẫu", "Sẵn sàng")
    table([{"id": p, **values} for p, values in data()["providers"].items()], "server")
    if st.button("Kiểm tra kết nối mô phỏng"):
        st.success("Kịch bản mẫu: AI Server, Local AI, OpenAI và Gemini sẵn sàng. Không thực hiện kết nối mạng.")



def ai():
    for col,name in zip(st.columns(3),PROVIDERS):
        config=data()['providers'][name]
        with col,panel():
            st.subheader(name)
            enabled=st.toggle('Đang bật',config['enabled'],key=f'toggle_{name}')
            if enabled!=config['enabled']:
                config['enabled']=enabled
                done(f"{'Bật' if enabled else 'Tắt'} {name}")
            st.caption(config['model'])
            st.caption('● Sẵn sàng (mô phỏng)' if enabled else '● Đã tắt')
    settings, connection=st.tabs(['Cấu hình chung','Kiểm tra kết nối'])
    with settings:
        providers()
    with connection:
        server()

