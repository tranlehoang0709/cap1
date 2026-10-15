"""Reference portal layout using the existing session-local demo operations."""

from html import escape

import streamlit as st

import pandas as pd

import plotly.express as px

from ui import user, admin

from ui.state import data, current_user, approved_devices, preferences, done, uid, PROVIDERS

from ui.common import panel, render_frame, email_valid



from ui.robot import ROBOT

from ui.motion import render_robot_scene

from nen_tang.dieu_huong import go



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

from giao_dien.dinh_tuyen import USER_ROUTES, ADMIN_ROUTES
