"""Registry trang dùng trực tiếp implementation, giữ nguyên thứ tự menu."""
from giao_dien.nguoi_dung.tro_chuyen_ai import web_chat
from giao_dien.nguoi_dung.khoa_api_ca_nhan import personal_keys
from giao_dien.nguoi_dung.quyen_rieng_tu import privacy_page
from thanh_phan.dung_chung.bieu_mau_tai_khoan import account
from giao_dien.quan_tri.firmware_ota import firmware

from giao_dien.nguoi_dung.thiet_bi import robot_cards, devices_user

from giao_dien.nguoi_dung.bang_dieu_khien import dashboard_user

from giao_dien.nguoi_dung.cau_hinh_tro_ly import render_page as assistant

from giao_dien.nguoi_dung.lich_su_hoi_thoai import render_page as history



from giao_dien.quan_tri.quan_ly_nguoi_dung import render_page as users
from giao_dien.quan_tri.quan_ly_thiet_bi import devices_admin
from giao_dien.quan_tri.quan_ly_ai import ai
from giao_dien.quan_tri.khoa_api_va_han_muc import keys
from giao_dien.quan_tri.nhat_ky_giam_sat import monitoring
from giao_dien.quan_tri.cau_hinh_he_thong import render_page as settings
from giao_dien.quan_tri.bang_dieu_khien import dashboard_admin

USER_ROUTES={'Dashboard':dashboard_user,'AI Chat':web_chat,'Thiết bị của tôi':devices_user,'Cấu hình trợ lý AI':assistant,'API Key cá nhân':personal_keys,'Lịch sử hội thoại':history,'Quyền riêng tư':privacy_page,'Tài khoản':account}
ADMIN_ROUTES={'Dashboard':dashboard_admin,'Quản lý người dùng':users,'Quản lý thiết bị':devices_admin,'AI Management':ai,'API Key & Quota':keys,'OTA Firmware':firmware,'Logs & Monitoring':monitoring,'System Settings':settings}
