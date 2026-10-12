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

def go(page):
    st.session_state.navigate_to = page
    st.rerun()

def robot_cards(robots):
    if not robots:
        st.info("Chưa có robot. Gửi yêu cầu ghép nối để bắt đầu.")
    for start in range(0, len(robots), 3):
        for col, robot in zip(st.columns(3), robots[start:start+3]):
            with col, panel():
                st.write(f"**{robot['name']}**")
                render_robot_scene(online=robot['online'])
                online = robot['online']
                st.markdown(f'<span class="status {"online" if online else "offline"}">● {"Online" if online else "Offline"}</span>', unsafe_allow_html=True)
                st.caption(f"ID: {robot['id']}")
                with st.expander("Xem chi tiết"):
                    st.write(f"Pin: {robot['battery']}% · Firmware: {robot['firmware']}")
                    st.caption(f"Kết nối cuối: {robot['heartbeat']} · RSSI: {robot['rssi']} dBm")

def dashboard_user():
    u = current_user()
    robots = approved_devices(u['id'])
    p = preferences(u['id'])
    st.write(f"Chào mừng bạn trở lại, **{u['name']}**!")
    for col, label, value in zip(st.columns(4), ['Tổng số robot','Đang Online','Đang Offline','AI Provider'], [len(robots),sum(r['online'] for r in robots),sum(not r['online'] for r in robots),p['provider']]):
        col.metric(label, value)
    left, right = st.columns([2,1])
    with left, panel():
        st.subheader('Thiết bị của tôi')
        robot_cards(robots)
        if st.button('Xem tất cả →'):
            go('Thiết bị của tôi')
    with right:
        with panel():
            st.subheader('Trợ lý AI')
            st.write(f"✧ **{p['provider']}**")
            st.caption(f"{p['name']} · Trợ lý thông minh")
            if st.button('Bắt đầu trò chuyện →',type='primary',width='stretch'):
                go('AI Chat')
        with panel():
            st.subheader('Thao tác nhanh')
            for label, target in [('＋ Ghép nối robot','Thiết bị của tôi'),('✧ Mở AI Chat','AI Chat'),('⚙ Cấu hình trợ lý','Cấu hình trợ lý AI')]:
                if st.button(label,width='stretch'):
                    go(target)
    with st.expander('Thống kê sử dụng'):
        user.usage()

def devices_user():
    robot_cards(approved_devices(current_user()['id']))
    with st.expander('＋ Ghép nối robot / Quản lý liên kết'):
        user.robots()

def assistant():
    left, right = st.columns(2)
    with left, panel():
        st.subheader('Thông tin trợ lý')
        user.assistant()
    with right, panel():
        st.subheader('AI Provider')
        user.provider()

def history():
    tabs = st.tabs(['Lịch sử hội thoại','Bộ nhớ dài hạn','Tài liệu cá nhân'])
    for tab, render in zip(tabs,[user.history,user.memory,user.knowledge]):
        with tab:
            render()

def users():
    accounts, permissions = st.tabs(['Người dùng','Phân quyền'])
    with accounts:
        with st.expander('＋ Thêm người dùng'):
            with st.form('admin_add_user'):
                name = st.text_input('Họ tên người dùng')
                email = st.text_input('Email người dùng')
                password = st.text_input('Mật khẩu tạm',type='password')
                role = st.selectbox('Vai trò mới',['User','Admin'])
                save = st.form_submit_button('Thêm người dùng',type='primary')
            if save:
                if not name.strip() or not email_valid(email.strip()) or len(password)<8:
                    st.error('Nhập tên, email hợp lệ và mật khẩu ít nhất 8 ký tự.')
                elif any(u['email'].casefold()==email.strip().casefold() for u in data()['users']):
                    st.error('Email đã tồn tại.')
                else:
                    data()['users'].append(dict(id=uid('USR'),name=name.strip(),email=email.strip(),password=password,role=role,locked=False))
                    done('Thêm người dùng')
        admin.users()
        choices = [u['id'] for u in data()['users'] if u['id'] != current_user()['id']]
        selected = st.selectbox('Tài khoản cần xóa', choices, index=None)
        accepted = st.checkbox('Xác nhận xóa tài khoản và dữ liệu demo liên quan')
        if st.button('Xóa người dùng', disabled=selected is None):
            if not accepted:
                st.error('Cần xác nhận xóa tài khoản.')
            else:
                data()['users'] = [u for u in data()['users'] if u['id'] != selected]
                for robot in data()['devices']:
                    if robot['owner'] == selected:
                        robot['owner'] = None
                for key in ['requests', 'conversations', 'memory', 'knowledge', 'usage']:
                    data()[key] = [r for r in data()[key] if r['user'] != selected]
                for key in ['assistant', 'privacy', 'personal_keys']:
                    data()[key].pop(selected, None)
                data()['quotas'] = [r for r in data()['quotas'] if not (r['scope'] == 'User' and r['target'] == selected)]
                done('Xóa người dùng và dữ liệu demo liên quan')
    with permissions:
        admin.roles()

def devices_admin():
    robots=data()['devices']
    for col,label,value in zip(st.columns(3),['Tổng robot','Đang Online','Đang Offline'],[len(robots),sum(r['online'] for r in robots),sum(not r['online'] for r in robots)]):
        col.metric(label,value)
    registry, telemetry=st.tabs(['Quản lý thiết bị','Giám sát kết nối'])
    with registry:
        admin.devices()
    with telemetry:
        admin.telemetry()

def ai():
    for col,name in zip(st.columns(3),PROVIDERS):
        config=data()['providers'][name]
        with col,panel():
            st.subheader(name)
            enabled=st.toggle('Đang bật',config['enabled'],key=f'toggle_{name}')
            if enabled!=config['enabled']:
                config['enabled']=enabled
                done(f"{'Bật' if enabled else 'Tắt'} {name}")
            st.caption(config['model'])
            st.caption('● Sẵn sàng (mô phỏng)' if enabled else '● Đã tắt')
    settings, connection=st.tabs(['Cấu hình chung','Kiểm tra kết nối'])
    with settings:
        admin.providers()
    with connection:
        admin.server()

def keys():
    keys,quota=st.tabs(['API Key hệ thống','Cấu hình Quota & Rate Limit'])
    with keys:
        admin.system_keys()
    with quota:
        admin.quotas()

def monitoring():
    logs,resources=st.tabs(['Log hệ thống / quản trị / thiết bị','Giám sát tài nguyên'])
    with logs:
        admin.logs()
    with resources:
        admin.resources()

def settings():
    general,security,notifications=st.tabs(['Cấu hình chung','Bảo mật','Thông báo'])
    with general:
        admin.settings()
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
        user.account()
    with notifications:
        s=data()['settings']
        with st.form('notification_settings'):
            offline=st.toggle('Thông báo robot mất kết nối',s.get('notify_offline',True))
            errors=st.toggle('Thông báo lỗi AI Provider',s.get('notify_errors',True))
            save=st.form_submit_button('Lưu thông báo',type='primary')
        if save:
            s.update(notify_offline=offline,notify_errors=errors)
            done('Lưu tùy chọn thông báo demo')

def dashboard_admin():
    d=data()
    for col,label,value in zip(st.columns(4),['Tổng người dùng','Tổng robot','Đang Online','Đang Offline'],[len(d['users']),len(d['devices']),sum(r['online'] for r in d['devices']),sum(not r['online'] for r in d['devices'])]):
        col.metric(label,value)
    left,right=st.columns([1.4,1])
    with left,panel():
        st.subheader('Số phiên trò chuyện AI')
        frame=pd.DataFrame(d['usage'])
        if not frame.empty:
            chart=px.area(frame.groupby('date',as_index=False)['sessions'].sum(),x='date',y='sessions',color_discrete_sequence=['#7161ff'])
            chart.update_layout(paper_bgcolor='rgba(0,0,0,0)',plot_bgcolor='rgba(0,0,0,0)',font_color='#455b7b' if st.session_state.get('appearance') == '☀️ Sáng' else '#bdd0ed',height=260,margin=dict(l=0,r=0,t=10,b=0))
            st.plotly_chart(chart,width='stretch')
        st.caption('Thống kê mô phỏng trong phiên')
    with right,panel():
        st.subheader('Trạng thái AI Provider')
        for name,config in d['providers'].items():
            st.write(f"**{name}** · {'🟢 Sẵn sàng' if config['enabled'] else '⚫ Đã tắt'}")
            st.caption(config['model'])
    left,right=st.columns(2)
    with left,panel():
        st.subheader('Thiết bị hoạt động gần đây')
        render_frame(pd.DataFrame([{'ID':r['id'],'Tên robot':r['name'],'Trạng thái':'Online' if r['online'] else 'Offline','Kết nối cuối':r['heartbeat']} for r in d['devices']]),hide_index=True,width='stretch')
    with right,panel():
        st.subheader('Lỗi hệ thống gần đây')
        for log in d['logs'][-5:][::-1]:
            st.caption(f"{log['time']} · {log['level']}")
            st.write(log['event'])

USER_ROUTES={'Dashboard':dashboard_user,'AI Chat':user.web_chat,'Thiết bị của tôi':devices_user,'Cấu hình trợ lý AI':assistant,'API Key cá nhân':user.personal_keys,'Lịch sử hội thoại':history,'Quyền riêng tư':user.privacy_page,'Tài khoản':user.account}
ADMIN_ROUTES={'Dashboard':dashboard_admin,'Quản lý người dùng':users,'Quản lý thiết bị':devices_admin,'AI Management':ai,'API Key & Quota':keys,'OTA Firmware':admin.firmware,'Logs & Monitoring':monitoring,'System Settings':settings}
