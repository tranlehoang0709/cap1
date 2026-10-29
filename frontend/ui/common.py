"""Giữ các import dùng chung cũ; mỗi thành phần chỉ có một implementation."""
from nen_tang.kiem_tra_du_lieu import email_valid
from thanh_phan.bo_cuc.tieu_de import page_header
from thanh_phan.dung_chung.khung_noi_dung import panel
from thanh_phan.dung_chung.bang_du_lieu import render_frame, table, select_record
from thanh_phan.bieu_mau.xac_nhan import confirm

__all__ = ["email_valid", "page_header", "panel", "render_frame", "table", "select_record", "confirm"]
