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


def usage():
    st.caption("USR-13 · P1 · Dữ liệu thống kê minh họa; không đo mức sử dụng hay chi phí thật.")
    rows = mine("usage")
    if not rows:
        st.info("Chưa có dữ liệu mẫu.")
        return
    chosen = st.multiselect("Provider", PROVIDERS, default=PROVIDERS)
    frame = pd.DataFrame([r for r in rows if r["provider"] in chosen])
    if frame.empty:
        st.info("Không có dữ liệu cho lựa chọn này.")
        return
    start, end = st.slider("Khoảng ngày mẫu trong tháng 10/2026", 1, 10, (1, 10))
    frame = frame[(pd.to_datetime(frame["date"]).dt.day >= start) & (pd.to_datetime(frame["date"]).dt.day <= end)]
    cols = st.columns(2)
    cols[0].metric("Phiên mẫu", int(frame["sessions"].sum()))
    cols[1].metric("Token mẫu", int(frame["tokens"].sum()))
    st.plotly_chart(px.bar(frame, x="date", y="tokens", color="provider", title="Sử dụng AI · mẫu"), width="stretch")
    table(frame.to_dict("records"), "usage", ["provider"])



def dashboard_user():
    u = current_user()
    robots = approved_devices(u['id'])
    p = preferences(u['id'])
    with st.container(key="dashboard_hero"):
        intro, mascot = st.columns([2.1, 1], gap="large")
        with intro:
            st.subheader(f"Chào mừng trở lại, {u['name']}")
            st.caption(f"{p['name']} sẵn sàng đồng hành cùng bạn. Theo dõi robot hoặc bắt đầu cuộc trò chuyện mới.")
            if st.button('Bắt đầu trò chuyện →',type='primary'):
                go('AI Chat')
            if st.button('＋ Ghép nối robot'):
                go('Thiết bị của tôi')
        with mascot:
            render_robot_scene()
    with st.container(key="dashboard_metrics"):
        for col, label, value in zip(st.columns(4), ['Tổng số robot','Đang Online','Đang Offline','AI Provider'], [len(robots),sum(r['online'] for r in robots),sum(not r['online'] for r in robots),p['provider']]):
            col.metric(label, value)
    left, right = st.columns([2,1])
    with left, panel():
        st.subheader('Thiết bị của tôi')
        if not robots:
            st.info("Chưa có robot. Ghép nối thiết bị để bắt đầu.")
        for robot in robots:
            online = robot["online"]
            st.markdown(f'<div class="provider-row"><div><strong>{escape(robot["name"])}</strong><small>{escape(robot["id"])} · Pin {robot["battery"]}% · Firmware {escape(robot["firmware"])}</small></div><span class="status {"online" if online else "offline"}">{"Online" if online else "Offline"}</span></div>', unsafe_allow_html=True)
        if st.button('Xem tất cả →'):
            go('Thiết bị của tôi')
    with right:
        with panel():
            st.subheader('Trợ lý AI')
            st.write(f"✧ **{p['provider']}**")
            st.caption(f"{p['name']} · Trợ lý thông minh")
            if st.button('Mở AI Chat',type='primary',width='stretch'):
                go('AI Chat')
        with panel():
            st.subheader('Thao tác nhanh')
            for label, target in [('Thiết bị của tôi','Thiết bị của tôi'),('Lịch sử hội thoại','Lịch sử hội thoại'),('Cấu hình trợ lý','Cấu hình trợ lý AI')]:
                if st.button(label,width='stretch'):
                    go(target)
    with st.expander('Thống kê sử dụng'):
        usage()

