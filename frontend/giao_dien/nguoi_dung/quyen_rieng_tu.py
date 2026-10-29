"""Trang Người dùng: quyen_rieng_tu."""
import streamlit as st
from nen_tang.trang_thai import data, current_user, privacy, done
from thanh_phan.bieu_mau.xac_nhan import confirm


def _reset_delete_confirmation():
    """Danh mục mới cần xác nhận mới; callback chạy trước khi dựng lại checkbox."""
    st.session_state["confirm_privacy_delete"] = False


def privacy_page():
    u = current_user()
    config = privacy(u["id"])
    st.caption("Không thu âm hay gửi dữ liệu đến dịch vụ AI. Khi tắt lưu lịch sử, tin nhắn chat vẫn tồn tại tạm trong phiên chat hiện tại nhưng không được đưa vào danh sách lịch sử.")
    with st.form("privacy"):
        history_enabled = st.checkbox("Cho phép lưu lịch sử hội thoại mẫu", value=config["history"])
        memory_enabled = st.checkbox("Đồng ý lưu bộ nhớ dài hạn (cờ mô phỏng)", value=config["memory"])
        save = st.form_submit_button("Lưu lựa chọn quyền riêng tư")
    if save:
        config.update(history=history_enabled, memory=memory_enabled)
        done("Cập nhật lựa chọn quyền riêng tư", "Quyền riêng tư")
    action = st.selectbox("Dữ liệu cần xóa", ["Lịch sử hội thoại", "Bộ nhớ dài hạn", "Tài liệu cá nhân", "Toàn bộ dữ liệu AI cá nhân"], on_change=_reset_delete_confirmation)
    accept = confirm("privacy_delete", "Xác nhận xóa dữ liệu mẫu đã chọn")
    if st.button("Xóa dữ liệu mẫu"):
        if not accept:
            st.error("Cần xác nhận thao tác xóa.")
        else:
            groups = {"Lịch sử hội thoại": ["conversations"], "Bộ nhớ dài hạn": ["memory"], "Tài liệu cá nhân": ["knowledge"], "Toàn bộ dữ liệu AI cá nhân": ["conversations", "memory", "knowledge", "usage"]}[action]
            for group in groups:
                data()[group] = [r for r in data()[group] if r["user"] != u["id"]]
            if "conversations" in groups:
                st.session_state.pop(f"temporary_chat_{u['id']}", None)
                st.session_state.pop(f"chat_selected_{u['id']}", None)
            if action == "Toàn bộ dữ liệu AI cá nhân":
                data()["personal_keys"].pop(u["id"], None)
                data()["assistant"].pop(u["id"], None)
            done(f"Xóa {action.lower()}", "Quyền riêng tư")

