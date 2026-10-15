"""Trang Quản trị: bang_dieu_khien."""
import streamlit as st
import pandas as pd
import plotly.express as px
from html import escape
from nen_tang.trang_thai import data
from thanh_phan.dung_chung.khung_noi_dung import panel
from thanh_phan.dung_chung.bang_du_lieu import render_frame, table


def dashboard():
    d = data()
    cols = st.columns(4)
    for col, label, value in zip(cols, ["User", "Robot", "Phiên AI mẫu", "Chờ ghép nối"], [sum(u["role"] == "User" for u in d["users"]), len(d["devices"]), len(d["conversations"]), sum(r["status"] == "Chờ duyệt" for r in d["requests"])]):
        col.metric(label, value)
    st.subheader("Trạng thái hệ thống mẫu")
    st.success("AI Server: sẵn sàng (mẫu) · Telemetry là ảnh chụp dữ liệu mẫu, không cập nhật thời gian thực.")
    offline = sum(not r["online"] for r in d["devices"])
    if offline:
        st.warning(f"{offline} robot offline trong dữ liệu mẫu.")
    rows = [{"Trạng thái": "Online" if r["online"] else "Offline", "Robot": 1} for r in d["devices"]]
    if rows:
        st.plotly_chart(px.pie(pd.DataFrame(rows), names="Trạng thái", values="Robot", hole=.65, title="Kết nối thiết bị · mẫu"), width="stretch")
    table(d["logs"][-10:][::-1], "dashboard")



def dashboard_admin():
    d=data()
    with st.container(key="dashboard_metrics"):
        for col,label,value in zip(st.columns(4),['Tổng người dùng','Tổng robot','Đang Online','Đang Offline'],[len(d['users']),len(d['devices']),sum(r['online'] for r in d['devices']),sum(not r['online'] for r in d['devices'])]):
            col.metric(label,value)
    left,right=st.columns([1.4,1])
    with left,panel():
        st.subheader('Số phiên trò chuyện AI')
        frame=pd.DataFrame(d['usage'])
        if not frame.empty:
            light = st.session_state.get('appearance') == '☀️ Sáng'
            chart=px.area(frame.groupby('date',as_index=False)['sessions'].sum(),x='date',y='sessions',color_discrete_sequence=['#6250cb' if light else '#b1a1ff'])
            # Tick cuối neo giữa tại mép phải: dành chỗ cho nửa nhãn và viền SVG.
            chart.update_layout(paper_bgcolor='rgba(0,0,0,0)',plot_bgcolor='rgba(0,0,0,0)',font_color='#5d687d' if light else '#a4aec3',height=260,margin=dict(l=0,r=24,t=10,b=0),xaxis_title=None,yaxis_title=None)
            chart.update_yaxes(gridcolor='#d7dce7' if light else '#343d50')
            if light:
                # Màu tick riêng của template ghi đè font chung của biểu đồ.
                chart.update_xaxes(tickfont_color='#5d687d')
                chart.update_yaxes(tickfont_color='#5d687d')
            st.plotly_chart(chart,width='stretch')
        st.caption('Thống kê mô phỏng trong phiên')
    with right,panel():
        st.subheader('Trạng thái AI Provider')
        for name,config in d['providers'].items():
            st.markdown(f'<div class="provider-row"><div><strong>{escape(name)}</strong><small>{escape(config["model"])}</small></div><span class="status {"online" if config["enabled"] else "offline"}">{"Sẵn sàng" if config["enabled"] else "Đã tắt"}</span></div>', unsafe_allow_html=True)
    left,right=st.columns(2)
    with left,panel():
        st.subheader('Thiết bị hoạt động gần đây')
        render_frame(pd.DataFrame([{'ID':r['id'],'Tên robot':r['name'],'Trạng thái':'Online' if r['online'] else 'Offline','Kết nối cuối':r['heartbeat']} for r in d['devices']]),hide_index=True,width='stretch')
    with right,panel():
        st.subheader('Lỗi hệ thống gần đây')
        for log in d['logs'][-5:][::-1]:
            st.caption(f"{log['time']} · {log['level']}")
            st.write(log['event'])

