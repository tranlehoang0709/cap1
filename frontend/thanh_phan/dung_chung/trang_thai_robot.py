"""Hiển thị trạng thái có trong dữ liệu mẫu, không suy diễn telemetry trực tiếp."""
import streamlit as st


def render_robot_status(robots, scope):
    """Đếm robot thuộc tài khoản từ cờ online sẵn có; không tạo state mới."""
    with st.container(key=f"robot_status_{scope}"):
        st.caption("Trạng thái robot · Dữ liệu mẫu")
        if not robots:
            st.write("Chưa có robot được duyệt trong tài khoản mẫu của bạn.")
        else:
            online = sum(bool(robot["online"]) for robot in robots)
            offline = len(robots) - online
            st.markdown(f'<div role="status" aria-live="polite">'
                        f'<strong>● {online} đang trực tuyến</strong> · '
                        f'<span>○ {offline} đang ngoại tuyến</span></div>', unsafe_allow_html=True)
        st.caption("Thông tin mô phỏng trong phiên, chưa phản ánh kết nối với thiết bị thật.")
