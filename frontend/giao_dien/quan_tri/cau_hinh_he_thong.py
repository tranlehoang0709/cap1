"""Trang Quản trị: cau_hinh_he_thong."""
import streamlit as st
from nen_tang.trang_thai import data, done
from thanh_phan.dung_chung.bieu_mau_tai_khoan import account


def settings():
    s = data()["settings"]
    with st.form("settings"):
        timeout = st.number_input("Timeout (giây)", 1, 600, s["timeout"])
        connections = st.number_input("Giới hạn kết nối", 1, 10000, s["connections"])
        heartbeat = st.number_input("Chu kỳ heartbeat (giây)", 1, 300, s["heartbeat"])
        save = st.form_submit_button("Lưu cấu hình mẫu")
    if save:
        s.update(timeout=timeout, connections=connections, heartbeat=heartbeat)
        done("Cập nhật cấu hình vận hành mẫu")



def render_page():
    general,security,notifications=st.tabs(['Cấu hình chung','Bảo mật','Thông báo'])
    with general:
        settings()
        s=data()['settings']
        with st.form('extra_settings'):
            retries=st.number_input('Số lần thử kết nối lại',0,10,s.get('retries',3))
            registration=st.toggle('Cho phép đăng ký tài khoản mới',s.get('registration',True))
            logging=st.toggle('Ghi log chi tiết',s.get('logging',True))
            save=st.form_submit_button('Lưu thay đổi',type='primary')
        if save:
            s.update(retries=retries,registration=registration,logging=logging)
            done('Lưu cấu hình hệ thống')
    with security:
        account()
    with notifications:
        s=data()['settings']
        with st.form('notification_settings'):
            offline=st.toggle('Thông báo robot mất kết nối',s.get('notify_offline',True))
            errors=st.toggle('Thông báo lỗi AI Provider',s.get('notify_errors',True))
            save=st.form_submit_button('Lưu thông báo',type='primary')
        if save:
            s.update(notify_offline=offline,notify_errors=errors)
            done('Lưu tùy chọn thông báo demo')

