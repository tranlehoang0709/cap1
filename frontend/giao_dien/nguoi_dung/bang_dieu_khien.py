"""Trang Người dùng: bang_dieu_khien."""
import streamlit as st
from nen_tang.trang_thai import current_user, approved_devices, preferences, PROVIDERS, mine
from thanh_phan.dung_chung.khung_noi_dung import panel
from thanh_phan.dung_chung.bang_du_lieu import table
from html import escape
import pandas as pd
import plotly.express as px
from nen_tang.dieu_huong import go
from thanh_phan.robot.khung_hien_thi import render_robot_scene
from thanh_phan.dung_chung.trang_thai_robot import render_robot_status


def usage():
    st.caption("USR-13 · P1 · Dữ liệu thống kê minh họa; không đo mức sử dụng hay chi phí thật.")
    rows = mine("usage")
    if not rows:
        st.info("Chưa có thống kê mẫu để hiển thị. Trang này chưa đo mức sử dụng AI thực tế.")
        return
    chosen = st.multiselect("Provider", PROVIDERS, default=PROVIDERS)
    frame = pd.DataFrame([r for r in rows if r["provider"] in chosen])
    if frame.empty:
        st.info("Chưa có bản ghi mẫu khớp bộ lọc. Hãy chọn ít nhất một dịch vụ AI ở trên.")
        return
    start, end = st.slider("Khoảng ngày mẫu trong tháng 10/2026", 1, 10, (1, 10))
    frame = frame[(pd.to_datetime(frame["date"]).dt.day >= start) & (pd.to_datetime(frame["date"]).dt.day <= end)]
    cols = st.columns(2)
    cols[0].metric("Phiên mẫu", int(frame["sessions"].sum()))
    cols[1].metric("Token mẫu", int(frame["tokens"].sum()))
    chart = px.bar(frame, x="date", y="tokens", color="provider", title="Sử dụng AI · mẫu")
    if st.session_state.get("appearance") == "☀️ Sáng":
        # Dùng màu ngữ nghĩa của theme hiện có; giữ nguyên template và màu provider.
        # Theme native của Streamlit là Dark nên figure cần màu Light tường minh.
        chart.update_layout(
            paper_bgcolor="#fdfdfe", plot_bgcolor="#fdfdfe", font_color="#202638",
            title_font_color="#202638",
            # Màu tick/title riêng của template được ưu tiên hơn font chung.
            xaxis=dict(color="#5d687d", tickfont_color="#5d687d",
                       title_font_color="#5d687d", gridcolor="#d7dce7"),
            yaxis=dict(color="#5d687d", tickfont_color="#5d687d",
                       title_font_color="#5d687d", gridcolor="#d7dce7"),
            legend=dict(font_color="#202638", title_font_color="#202638", bgcolor="#fdfdfe"),
            hoverlabel=dict(bgcolor="#fdfdfe", font_color="#202638", bordercolor="#d7dce7"),
        )
    st.plotly_chart(chart, width="stretch")
    table(frame.to_dict("records"), "usage", ["provider"])



def dashboard_user():
    u = current_user()
    robots = approved_devices(u['id'])
    p = preferences(u['id'])
    with st.container(key="dashboard_hero"):
        intro, mascot = st.columns([2.1, 1], gap="large")
        with intro:
            st.subheader(f"Chào mừng trở lại, {u['name']}")
            st.caption(f"Theo dõi robot và trò chuyện cùng {p['name']}. Các thông tin bên dưới là dữ liệu mẫu.")
        with mascot:
            render_robot_scene()
    render_robot_status(robots, "dashboard")
    with st.container(key="dashboard_metrics"):
        for col, label, value in zip(st.columns(4), ['Tổng số robot','Đang Online','Đang Offline','AI Provider'], [len(robots),sum(r['online'] for r in robots),sum(not r['online'] for r in robots),p['provider']]):
            col.metric(label, value)
    left, right = st.columns([2,1])
    with left, panel():
        st.subheader('Thiết bị của tôi')
        if not robots:
            st.info("Bạn chưa có robot được duyệt. Mở Robot của tôi trong Sidebar để gửi yêu cầu ghép nối và chờ quản trị viên xác nhận trong bản demo.")
        for robot in robots:
            online = robot["online"]
            st.markdown(f'<div class="provider-row"><div><strong>{escape(robot["name"])}</strong><small>{escape(robot["id"])} · Pin {robot["battery"]}% · Firmware {escape(robot["firmware"])}</small></div><span class="status {"online" if online else "offline"}">{"Trực tuyến" if online else "Ngoại tuyến"}</span></div>', unsafe_allow_html=True)
        if st.button('Xem tất cả →'):
            go('Thiết bị của tôi')
    with right:
        with panel():
            st.subheader('Trợ lý AI')
            st.write(f"✧ **{p['provider']}**")
            st.caption(f"{p['name']} · Trợ lý thông minh")
            if st.button('Mở AI Chat',type='primary',width='stretch'):
                go('AI Chat')
    with st.expander('Thống kê sử dụng'):
        usage()

