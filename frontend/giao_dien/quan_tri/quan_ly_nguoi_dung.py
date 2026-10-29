"""Trang Quản trị: quan_ly_nguoi_dung."""
import streamlit as st
import pandas as pd
from nen_tang.trang_thai import data, uid, done, current_user
from nen_tang.kiem_tra_du_lieu import email_valid
from thanh_phan.dung_chung.bang_du_lieu import render_frame, table, select_record
from thanh_phan.bieu_mau.xac_nhan import confirm


def users():
    rows = [{"id": u["id"], "Tên": u["name"], "Email": u["email"], "Role": u["role"], "Trạng thái": "Khóa" if u["locked"] else "Hoạt động", "Robot": sum(d["owner"] == u["id"] for d in data()["devices"])} for u in data()["users"]]
    filtered = table(rows, "users", ["Role", "Trạng thái"])
    record = select_record(filtered, "user_edit")
    if not record:
        return
    u = next(u for u in data()["users"] if u["id"] == record["id"])
    with st.form(f"user_form_{u['id']}"):
        name = st.text_input("Tên", value=u["name"])
        email = st.text_input("Email", value=u["email"])
        locked = st.checkbox("Khóa tài khoản", value=u["locked"], disabled=u["id"] == current_user()["id"])
        save = st.form_submit_button("Cập nhật mẫu")
    if save:
        if not name.strip() or not email_valid(email.strip()):
            st.error("Tên và email phải hợp lệ.")
        elif any(x["id"] != u["id"] and x["email"].casefold() == email.strip().casefold() for x in data()["users"]):
            st.error("Email trùng tài khoản khác.")
        else:
            u.update(name=name.strip(), email=email.strip(), locked=locked)
            done(f"Cập nhật tài khoản {u['id']}")



def roles():
    st.info("Hai vai trò cố định theo Functions. Phân quyền tại đây chỉ mô phỏng hiển thị, không phải cơ chế bảo mật production.")
    render_frame(pd.DataFrame([{"Role": "Admin", "Quyền": "ADM-01 đến ADM-14; quản trị toàn bộ dữ liệu mẫu"}, {"Role": "User", "Quyền": "5 mục User Portal; dữ liệu cá nhân và chat mô phỏng; ghép nối robot cần Admin duyệt"}]), hide_index=True, width="stretch")
    u = select_record(data()["users"], "role_user", "Chọn tài khoản")
    with st.form(f"role_form_{u['id']}"):
        role = st.selectbox("Role", ["Admin", "User"], index=["Admin", "User"].index(u["role"]))
        accept = confirm("admin_role", "Xác nhận thay đổi quyền mẫu", scope=(u["id"], role))
        save = st.form_submit_button("Cập nhật Role")
    if save:
        if not accept:
            st.error("Cần xác nhận thay đổi quyền.")
        elif u["id"] == current_user()["id"] and role != "Admin":
            st.error("Không hạ quyền tài khoản Admin đang đăng nhập trong demo.")
        else:
            u["role"] = role
            done(f"Đổi quyền {u['id']} thành {role}")



def render_page():
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
        users()
        choices = [u['id'] for u in data()['users'] if u['id'] != current_user()['id']]
        selected = st.selectbox('Tài khoản cần xóa', choices, index=None)
        accepted = confirm("admin_delete_user", 'Xác nhận xóa tài khoản và dữ liệu demo liên quan', scope=(selected,))
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
        roles()

