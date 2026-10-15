"""Trang Quản trị: nhat_ky_giam_sat."""
import streamlit as st
import pandas as pd
import plotly.express as px
from nen_tang.trang_thai import data
from thanh_phan.dung_chung.bang_du_lieu import table, select_record


def logs():
    rows = table(data()["logs"][::-1], "logs", ["level", "type", "actor"])
    record = select_record(rows, "log_details")
    if record:
        st.json(record)



def resources():
    st.caption("ADM-08 · P1 · Các số liệu chỉ minh họa hạ tầng có GPU; không đọc tài nguyên máy thật.")
    frame = pd.DataFrame({"Phút": list(range(1, 13)), "CPU (%)": [24, 28, 33, 29, 35, 40, 38, 31, 28, 35, 32, 30], "RAM (%)": [42, 42, 43, 44, 44, 45, 44, 44, 43, 43, 44, 43], "GPU (%)": [10, 18, 42, 30, 12, 48, 52, 24, 14, 32, 28, 20]})
    cols = st.columns(4)
    for col, label, value in zip(cols, ["CPU", "RAM", "GPU", "VRAM"], ["30%", "43%", "20%", "3.2 / 8 GB"]):
        col.metric(f"{label} mẫu", value)
    st.plotly_chart(px.line(frame, x="Phút", y=["CPU (%)", "RAM (%)", "GPU (%)"], title="Tài nguyên · dữ liệu mẫu"), width="stretch")



render_logs = logs
render_resources = resources


def monitoring():
    logs,resources=st.tabs(['Log hệ thống / quản trị / thiết bị','Giám sát tài nguyên'])
    with logs:
        render_logs()
    with resources:
        render_resources()

