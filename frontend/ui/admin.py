"""Admin presentation and explicit session-local mock interactions."""
import streamlit as st
import pandas as pd
import plotly.express as px

from ui.state import data, uid, now, done, current_user, PROVIDERS
from ui.common import panel, render_frame, table, select_record, confirm, email_valid


from giao_dien.quan_tri.bang_dieu_khien import dashboard
from giao_dien.quan_tri.quan_ly_nguoi_dung import users
from giao_dien.quan_tri.quan_ly_nguoi_dung import roles
from giao_dien.quan_tri.quan_ly_thiet_bi import devices
from giao_dien.quan_tri.quan_ly_thiet_bi import telemetry
from giao_dien.quan_tri.quan_ly_ai import server
from giao_dien.quan_tri.nhat_ky_giam_sat import resources
from giao_dien.quan_tri.nhat_ky_giam_sat import logs
from giao_dien.quan_tri.cau_hinh_he_thong import settings
from giao_dien.quan_tri.khoa_api_va_han_muc import system_keys
from giao_dien.quan_tri.khoa_api_va_han_muc import quotas
from giao_dien.quan_tri.firmware_ota import firmware
from giao_dien.quan_tri.quan_ly_ai import providers

ROUTES = {
    "Dashboard quản trị": dashboard,
    "Người dùng": users,
    "Phân quyền": roles,
    "Thiết bị & ghép nối": devices,
    "Giám sát thiết bị": telemetry,
    "AI Server": server,
    "Tài nguyên": resources,
    "Logs & Audit": logs,
    "Cấu hình hệ thống": settings,
    "System API Key": system_keys,
    "Quota & Rate Limit": quotas,
    "OTA Firmware": firmware,
    "AI Provider": providers,
}
