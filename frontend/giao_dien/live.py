"""AIVA-IoT Streamlit client backed by the live Backend API."""
import json
from urllib.parse import quote

import pandas as pd
import streamlit as st

from nen_tang.backend import BackendError, api, clear_auth




def api_error(error):
    st.error(error.message)
    if error.status == 0:
        st.caption("Kiểm tra Backend, MySQL và biến AIVA_BACKEND_URL nếu bạn dùng địa chỉ khác.")


def call(path, method="GET", body=None, query=None):
    try:
        return api(path, method, body, query=query)
    except BackendError as error:
        api_error(error)
        return None


def rows(value):
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        for key in ("items", "data", "results"):
            if isinstance(value.get(key), list):
                return value[key]
    return []


def table(value, *, hide_index=True):
    records = rows(value)
    if records:
        st.dataframe(pd.DataFrame(records), hide_index=hide_index, width="stretch")
    else:
        st.info("Backend chưa có bản ghi để hiển thị.")


def field(value, key, default=""):
    return value.get(key, default) if isinstance(value, dict) else default


def login_screen():
    st.title("AIVA-IoT")
    st.caption("Đăng nhập bằng tài khoản được lưu trong Backend.")
    login_tab, register_tab = st.tabs(["Đăng nhập", "Đăng ký User"])
    with login_tab:
        with st.form("backend_login"):
            email = st.text_input("Email", autocomplete="username")
            password = st.text_input("Mật khẩu", type="password", autocomplete="current-password")
            submit = st.form_submit_button("Đăng nhập", type="primary", width="stretch")
        if submit:
            try:
                pair = api("/auth/login", "POST", {"email": email.strip(), "password": password}, auth=False)
                st.session_state.access_token = pair["access_token"]
                st.session_state.refresh_token = pair["refresh_token"]
                st.rerun()
            except (BackendError, KeyError, TypeError) as error:
                api_error(error if isinstance(error, BackendError) else BackendError(0, "Backend không trả token đăng nhập hợp lệ."))
    with register_tab:
        with st.form("backend_register"):
            display_name = st.text_input("Họ tên")
            reg_email = st.text_input("Email đăng ký", autocomplete="email")
            reg_password = st.text_input("Mật khẩu", type="password", autocomplete="new-password")
            submit_register = st.form_submit_button("Tạo tài khoản")
        if submit_register:
            try:
                api("/auth/register", "POST", {"email": reg_email.strip(), "display_name": display_name.strip(), "password": reg_password}, auth=False)
                st.success("Đăng ký thành công. Hãy đăng nhập bằng tài khoản vừa tạo.")
            except BackendError as error:
                api_error(error)


def dashboard_user(account):
    st.subheader(f"Xin chào, {field(account, 'display_name', field(account, 'email'))}")
    profile = call("/ai/profile")
    devices = call("/devices", query={"page": 1, "limit": 100})
    conversations = call("/conversations", query={"page": 1, "limit": 100})
    quotas = call("/quotas")
    cols = st.columns(4)
    cols[0].metric("Robot đã ghép", len(rows(devices)) if devices is not None else "—")
    cols[1].metric("Hội thoại đã lưu", field(conversations, "total", "—"))
    cols[2].metric("Chính sách quota", len(rows(quotas)) if quotas is not None else "—")
    cols[3].metric("Tên trợ lý", field(profile, "assistant_name", "Chưa cấu hình") if profile is not None else "—")
    st.caption("Số liệu tải từ Backend; trang không tự tạo dữ liệu thay thế.")
    if devices is not None:
        st.subheader("Thiết bị của bạn")
        table(devices)


def dashboard_admin():
    summary = call("/admin/dashboard")
    if summary is not None:
        st.subheader("Tổng quan hệ thống")
        cols = st.columns(5)
        for col, (key, label) in zip(cols, (("users", "Người dùng"), ("devices", "Thiết bị"), ("assigned_devices", "Đã ghép"), ("online_devices", "Đang online"), ("conversations", "Hội thoại"))):
            col.metric(label, summary.get(key, "—"))
        st.caption(f"Cập nhật: {summary.get('generated_at', '—')} · Dữ liệu do Backend trả về.")
    instances = call("/admin/monitoring/instances")
    if instances is not None:
        st.subheader("AI Server instances")
        table(instances)


def user_devices():
    devices = call("/devices", query={"page": 1, "limit": 100})
    if devices is not None:
        st.subheader("Robot đã ghép")
        for device in rows(devices):
            ident = str(device.get("id", ""))
            with st.expander(f"{device.get('display_name') or device.get('device_uid') or 'Thiết bị'} · ID {ident}"):
                st.json(device)
                st.markdown("#### Cấu hình Wi-Fi")
                st.caption("Chỉ thiết bị trong danh sách do Backend trả về mới có hướng dẫn cấu hình ở đây. Website không nhận hoặc chuyển tiếp mật khẩu Wi-Fi.")
                if st.button("Mở hướng dẫn Wi-Fi", key=f"wifi_setup_open_{ident}"):
                    st.session_state[f"wifi_setup_open_{ident}"] = True

                if st.session_state.get(f"wifi_setup_open_{ident}"):
                    connection_status = str(device.get("connection_status", "unknown")).lower()
                    if connection_status == "online":
                        st.success("Backend ghi nhận thiết bị online.")
                    elif connection_status == "offline":
                        st.warning("Backend hiện ghi nhận thiết bị offline; chưa xác nhận được kết nối sau khi cấu hình.")
                    else:
                        st.info("Chưa có trạng thái kết nối từ Backend cho thiết bị này.")
                    st.caption(
                        f"Lần cuối Backend nhận heartbeat: {device.get('last_seen_at') or 'chưa có dữ liệu'}. "
                        "Đây là trạng thái thiết bị từ Backend, không phải trạng thái trực tiếp của portal Wi-Fi."
                    )
                    st.info(
                        "1. Cấp nguồn cho robot. Khi chưa có Wi-Fi đã lưu, firmware mở AP cấu hình. "
                        "Nếu robot đang thử kết nối Wi-Fi đã lưu nhưng thất bại, chờ tối đa 60 giây để AP xuất hiện.\n\n"
                        "2. Trên điện thoại hoặc máy tính, mở cài đặt Wi-Fi và kết nối mạng `Xiaozhi-*` của robot. "
                        "Nếu hệ điều hành báo không có Internet, hãy chọn tiếp tục kết nối.\n\n"
                        "3. Khi thiết bị đã nối vào AP của robot, mở portal cục bộ bên dưới, chọn SSID và nhập mật khẩu "
                        "ngay trên trang của ESP32. Mật khẩu không đi qua website AIVA-IoT hoặc Backend."
                    )
                    st.warning(
                        "Portal firmware hiện tại dùng HTTP trên AP mở. Cấu hình chỉ trong lúc ở gần robot và "
                        "không dùng mạng Wi-Fi công cộng; firmware cần được nâng cấp để bảo vệ kênh provisioning."
                    )
                    st.link_button("Mở portal cục bộ ESP32", "http://192.168.4.1", help="Mở sau khi máy đã kết nối vào AP Xiaozhi-*")
                    st.caption(
                        "Sau khi portal báo kết nối thành công, robot sẽ thử lại kết nối mạng. "
                        "Quay lại mạng Wi-Fi/Internet thường dùng rồi tải lại trang Thiết bị của tôi để kiểm tra trạng thái. "
                        "Nếu portal báo sai mật khẩu hoặc không tìm thấy mạng, kiểm tra lại SSID/băng tần/mật khẩu rồi gửi lại từ portal. "
                        "Portal chưa gửi trạng thái provisioning trực tiếp về website."
                    )
                    st.error(
                        "Đổi Wi-Fi cho robot đang hoạt động chưa được hỗ trợ từ website: firmware hiện không có "
                        "reconfigure từ xa đã xác thực; SD2 cũng chưa có thao tác vật lý vào provisioning được xác minh."
                    )
                with st.form(f"rename_{ident}"):
                    name = st.text_input("Tên hiển thị", value=device.get("display_name") or "")
                    save = st.form_submit_button("Lưu tên")
                if save:
                    result = call(f"/devices/{ident}", "PATCH", {"display_name": name.strip()})
                    if result is not None:
                        st.success("Đã cập nhật tên thiết bị.")
                        st.rerun()
                if st.button("Hủy liên kết thiết bị", key=f"unlink_{ident}"):
                    result = call(f"/devices/{ident}/assignment", "DELETE")
                    if result is not None:
                        st.success("Đã gửi yêu cầu hủy liên kết.")
                        st.rerun()
    st.subheader("Ghép nối thiết bị")
    st.caption("Nhập pairing code do hệ thống cấp; không có mã demo trong giao diện.")
    with st.form("pair_device"):
        pairing_code = st.text_input("Pairing code", type="password")
        send = st.form_submit_button("Gửi yêu cầu ghép nối")
    if send:
        result = call("/devices/pairing-requests", "POST", {"pairing_code": pairing_code.strip()})
        if result is not None:
            st.success("Backend đã nhận yêu cầu ghép nối.")
            st.json(result)
    requests = call("/devices/pairing-requests/mine", query={"page": 1, "limit": 100})
    if requests is not None:
        st.subheader("Yêu cầu của bạn")
        table(requests)


def assistant_settings():
    profile = call("/ai/profile")
    providers = call("/ai/providers")
    if profile is None:
        return
    provider_rows = rows(providers)
    st.subheader("Cấu hình trợ lý lưu trong Backend")
    with st.form("assistant_profile"):
        name = st.text_input("Tên trợ lý", value=field(profile, "assistant_name"))
        language = st.text_input("Mã ngôn ngữ", value=field(profile, "language_code", "vi"))
        voice = st.text_input("Mã giọng nói", value=field(profile, "voice_code"))
        prompt = st.text_area("System prompt", value=field(profile, "system_prompt"), height=180)
        options = {f"{p.get('name')} ({p.get('code')})": str(p.get("id")) for p in provider_rows if p.get("is_enabled")}
        labels = list(options)
        current = str(field(profile, "preferred_provider_id"))
        default_index = next((i for i, label in enumerate(labels) if options[label] == current), 0)
        selected = st.selectbox("Provider ưu tiên", ["Không chọn"] + labels, index=default_index + 1 if labels and current in options.values() else 0)
        save = st.form_submit_button("Lưu cấu hình")
    if save:
        preferred_provider = options.get(selected) if selected != "Không chọn" else None
        if preferred_provider is None and current in options.values():
            preferred_provider = current
        preferred_model = field(profile, "preferred_llm_model_id") if preferred_provider == current else None
        body = {"assistant_name": name.strip() or None, "system_prompt": prompt or None, "language_code": language.strip() or None,
                "voice_code": voice.strip() or None, "preferred_provider_id": preferred_provider,
                "preferred_llm_model_id": preferred_model}
        result = call("/ai/profile", "PATCH", body)
        if result is not None:
            st.success("Đã lưu cấu hình trợ lý.")


def personal_keys():
    providers = rows(call("/ai/providers"))
    keys = call("/api-keys")
    if keys is not None:
        table(keys)
    options = {f"{p.get('name')} ({p.get('code')})": str(p.get("id")) for p in providers if p.get("is_enabled")}
    if options:
        with st.form("add_personal_key", clear_on_submit=True):
            provider = st.selectbox("Provider", list(options))
            label = st.text_input("Nhãn khóa")
            secret = st.text_input("API key", type="password")
            save = st.form_submit_button("Lưu khóa vào Backend")
        if save:
            result = call("/api-keys", "POST", {"provider_id": options[provider], "label": label.strip(), "secret": secret})
            if result is not None:
                st.success("Backend đã lưu khóa; giao diện chỉ nhận phần gợi ý, không giữ hoặc hiển thị lại khóa.")
                st.rerun()
    if keys is not None:
        for key in rows(keys):
            if st.button(f"Thu hồi khóa {key.get('label', key.get('id'))}", key=f"revoke_key_{key.get('id')}"):
                result = call(f"/api-keys/{key.get('id')}", "DELETE")
                if result is not None:
                    st.success("Đã thu hồi khóa.")
                    st.rerun()


def history_page():
    result = call("/conversations", query={"page": 1, "limit": 100})
    if result is None:
        return
    conversations = rows(result)
    table(result)
    if conversations:
        choices = {f"{c.get('title') or 'Không tiêu đề'} · {c.get('started_at', '')} · ID {c.get('id')}": c for c in conversations}
        selected = st.selectbox("Mở hội thoại", list(choices))
        if selected:
            conversation = choices[selected]
            detail = call(f"/conversations/{conversation['id']}")
            if detail is not None:
                for message in detail.get("messages", []):
                    with st.chat_message("assistant" if message.get("role") == "assistant" else "user"):
                        st.write(message.get("content") or "")
                if st.button("Xóa hội thoại", key=f"delete_chat_{conversation['id']}"):
                    deleted = call(f"/conversations/{conversation['id']}", "DELETE")
                    if deleted is not None:
                        st.success("Đã xóa hội thoại.")
                        st.rerun()


def chat_page():
    st.subheader("AI Chat")
    st.warning("Chat AI đang tắt: Backend chưa có đường gọi provider thật cùng quota/admission và usage settlement sẵn sàng.")
    st.caption("Có thể xem hội thoại đã lưu ở mục Lịch sử. Backend trả 503 cho yêu cầu chat cho đến khi pipeline thật sẵn sàng.")


def privacy_page():
    privacy = call("/users/me/privacy")
    if privacy is None:
        return
    current = bool(field(privacy, "save_history", False))
    with st.form("privacy_setting"):
        save_history = st.toggle("Cho phép lưu lịch sử hội thoại", value=current)
        submit = st.form_submit_button("Lưu quyền riêng tư")
    if submit:
        result = call("/users/me/privacy", "PATCH", {"save_history": save_history})
        if result is not None:
            st.success("Đã cập nhật quyền riêng tư.")


def account_page(account):
    profile = call("/users/me")
    if profile is None:
        return
    st.write(f"Email: {profile.get('email', '')} · Vai trò: {profile.get('role', account.get('role', ''))}")
    with st.form("update_profile"):
        name = st.text_input("Tên hiển thị", value=field(profile, "display_name"))
        save = st.form_submit_button("Cập nhật hồ sơ")
    if save:
        result = call("/users/me", "PATCH", {"display_name": name.strip()})
        if result is not None:
            st.success("Đã cập nhật hồ sơ.")
    st.subheader("Đổi mật khẩu")
    with st.form("change_password"):
        current = st.text_input("Mật khẩu hiện tại", type="password")
        new = st.text_input("Mật khẩu mới", type="password")
        repeat = st.text_input("Nhập lại mật khẩu mới", type="password")
        change = st.form_submit_button("Đổi mật khẩu")
    if change:
        if new != repeat:
            st.error("Hai mật khẩu mới không khớp.")
        else:
            result = call("/auth/password", "PATCH", {"current_password": current, "new_password": new})
            if result is not None:
                st.success("Đã đổi mật khẩu. Đăng nhập lại bằng mật khẩu mới.")
                clear_auth()
                st.rerun()


def users_admin():
    search = st.text_input("Tìm người dùng")
    result = call("/users", query={"page": 1, "limit": 100, "search": search} if search else {"page": 1, "limit": 100})
    if result is None:
        return
    table(result)
    for user in rows(result):
        uid = str(user.get("id", ""))
        with st.expander(f"{user.get('display_name', '')} · {user.get('email', '')}"):
            role = st.selectbox("Vai trò", ["USER", "ADMIN"], index=1 if user.get("role") == "ADMIN" else 0, key=f"role_{uid}")
            if st.button("Lưu vai trò", key=f"save_role_{uid}"):
                saved = call(f"/users/{uid}/role", "PATCH", {"role": role})
                if saved is not None:
                    st.success("Đã cập nhật vai trò.")
                    st.rerun()
            status_options = ["active", "suspended", "disabled"]
            current_status = user.get("status", "active")
            status = st.selectbox("Trạng thái tài khoản", status_options,
                                  index=status_options.index(current_status) if current_status in status_options else 0,
                                  key=f"status_{uid}")
            if st.button("Lưu trạng thái", key=f"save_status_{uid}"):
                saved = call(f"/users/{uid}/status", "PATCH", {"status": status})
                if saved is not None:
                    st.success("Đã cập nhật trạng thái tài khoản.")
                    st.rerun()


def devices_admin():
    devices = call("/devices/admin/all", query={"page": 1, "limit": 100})
    if devices is not None:
        st.subheader("Thiết bị đã đăng ký")
        table(devices)
        for device in rows(devices):
            ident = str(device.get("id", ""))
            with st.expander(f"Thiết bị {device.get('device_uid', ident)}"):
                st.json(device)
                ttl = st.number_input("Pairing code hết hạn (phút)", 1, 60, 10, key=f"ttl_{ident}")
                if st.button("Tạo pairing code", key=f"paircode_{ident}"):
                    code = call(f"/devices/admin/{ident}/pairing-codes", "POST", {"ttl_minutes": int(ttl)})
                    if code is not None:
                        st.warning("Mã chỉ hiển thị theo phản hồi một lần từ Backend. Hãy chuyển mã an toàn cho người dùng.")
                        st.code(json.dumps(code, ensure_ascii=False))
    with st.form("register_device"):
        st.subheader("Đăng ký thiết bị vật lý")
        device_uid = st.text_input("Device UID")
        display_name = st.text_input("Tên thiết bị")
        hardware = st.text_input("Hardware model")
        submit = st.form_submit_button("Đăng ký thiết bị")
    if submit:
        result = call("/devices/admin", "POST", {"device_uid": device_uid.strip(), "display_name": display_name.strip() or None, "hardware_model": hardware.strip() or None})
        if result is not None:
            st.success("Đã đăng ký thiết bị.")
            st.json(result)
    requests = call("/devices/admin/pairing-requests", query={"page": 1, "limit": 100})
    if requests is not None:
        st.subheader("Yêu cầu ghép nối")
        table(requests)
        for request in rows(requests):
            rid = str(request.get("id", ""))
            st.caption(f"Yêu cầu {rid} · trạng thái {request.get('status', '—')}")
            if request.get("status") == "pending":
                note = st.text_input("Ghi chú xử lý", key=f"note_{rid}")
                left, right = st.columns(2)
                if left.button("Duyệt", key=f"approve_{rid}"):
                    if call(f"/devices/admin/pairing-requests/{rid}/approve", "POST", {"note": note}) is not None:
                        st.success("Đã duyệt yêu cầu.")
                        st.rerun()
                if right.button("Từ chối", key=f"reject_{rid}"):
                    if call(f"/devices/admin/pairing-requests/{rid}/reject", "POST", {"note": note}) is not None:
                        st.success("Đã từ chối yêu cầu.")
                        st.rerun()


def ai_admin():
    providers = call("/ai/providers")
    if providers is None:
        return
    table(providers)
    for provider in rows(providers):
        ident = str(provider.get("id", ""))
        enabled = st.toggle(f"{provider.get('name')} hoạt động", value=bool(provider.get("is_enabled")), key=f"provider_{ident}")
        if enabled != bool(provider.get("is_enabled")) and st.button("Lưu trạng thái provider", key=f"provider_save_{ident}"):
            result = call(f"/admin/ai/providers/{ident}", "PATCH", {"is_enabled": enabled})
            if result is not None:
                st.success("Đã cập nhật provider.")
                st.rerun()


def quota_admin(is_admin):
    result = call("/admin/quotas" if is_admin else "/quotas")
    if result is not None:
        table(result)
    if is_admin:
        st.caption("Quản lý system API key chưa có endpoint live được đăng ký trong Backend.")
    st.info("Bảng admission quota và usage chưa sẵn sàng trên schema hiện tại. Màn hình chỉ đọc chính sách Backend trả về; không tạo số liệu hay chính sách thay thế.")


def firmware_admin():
    result = call("/admin/firmware")
    if result is not None:
        table(result)
    with st.form("firmware_metadata"):
        hardware = st.text_input("Hardware model")
        version = st.text_input("Version")
        file_uri = st.text_input("File URI")
        checksum = st.text_input("SHA-256 checksum")
        create = st.form_submit_button("Lưu metadata firmware")
    if create:
        saved = call("/admin/firmware", "POST", {"hardware_model": hardware.strip(), "version": version.strip(), "file_uri": file_uri.strip(), "checksum_sha256": checksum.strip()})
        if saved is not None:
            st.success("Đã lưu metadata firmware.")
            st.json(saved)
    if result is not None:
        for fw in rows(result):
            if not fw.get("released_at") and st.button(f"Phát hành {fw.get('version')} · {fw.get('hardware_model')}", key=f"release_{fw.get('id')}"):
                if call(f"/admin/firmware/{fw.get('id')}/release", "POST") is not None:
                    st.success("Đã phát hành firmware metadata.")
                    st.rerun()


def monitoring_admin():
    logs = call("/admin/logs", query={"page": 1, "limit": 100})
    audits = call("/admin/audit-logs", query={"page": 1, "limit": 100})
    instances = call("/admin/monitoring/instances")
    for title, value in (("System logs", logs), ("Audit logs", audits), ("AI Server instances", instances)):
        st.subheader(title)
        if value is not None:
            table(value)


def system_settings():
    settings = call("/admin/system-settings")
    if settings is not None:
        table(settings)
    with st.form("system_setting"):
        key = st.text_input("Setting key")
        value = st.text_area("JSON value", value="{}")
        save = st.form_submit_button("Lưu setting")
    if save:
        try:
            parsed = json.loads(value)
        except ValueError:
            st.error("Giá trị phải là JSON hợp lệ.")
        else:
            if call(f"/admin/system-settings/{quote(key.strip(), safe='')}", "PUT", {"value": parsed}) is not None:
                st.success("Đã lưu setting.")
                st.rerun()


def render_page(page, account):
    renderers = {
        "Tổng quan": lambda: dashboard_admin() if account.get("role") == "ADMIN" else dashboard_user(account),
        "AI Chat": chat_page,
        "Robot của tôi": user_devices,
        "Trợ lý AI": assistant_settings,
        "API Key cá nhân": personal_keys,
        "Lịch sử hội thoại": history_page,
        "Quyền riêng tư": privacy_page,
        "Tài khoản": lambda: account_page(account),
        "Quản lý người dùng": users_admin,
        "Quản lý thiết bị": devices_admin,
        "AI Management": ai_admin,
        "API Key & Quota": lambda: quota_admin(True),
        "OTA Firmware": firmware_admin,
        "Logs & Monitoring": monitoring_admin,
        "System Settings": system_settings,
    }
    renderers[page]()
