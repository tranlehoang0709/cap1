"""Hiển thị trạng thái thiết bị do Backend trả về."""
import streamlit as st


def render_robot_status(robots, scope):
    """Đếm robot thuộc tài khoản từ cờ online sẵn có; không tạo state mới."""
    with st.container(key=f"robot_status_{scope}"):
        st.caption("Trạng thái robot")
        if not robots:
            st.write("Chưa có robot được duyệt trong tài khoản của bạn.")
        else:
            online = sum(robot.get("connection_status") == "online" for robot in robots)
            offline = sum(robot.get("connection_status") == "offline" for robot in robots)
            unknown = len(robots) - online - offline
            st.markdown(f'<div role="status" aria-live="polite">'
                        f'<strong>● {online} đang trực tuyến</strong> · '
                        f'<span>○ {offline} đang ngoại tuyến · {unknown} chưa rõ trạng thái</span></div>', unsafe_allow_html=True)
        st.caption("Trạng thái theo lần cập nhật gần nhất từ Backend.")
