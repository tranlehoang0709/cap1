"""Checks for the actions introduced by the reference portal redesign."""
from smoke import ROOT, clean, login, navigate, logout, widget
from streamlit.testing.v1 import AppTest

app = clean(AppTest.from_file(str(ROOT / 'app.py'), default_timeout=30).run())
login(app, 'admin@example.test')
navigate(app, 'Quản lý người dùng')
widget(app.text_input, 'Họ tên người dùng').set_value('Người dùng thử')
widget(app.text_input, 'Email người dùng').set_value('created@example.test')
widget(app.text_input, 'Mật khẩu tạm').set_value('Demo123!')
widget(app.button, 'Thêm người dùng').click()
clean(app.run())
created = next(u for u in app.session_state['demo']['users'] if u['email'] == 'created@example.test')
widget(app.selectbox, 'Tài khoản cần xóa').set_value(created['id'])
clean(app.run())
widget(app.button, 'Xóa người dùng').click()
clean(app.run())
assert any(u['id'] == created['id'] for u in app.session_state['demo']['users'])
widget(app.checkbox, 'Xác nhận xóa tài khoản và dữ liệu demo liên quan').check()
widget(app.button, 'Xóa người dùng').click()
clean(app.run())
assert not any(u['id'] == created['id'] for u in app.session_state['demo']['users'])
print('PASS: add and delete User, with confirmation and cleanup')
navigate(app, 'AI Management')
app.toggle(key='toggle_OpenAI').set_value(False)
clean(app.run())
assert not app.session_state['demo']['providers']['OpenAI']['enabled']
navigate(app, 'System Settings')
widget(app.toggle, 'Cho phép đăng ký tài khoản mới').set_value(False)
widget(app.button, 'Lưu thay đổi').click()
clean(app.run())
logout(app)
assert any('tạm đóng đăng ký' in x.value for x in app.info)
login(app, 'user@example.test')
widget(app.button, 'Bắt đầu trò chuyện →').click()
clean(app.run())
assert widget(app.sidebar.radio, 'Điều hướng').value == 'AI Chat'
assert 'OpenAI' not in widget(app.selectbox, 'Provider cho phiên mới').options
print('PASS: dashboard navigation, provider disable and registration setting')
navigate(app, 'Cấu hình trợ lý AI')
widget(app.slider, 'Tốc độ giọng nói').set_value(1.5)
widget(app.button, 'Lưu giọng nói mẫu').click()
clean(app.run())
assert app.session_state['demo']['assistant']['user1']['speed'] == 1.5
print('PASS: voice speed setting persists in mock preferences')
print('ALL REFERENCE CHECKS PASSED')

# Exercise both appearance modes through the same native theme control.
for email in ['user@example.test', 'admin@example.test']:
    themed = clean(AppTest.from_file(str(ROOT / 'app.py'), default_timeout=30).run())
    login(themed, email)
    for dark in [False, True]:
        themed.toggle(key='aiva_theme_switch').set_value(dark)
        clean(themed.run())
        assert themed.session_state['appearance'] == ('🌙 Tối' if dark else '☀️ Sáng')
        for page in widget(themed.sidebar.radio, 'Điều hướng').options:
            navigate(themed, page)
print('PASS: all User/Admin pages render in both theme modes')
