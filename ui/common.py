"""Shared native Streamlit UI components."""
import math
import pandas as pd
import streamlit as st


def panel():
    index = st.session_state.get("aiva_panel_index", 0)
    st.session_state.aiva_panel_index = index + 1
    return st.container(border=True, key=f"aiva_panel_{index}")


def render_frame(frame, **kwargs):
    if st.session_state.get("appearance") == "☀️ Sáng":
        st.table(frame)
    else:
        st.dataframe(frame, **kwargs)


def table(rows, key, filters=()):
    if not rows:
        st.info("Chưa có dữ liệu mẫu.")
        return []
    frame = pd.DataFrame(rows)
    query = st.text_input("Tìm kiếm", key=f"search_{key}")
    if query:
        frame = frame[frame.astype(str).apply(lambda col: col.str.contains(query, case=False, regex=False)).any(axis=1)]
    for column in filters:
        if column in frame:
            value = st.selectbox(f"Lọc {column}", ["Tất cả"] + sorted(frame[column].dropna().astype(str).unique().tolist()), key=f"filter_{key}_{column}")
            if value != "Tất cả":
                frame = frame[frame[column].astype(str) == value]
    size = st.selectbox("Số dòng / trang", [10, 25, 50], key=f"size_{key}")
    pages = max(1, math.ceil(len(frame) / size))
    page_key = f"page_{key}"
    if st.session_state.get(page_key, 1) > pages:
        st.session_state[page_key] = 1
    page = st.number_input("Trang", min_value=1, max_value=pages, step=1, key=page_key)
    st.caption(f"{len(frame)} kết quả · Trang {page}/{pages}")
    render_frame(frame.iloc[(page - 1) * size:page * size], hide_index=True, width="stretch")
    return frame.to_dict("records")


def select_record(rows, key, label="Chọn bản ghi"):
    if not rows:
        return None
    ids = [r["id"] for r in rows]
    selected = st.selectbox(label, ids, key=key)
    return next(r for r in rows if r["id"] == selected)


def confirm(key, label="Tôi xác nhận thao tác trên dữ liệu mẫu"):
    return st.checkbox(label, key=f"confirm_{key}")


def email_valid(value):
    import re
    return bool(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value))
