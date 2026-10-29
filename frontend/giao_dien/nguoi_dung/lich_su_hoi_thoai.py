"""Trang Người dùng: lich_su_hoi_thoai."""
import streamlit as st
from nen_tang.trang_thai import data, current_user, done, uid, now, mine, allowed_providers
from thanh_phan.dung_chung.bang_du_lieu import table, select_record
from thanh_phan.bieu_mau.xac_nhan import confirm


def history():
    rows = [{k: v for k, v in r.items() if k != "messages"} for r in mine("conversations")]
    filtered = table(rows, "history", ["provider", "active"])
    record = select_record(filtered, "history_selected")
    if not record:
        return
    chat = next(c for c in mine("conversations") if c["id"] == record["id"])
    for message in chat["messages"]:
        with st.chat_message(message["role"]):
            st.write(message["content"])
    st.caption("Mở lại phiên hội thoại trong AI Chat.")
    if st.button("Tiếp tục phiên mẫu"):
        if chat["provider"] not in allowed_providers():
            st.error("Provider của phiên đã bị Admin tắt. Chọn phiên khác hoặc tạo phiên mới.")
        else:
            chat["active"] = True
            st.session_state[f"chat_selected_{current_user()['id']}"] = chat["id"]
            st.session_state.navigate_to = "AI Chat"
            done("Mở lại phiên hội thoại", "Hội thoại")
    accept = confirm(f"history_delete_{chat['id']}")
    if st.button("Xóa hội thoại mẫu"):
        if not accept:
            st.error("Cần xác nhận xóa.")
        else:
            data()["conversations"].remove(chat)
            done("Xóa hội thoại mẫu", "Quyền riêng tư")



def memory():
    st.info("USR-09 · P2 · Bộ nhớ mẫu, không học hay trích xuất từ hội thoại.")
    rows = table(mine("memory"), "memory")
    record = select_record(rows, "memory_edit")
    if record:
        m = next(m for m in mine("memory") if m["id"] == record["id"])
        with st.form(f"memory_form_{m['id']}"):
            content = st.text_area("Nội dung bộ nhớ", value=m["content"])
            save = st.form_submit_button("Chỉnh sửa bộ nhớ mẫu")
        if save:
            if not content.strip():
                st.error("Nội dung không được trống.")
            else:
                m["content"] = content.strip()
                done("Chỉnh sửa bộ nhớ mẫu", "Bộ nhớ")
        accept = confirm(f"memory_delete_{m['id']}")
        if st.button("Xóa bộ nhớ mẫu"):
            if not accept:
                st.error("Cần xác nhận xóa.")
            else:
                data()["memory"].remove(m)
                done("Xóa bộ nhớ mẫu", "Bộ nhớ")



def knowledge():
    st.info("USR-11 · P2 · Chỉ quản lý metadata tài liệu trong phiên. Không đọc nội dung, embedding, indexing hoặc chạy RAG.")
    table(mine("knowledge"), "knowledge")
    with st.form("knowledge_upload"):
        file = st.file_uploader("Tài liệu thử nghiệm", type=["pdf", "docx", "txt"])
        title = st.text_input("Tên hiển thị")
        save = st.form_submit_button("Thêm tài liệu mẫu")
    if save:
        if file is None or not title.strip():
            st.error("Chọn tài liệu và nhập tên.")
        else:
            data()["knowledge"].append({"id": uid("DOC"), "user": current_user()["id"], "title": title.strip(), "filename": file.name, "bytes": file.size, "created": now(), "status": "Metadata mẫu; chưa xử lý RAG"})
            done("Thêm metadata tài liệu mẫu", "Tài liệu")
    doc = select_record(mine("knowledge"), "knowledge_edit")
    if doc:
        st.json(doc)
        with st.form(f"doc_rename_{doc['id']}"):
            name = st.text_input("Tên tài liệu", value=doc["title"])
            save = st.form_submit_button("Cập nhật tên mẫu")
        if save:
            if not name.strip():
                st.error("Tên tài liệu không được trống.")
            else:
                doc["title"] = name.strip()
                done("Cập nhật tên tài liệu mẫu", "Tài liệu")
        accept = confirm(f"knowledge_delete_{doc['id']}")
        if st.button("Xóa tài liệu mẫu"):
            if not accept:
                st.error("Cần xác nhận.")
            else:
                data()["knowledge"].remove(doc)
                done("Xóa metadata tài liệu mẫu", "Tài liệu")



def render_page():
    tabs = st.tabs(['Lịch sử hội thoại','Bộ nhớ dài hạn','Tài liệu cá nhân'])
    for tab, render in zip(tabs,[history,memory,knowledge]):
        with tab:
            render()

