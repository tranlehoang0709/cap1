"""Hiển thị, lọc và phân trang bảng dữ liệu dùng chung."""
import math
import pandas as pd
import streamlit as st


def render_frame(frame, **kwargs):
    if st.session_state.get("appearance") == "☀️ Sáng":
        st.table(frame, hide_index=kwargs.get("hide_index"), width=kwargs.get("width", "stretch"))
    else:
        st.dataframe(frame, **kwargs)



def table(rows, key, filters=()):
    """Bảng phân trang với bộ lọc và thanh công cụ Streamlit hiện có."""
    if not rows:
        st.info("Chưa có dữ liệu mẫu.")
        return []
    frame = pd.DataFrame(rows)
    page_key = f"page_{key}"
    filter_columns = [column for column in filters if column in frame]

    def reset_page():
        st.session_state[page_key] = 1

    def reset_filters():
        st.session_state[f"search_{key}"] = ""
        for column in filter_columns:
            st.session_state[f"filter_{key}_{column}"] = "Tất cả"
        reset_page()

    with st.container(key=f"table_toolbar_{key}"):
        search, reset = st.columns([4, 1], vertical_alignment="bottom")
        with search:
            query = st.text_input(
                "Tìm kiếm", key=f"search_{key}", placeholder="Nhập từ khóa…",
                on_change=reset_page,
            ).strip()
        with reset:
            st.button("Xóa bộ lọc", key=f"reset_{key}", on_click=reset_filters,
                      width="stretch")
        selections = {}
        if filter_columns:
            for slot, column in zip(st.columns(len(filter_columns)), filter_columns):
                options = ["Tất cả"] + sorted(frame[column].dropna().astype(str).unique().tolist())
                filter_key = f"filter_{key}_{column}"
                if st.session_state.get(filter_key, "Tất cả") not in options:
                    st.session_state[filter_key] = "Tất cả"
                with slot:
                    selections[column] = st.selectbox(
                        f"Lọc {column}", options, key=filter_key, on_change=reset_page,
                    )
    if query:
        frame = frame[frame.astype(str).apply(lambda col: col.str.contains(query, case=False, regex=False)).any(axis=1)]
    for column, value in selections.items():
        if value != "Tất cả":
            frame = frame[frame[column].astype(str) == value]
    with st.container(key=f"table_pagination_{key}"):
        summary, sizing, paging = st.columns([3, 1.4, 1], vertical_alignment="bottom")
        with sizing:
            size = st.selectbox("Số dòng / trang", [10, 25, 50], key=f"size_{key}",
                                on_change=reset_page)
        pages = max(1, math.ceil(len(frame) / size))
        st.session_state[page_key] = min(max(st.session_state.get(page_key, 1), 1), pages)
        with paging:
            page = st.number_input("Trang", min_value=1, max_value=pages, step=1,
                                   key=page_key, disabled=pages == 1)
        with summary:
            st.caption(f"{len(frame)} / {len(rows)} kết quả · Trang {page}/{pages}")
    if frame.empty:
        st.info("Không có kết quả phù hợp. Thử từ khóa khác hoặc xóa bộ lọc.")
    else:
        render_frame(frame.iloc[(page - 1) * size:page * size], hide_index=True, width="stretch")
    return frame.to_dict("records")



def select_record(rows, key, label="Chọn bản ghi"):
    if not rows:
        return None
    ids = [r["id"] for r in rows]
    if key in st.session_state and st.session_state[key] not in ids:
        st.session_state[key] = ids[0]
    selected = st.selectbox(label, ids, key=key)
    return next(r for r in rows if r["id"] == selected)

