"""Tương thích import cũ; implementation trang nằm trong giao_dien.nguoi_dung."""
from giao_dien.nguoi_dung.thiet_bi import robots
from giao_dien.nguoi_dung.cau_hinh_tro_ly import assistant, provider
from giao_dien.nguoi_dung.lich_su_hoi_thoai import history, memory, knowledge
from giao_dien.nguoi_dung.bang_dieu_khien import usage
from giao_dien.nguoi_dung.tro_chuyen_ai import web_chat, render_chat
from giao_dien.nguoi_dung.khoa_api_ca_nhan import personal_keys
from giao_dien.nguoi_dung.quyen_rieng_tu import privacy_page
from thanh_phan.dung_chung.bieu_mau_tai_khoan import account
from thanh_phan.dung_chung.quan_ly_khoa_api import key_manager

ROUTES = {
    "Robot của tôi": robots,
    "Trợ lý AI": assistant,
    "AI Provider": provider,
    "Personal API Key": personal_keys,
    "Lịch sử hội thoại": history,
    "Bộ nhớ dài hạn": memory,
    "Tài liệu cá nhân": knowledge,
    "Quyền riêng tư": privacy_page,
    "Thống kê sử dụng": usage,
    "Website AI Chat": web_chat,
    "Tài khoản": account,
}
