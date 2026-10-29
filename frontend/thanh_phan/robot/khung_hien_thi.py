"""Nhúng khung robot Streamlit, giữ nguyên trạng thái và thứ tự render."""
import streamlit as st
from thanh_phan.robot.tai_lieu_3d import build_document


def render_robot_scene(*, hero=False, online=True, show_expressions=False):
    document = build_document(
        hero=hero,
        online=online,
        light=st.session_state.get("appearance") == "\u2600\ufe0f S\u00e1ng",
        paused=st.session_state.get("aiva_pause_robot", False),
        show_expressions=show_expressions,
    )
    st.iframe(document, height=352 if hero else 202, tab_index=0,
              alt="Robot AIVA 3D: drag to rotate, scroll to zoom, double-click to reset")

    if hero:
        st.toggle('Tạm dừng chuyển động robot', key='aiva_pause_robot',
                  help='Dừng hoạt ảnh và hiệu ứng theo con trỏ. Thiết lập giảm chuyển động của hệ thống cũng được tôn trọng.')
