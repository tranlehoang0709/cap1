"""Yêu cầu chuyển trang qua cơ chế điều hướng Streamlit hiện có."""
import streamlit as st


# Giữ định danh cũ để các liên kết và session đang mở tiếp tục hoạt động.
USER_LABELS = {
    "Dashboard": "Trang chủ",
    "AI Chat": "Trò chuyện AI",
    "Thiết bị của tôi": "Robot của tôi",
    "Cấu hình trợ lý AI": "Cài đặt trợ lý",
    "Tài khoản": "Tài khoản",
}
USER_DESTINATIONS = {
    "AI Chat": ("AI Chat", "user_chat_section", "Trò chuyện"),
    "Lịch sử hội thoại": ("AI Chat", "user_chat_section", "Lịch sử"),
    "Cấu hình trợ lý AI": ("Cấu hình trợ lý AI", "user_assistant_section", "Cá nhân hóa"),
    "API Key cá nhân": ("Cấu hình trợ lý AI", "user_assistant_section", "Nâng cao"),
    "Tài khoản": ("Tài khoản", "user_account_section", "Thông tin tài khoản"),
    "Quyền riêng tư": ("Tài khoản", "user_account_section", "Quyền riêng tư"),
}


def user_destination(page):
    """Đổi nhãn hoặc liên kết cũ thành trang và tab, không sửa dữ liệu nghiệp vụ."""
    page = next((key for key, label in USER_LABELS.items() if label == page), page)
    return USER_DESTINATIONS.get(page, (page, None, None))


def go(page):
    st.session_state.navigate_to = page
    st.rerun()
