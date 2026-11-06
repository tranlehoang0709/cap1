"""AIVA-IoT Streamlit client backed by the live Backend API."""
import json
from html import escape
from thanh_phan.dung_chung.khung_noi_dung import panel
from thanh_phan.robot.khung_hien_thi import render_robot_scene
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


def table(value, *, hide_index=True, key=None, filters=()):
    from thanh_phan.dung_chung.bang_du_lieu import table as data_table
    index = st.session_state.get("api_table_index", 0)
    st.session_state.api_table_index = index + 1
    context = st.session_state.get("ui_active_page", "page")
    key = key or "api_" + context + "_" + str(index)
    return data_table(rows(value), key, filters=filters, page_only=True)



def field(value, key, default=""):
    return value.get(key, default) if isinstance(value, dict) else default


def login_screen():
    """Baseline split layout around the existing Backend authentication forms."""
    from thanh_phan.robot.khung_hien_thi import render_robot_scene
    left, right = st.columns([1.25, 1], gap="large")
    with left, st.container(border=True, key="login_brand_panel"):
        st.markdown('<h2 class="login-heading">Robot và trợ lý AI,<br>trong một không gian.</h2><p class="login-copy">Theo dõi Xiaozhi, tùy chỉnh trợ lý và quản lý hội thoại của bạn.</p>', unsafe_allow_html=True)
        render_robot_scene(hero=True)
        st.caption("Xiaozhi 3D là hình minh họa tương tác, không phải thiết bị đang kết nối.")
    with right, st.container(border=True, key="login_form_panel"):
        _login_forms()


def _login_forms():
    st.title("Chào mừng đến AIVA-IoT")
    st.caption("Đăng nhập bằng tài khoản được lưu trong Backend.")
    warning = st.session_state.pop("logout_warning", None)
    if warning:
        st.warning(warning)
    from nen_tang.email_verification import receive_verification_link
    receive_verification_link()
    login_tab, register_tab, verify_tab = st.tabs(["Đăng nhập", "Đăng ký User", "Xác minh email"],
        key="backend_auth_tabs", on_change="rerun")
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
        with st.expander("Quên mật khẩu"):
            st.info("Luồng khôi phục mật khẩu chưa có API được thống nhất; chức năng này chưa được kích hoạt.")
    with register_tab:
        with st.form("backend_register"):
            display_name = st.text_input("Họ tên")
            reg_email = st.text_input("Email đăng ký", autocomplete="email")
            reg_password = st.text_input("Mật khẩu đăng ký", type="password", autocomplete="new-password")
            repeat = st.text_input("Nhập lại mật khẩu", type="password", autocomplete="new-password")
            submit_register = st.form_submit_button("Tạo tài khoản")
        if submit_register:
            if reg_password != repeat:
                st.error("Hai mật khẩu đăng ký không khớp.")
            else:
                try:
                    api("/auth/register", "POST", {"email": reg_email.strip(), "display_name": display_name.strip(), "password": reg_password}, auth=False)
                    st.info("Đã đăng ký. Tài khoản cần xác minh email trước khi đăng nhập; hãy dùng mã được cấp qua kênh xác minh của hệ thống.")
                except BackendError as error:
                    api_error(error)

    with verify_tab:
        st.caption("Dùng mã xác minh của hệ thống. Trang không tự xác minh hoặc bỏ qua kiểm tra email.")
        if st.session_state.get("verification_link_received"):
            st.info("Đã nhận mã từ liên kết và xóa fragment khỏi URL. Hãy bấm Xác minh email để tiếp tục.")
        with st.form("backend_verify_email", clear_on_submit=True):
            verification_token = st.text_input("Mã xác minh email", type="password", key="email_verification_token")
            verify = st.form_submit_button("Xác minh email")
        if verify:
            try:
                api("/auth/verify-email", "POST", {"token": verification_token.strip()}, auth=False)
                st.session_state.pop("verification_link_received", None)
                st.success("Email đã được xác minh. Bạn có thể đăng nhập.")
            except BackendError as error:
                if error.status == 400:
                    st.warning("Mã xác minh không hợp lệ hoặc đã hết hạn. Hãy yêu cầu gửi lại mã.")
                else:
                    api_error(error)
        with st.form("backend_resend_verification"):
            resend_email = st.text_input("Email cần xác minh", autocomplete="email")
            resend = st.form_submit_button("Gửi lại hướng dẫn xác minh")
        if resend:
            try:
                result = api("/auth/resend-verification", "POST", {"email": resend_email.strip()}, auth=False)
                st.info(result.get("message", "Nếu tài khoản đủ điều kiện, hướng dẫn xác minh sẽ được gửi."))
            except BackendError as error:
                if error.status == 503:
                    st.warning("Kênh gửi xác minh chưa sẵn sàng. Development cần console cục bộ được bật; production cần email provider.")
                elif error.status == 429:
                    st.warning("Đã đạt giới hạn gửi lại. Hãy chờ rồi thử lại.")
                else:
                    api_error(error)


def collection(path, *, query=None, max_pages=100):
    """Read a complete paginated collection before local filters/counts.

    No partial page is ever presented as the full collection.
    """
    combined, expected, identifiers = [], None, set()
    try:
        for page in range(1, max_pages + 1):
            value = api(path, query={**(query or {}), "page": page, "limit": 100})
            if isinstance(value, list):
                if page != 1:
                    raise BackendError(0, "Phản hồi phân trang không hợp lệ.")
                return value
            if not isinstance(value, dict):
                raise BackendError(0, "Backend không trả danh sách hợp lệ.")
            batch, total = value.get("items"), value.get("total")
            if (not isinstance(batch, list) or type(total) is not int or total < 0
                    or len(batch) > 100 or value.get("page", page) != page
                    or value.get("limit", 100) != 100):
                raise BackendError(0, "Phản hồi phân trang không hợp lệ.")
            if expected is not None and total != expected:
                raise BackendError(409, "Danh sách vừa thay đổi. Hãy tải lại trước khi thao tác.")
            expected = total
            for row in batch:
                if not isinstance(row, dict):
                    raise BackendError(0, "Bản ghi Backend không hợp lệ.")
                if row.get("id") is not None:
                    ident = str(row["id"])
                    if ident in identifiers:
                        raise BackendError(409, "Danh sách vừa thay đổi. Hãy tải lại.")
                    identifiers.add(ident)
            combined.extend(batch)
            if len(combined) > total:
                raise BackendError(0, "Tổng số bản ghi không hợp lệ.")
            if len(combined) == total:
                return {"items": combined, "total": total}
            if not batch:
                raise BackendError(0, "Backend chưa trả đủ danh sách. Hãy tải lại.")
        raise BackendError(0, "Danh sách quá lớn để lọc tại giao diện; cần API tìm kiếm tương ứng.")
    except BackendError as error:
        api_error(error)
        return None


def navigate(page):
    st.session_state.navigate_to = page
    st.rerun()


def usage_panel():
    """Display actual per-provider aggregates from the existing /usage API."""
    from datetime import date, timedelta
    today = date.today()
    catalogue = rows(call("/ai/providers"))
    provider_labels = {str(item["id"]): str(item.get("name") or item.get("code") or item["id"]) for item in catalogue}
    with st.form("usage_summary"):
        selected_providers = st.multiselect("Provider thống kê", list(provider_labels), default=list(provider_labels),
                                            format_func=provider_labels.get, disabled=not provider_labels)
        left, right = st.columns(2)
        with left:
            start = st.date_input("Từ ngày", value=today.replace(day=1))
        with right:
            end = st.date_input("Đến ngày", value=today)
        load = st.form_submit_button("Tải thống kê")
    if not load:
        st.caption("Chọn khoảng ngày để tải số liệu sử dụng từ Backend.")
        return
    if start > end:
        st.error("Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.")
        return
    result = call("/usage", query={"from": start.isoformat() + "T00:00:00Z",
                                  "to": (end + timedelta(days=1)).isoformat() + "T00:00:00Z"})
    if result is None:
        return
    records = rows(result)
    if not records:
        st.info("Backend chưa có dữ liệu sử dụng trong khoảng ngày đã chọn.")
        return
    if provider_labels:
        records = [record for record in records if str(record.get("provider_id")) in selected_providers]
        if not records:
            st.info("Không có dữ liệu phù hợp với provider đã chọn.")
            return
    frame = pd.DataFrame(records)
    try:
        for column in ("requests", "input_tokens", "output_tokens"):
            frame[column] = pd.to_numeric(frame[column], errors="raise")
            if frame[column].isna().any() or (frame[column] < 0).any():
                raise ValueError()
        if "provider_id" not in frame or frame["provider_id"].isna().any():
            raise ValueError()
    except (ValueError, TypeError, KeyError):
        st.error("Backend chưa trả số liệu sử dụng hợp lệ.")
        return
    from thanh_phan.dung_chung.bang_du_lieu import render_frame
    render_frame(frame, hide_index=True, width="stretch")
    import plotly.express as px
    figure = px.bar(frame, x="provider_id", y=["input_tokens", "output_tokens"], barmode="stack",
                    labels={"provider_id": "Provider", "value": "Tokens", "variable": "Loại token"},
                    template="plotly_white" if st.session_state.get("appearance") == "☀️ Sáng" else "plotly_dark")
    figure.update_layout(paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
                         margin=dict(l=10,r=10,t=15,b=10))
    st.plotly_chart(figure, width="stretch")



def dashboard_user(account):
    profile = call("/ai/profile")
    devices = collection("/devices")
    conversations = call("/conversations", query={"page": 1, "limit": 1})
    quotas = call("/quotas")
    with st.container(key="dashboard_hero"):
        intro, mascot = st.columns([2.1, 1], gap="large")
        with intro:
            st.subheader(f"Chào mừng trở lại, {field(account, 'display_name', field(account, 'email'))}")
            st.caption("Theo dõi Xiaozhi, tùy chỉnh trợ lý và tiếp tục những cuộc trò chuyện của bạn.")
        with mascot:
            render_robot_scene()
            st.caption("Xiaozhi 3D minh họa")
    with st.container(key="dashboard_metrics"):
        cols = st.columns(4)
        cols[0].metric("Robot đã ghép", field(devices, "total", "Chưa có dữ liệu"))
        cols[1].metric("Hội thoại đã lưu", field(conversations, "total", "Chưa có dữ liệu"))
        cols[2].metric("Chính sách quota", len(rows(quotas)) if quotas is not None else "Chưa có dữ liệu")
        cols[3].metric("Tên trợ lý", field(profile, "assistant_name") or "Chưa cấu hình")
    left, right = st.columns([2, 1])
    with left, panel():
        st.subheader("Thiết bị của tôi")
        if devices is not None:
            robots = rows(devices)
            if not robots:
                st.info("Bạn chưa có robot được duyệt. Mở Robot của tôi để gửi yêu cầu ghép nối.")
            for robot in robots[:4]:
                status = str(robot.get("connection_status", "unknown"))
                online = status == "online"
                label = {"online": "Trực tuyến", "offline": "Ngoại tuyến"}.get(status, "Chưa có trạng thái")
                st.markdown(f'<div class="provider-row"><div><strong>{escape(str(robot.get("display_name") or robot.get("device_uid") or ""))}</strong><small>{escape(str(robot.get("device_uid") or ""))}</small></div><span class="status {"online" if online else "offline"}">{label}</span></div>', unsafe_allow_html=True)
            if st.button("Xem tất cả →"):
                navigate("Robot của tôi")
        else:
            st.info("Chưa tải được danh sách thiết bị. Không có số liệu thay thế.")
    with right, panel():
        st.subheader("Trợ lý AI")
        if profile is not None:
            st.write(profile.get("assistant_name") or "Chưa đặt tên trợ lý")
            st.caption("Provider và model theo cấu hình đã lưu.")
            if st.button("Mở AI Chat", type="primary", width="stretch"):
                navigate("AI Chat")
            if st.button("Cài đặt trợ lý", width="stretch"):
                navigate("Trợ lý AI")
    with st.expander("Thống kê sử dụng"):
        usage_panel()



def dashboard_admin():
    summary = call("/admin/dashboard")
    if summary is not None:
        with st.container(key="dashboard_metrics"):
            cols = st.columns(5)
            for col, (key, label) in zip(cols, (("users", "Người dùng"), ("devices", "Thiết bị"),
                    ("assigned_devices", "Đã ghép"), ("online_devices", "Đang online"),
                    ("conversations", "Hội thoại"))):
                col.metric(label, summary.get(key, "Chưa có dữ liệu"))
        st.caption(f"Cập nhật: {summary.get('generated_at') or 'Chưa có dữ liệu'}")
    left, right = st.columns([1.4, 1], gap="large")
    with left, panel():
        st.subheader("AI Server instances")
        instances = call("/admin/monitoring/instances")
        if instances is not None:
            table(instances, key="dashboard_instances")
    with right, panel():
        st.subheader("Điều hành hệ thống")
        st.caption("Danh sách, cảnh báo và thao tác quản trị lấy từ Backend.")
        if st.button("Quản lý thiết bị", width="stretch"):
            navigate("Quản lý thiết bị")
        if st.button("Logs & Monitoring", width="stretch"):
            navigate("Logs & Monitoring")
        st.info("Biểu đồ tài nguyên cần dữ liệu time-series từ API; không hiển thị số liệu mẫu.")



def user_devices():
    devices = collection("/devices")
    if devices is not None:
        st.subheader("Robot đã ghép")
        robot_rows = rows(devices)
        if not robot_rows:
            st.info("Bạn chưa có robot được duyệt. Gửi mã ghép nối ở bên dưới để bắt đầu.")
        else:
            st.toggle("Tạm dừng chuyển động robot", key="aiva_pause_robot")
        pages = max(1, (len(robot_rows) + 3) // 4)
        page_key = "device_card_page_" + str(st.session_state.account["id"])
        st.session_state[page_key] = min(max(1, st.session_state.get(page_key, 1)), pages)
        page = st.number_input("Trang robot", min_value=1, max_value=pages,
                               key=page_key, disabled=pages == 1)
        st.caption(f"{len(robot_rows)} robot từ Backend · Trang {page}/{pages}")
        device_columns = st.columns(2, gap="large")
        for index, device in enumerate(robot_rows[(page-1)*4:page*4]):
            with device_columns[index % 2], panel():
                st.subheader(device.get("display_name") or device.get("device_uid") or "Robot")
                status = str(device.get("connection_status", "unknown"))
                label = {"online": "Trực tuyến", "offline": "Ngoại tuyến"}.get(status, "Chưa có trạng thái")
                st.markdown(f'<span class="status {"online" if status == "online" else "offline"}">{label}</span>', unsafe_allow_html=True)
                render_robot_scene(online=status == "online", show_expressions=True)
                st.caption("Biểu cảm 3D minh họa. Trạng thái kết nối do Backend ghi nhận.")
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
                        from thanh_phan.bieu_mau.xac_nhan import confirm_action
                        confirm_action("unlink_device_" + ident, "Hủy liên kết robot đã chọn khỏi tài khoản?",
                                       lambda: call(f"/devices/{ident}/assignment", "DELETE"))
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
    requests = collection("/devices/pairing-requests/mine")
    if requests is not None:
        st.subheader("Yêu cầu của bạn")
        table(requests)




def assistant_settings():
    profile = call("/ai/profile")
    providers = call("/ai/providers")
    if profile is None:
        return
    uid = str(st.session_state.account["id"])
    st.caption("Cấu hình được lưu cho tài khoản đang đăng nhập.")
    personal, advanced = st.tabs(["Cá nhân hóa", "Nâng cao"])
    with personal, panel():
        st.subheader("Trợ lý của bạn")
        info, language_tab, voice_tab = st.tabs(["Thông tin", "Ngôn ngữ", "Giọng nói"])
        with info:
            name = st.text_input("Tên trợ lý", value=profile.get("assistant_name") or "", max_chars=100)
        with language_tab:
            language = st.text_input("Mã ngôn ngữ", value=profile.get("language_code") or "", max_chars=20)
        with voice_tab:
            voice = st.text_input("Mã giọng nói", value=profile.get("voice_code") or "", max_chars=100)
            st.caption("Giọng nói phụ thuộc provider/model được Backend cho phép.")
    with advanced, panel():
        st.subheader("Dịch vụ AI")
        provider_rows = rows(providers)
        options = {"": "Không chọn"}
        for item in provider_rows:
            if item.get("is_enabled") or item.get("id") == profile.get("preferred_provider_id"):
                options[item["id"]] = str(item.get("name") or item.get("code") or item["id"]) + (
                    " (đang tắt)" if not item.get("is_enabled") else "")
        current = profile.get("preferred_provider_id")
        if current and current not in options:
            options[current] = "Provider đã lưu (chưa tải được thông tin)"
        selected_provider = st.selectbox("Provider ưu tiên", list(options),
                                  index=list(options).index(current or "") if (current or "") in options else 0,
                                  format_func=options.get, key="profile_provider_" + uid)
        provider_id = selected_provider or None
        model_options = {"": "Không chọn model"}
        models_ready = True
        if provider_id:
            models = call(f"/ai/providers/{provider_id}/models")
            models_ready = models is not None
            for model in rows(models):
                if model.get("is_enabled") and str(model.get("capability", "")).upper() == "LLM":
                    model_options[model["id"]] = str(model.get("model_code") or model["id"])
        saved_model = profile.get("preferred_llm_model_id") if provider_id == current else None
        if saved_model and saved_model not in model_options:
            model_options[saved_model] = "Model đã lưu (hiện không khả dụng)"
        model_id = st.selectbox("Model LLM", list(model_options),
                                index=list(model_options).index(saved_model or "") if (saved_model or "") in model_options else 0,
                                format_func=model_options.get, key="profile_model_" + uid + "_" + str(provider_id),
                                disabled=provider_id is None)
        prompt = st.text_area("System prompt", value=profile.get("system_prompt") or "", height=180, max_chars=8000)
        st.caption("Khóa kết nối được quản lý riêng tại API Key cá nhân.")
    if st.button("Lưu cấu hình", type="primary"):
        effective = {"assistant_name": name.strip() or None, "language_code": language.strip() or None,
                     "voice_code": voice.strip() or None, "system_prompt": prompt or None,
                     "preferred_provider_id": provider_id,
                     "preferred_llm_model_id": (model_id or None) if provider_id else None}
        if provider_id and not models_ready:
            st.error("Không tải được danh sách model. Cấu hình cũ được giữ nguyên.")
        elif provider_id and not model_id:
            st.error("Phải chọn model LLM khi đã chọn provider.")
        elif False:
            st.info("Không có thay đổi cần lưu.")
        elif call("/ai/profile", "PATCH", effective) is not None:
            verified = call("/ai/profile")
            if (isinstance(verified, dict)
                and str(verified.get("preferred_provider_id")) == str(provider_id)
                and str(verified.get("preferred_llm_model_id")) == str(model_id)):
                st.success("Đã lưu cấu hình trợ lý.")
            else:
                st.error("Backend không xác nhận provider/model sau khi lưu; chưa thể dùng robot.")



def personal_keys():
    from thanh_phan.dung_chung.bang_du_lieu import table as data_table
    from thanh_phan.bieu_mau.xac_nhan import confirm_action
    providers = rows(call("/ai/providers"))
    keys = call("/api-keys")
    left, right = st.columns([1.5, 1], gap="large")
    with left, panel():
        st.subheader("Khóa kết nối của bạn")
        if keys is not None:
            metadata = [{k: row.get(k) for k in ("id", "label", "provider_id", "secret_hint", "is_active", "created_at")}
                        for row in rows(keys)]
            shown = data_table(metadata, "personal_keys_api", filters=("is_active",))
            for key in shown:
                if key.get("is_active") is not False and st.button(f"Thu hồi khóa {key.get('label') or key['id']}", key="revoke_key_" + key["id"]):
                    ident = key["id"]
                    confirm_action("revoke_personal_" + ident, "Thu hồi khóa kết nối đã chọn?",
                                   lambda: call(f"/api-keys/{ident}", "DELETE"))
    with right, panel():
        options = {str(p["id"]): str(p.get("name") or p.get("code")) for p in providers if p.get("is_enabled")}
        if not options:
            st.info("Chưa có provider đang hoạt động để thêm khóa.")
            return
        with st.form("add_personal_key", clear_on_submit=True):
            provider = st.selectbox("Provider", list(options), format_func=options.get)
            label = st.text_input("Nhãn khóa", max_chars=100)
            secret = st.text_input("API key", type="password")
            save = st.form_submit_button("Lưu khóa vào Backend")
        if save:
            result = call("/api-keys", "POST", {"provider_id": provider, "label": label.strip(), "secret": secret})
            if result is not None:
                st.session_state.ui_notice = "Đã lưu khóa. Chỉ phần gợi ý được hiển thị lại."
                st.rerun()



def history_page():
    result = collection("/conversations")
    if result is None:
        return
    from thanh_phan.dung_chung.bang_du_lieu import table as data_table
    from thanh_phan.bieu_mau.xac_nhan import confirm_action
    archive, memory_tab, knowledge_tab = st.tabs(["Lịch sử hội thoại", "Bộ nhớ dài hạn", "Tài liệu cá nhân"])
    with memory_tab:
        st.info("Bộ nhớ dài hạn chưa có API được thống nhất. Chưa thể xem, sửa hoặc xóa bộ nhớ thật.")
    with knowledge_tab:
        st.info("Tài liệu cá nhân chưa có API được thống nhất. Không upload hoặc tạo tài liệu giả.")
    with archive, st.container(key="history_selected"), panel():
        st.subheader("Hội thoại đã lưu")
        records = data_table(rows(result), "history_api", filters=("status", "channel"))
        if not records:
            return
        choices = {str(c["id"]): c for c in records}
        selected = st.selectbox("Mở hội thoại", list(choices),
            format_func=lambda ident: str(choices[ident].get("title") or "Không tiêu đề") + " · " + ident)
        if selected:
            detail = call(f"/conversations/{selected}")
            if detail is not None:
                if (detail.get("id") != selected or detail.get("user_id") != st.session_state.account["id"]
                        or not isinstance(detail.get("messages"), list)):
                    st.error("Không thể hiển thị hội thoại không thuộc tài khoản hiện tại.")
                    return
                for message in detail["messages"]:
                    if message.get("role") in ("assistant", "user") and isinstance(message.get("content"), str):
                        with st.chat_message(message["role"]):
                            st.write(message["content"])
                if st.button("Xóa hội thoại", key="delete_chat_" + selected):
                    confirm_action("delete_chat_" + selected, "Xóa hội thoại đã chọn khỏi lịch sử của bạn?",
                                   lambda: call(f"/conversations/{selected}", "DELETE"))



def chat_page():
    st.subheader("AI Chat")
    st.warning("Chat AI đang tắt: Backend chưa có đường gọi provider thật cùng quota/admission và usage settlement sẵn sàng.")
    st.caption("Có thể xem hội thoại đã lưu ở mục Lịch sử. Backend trả 503 cho yêu cầu chat cho đến khi pipeline thật sẵn sàng.")


def privacy_page():
    from thanh_phan.bieu_mau.xac_nhan import confirm_action
    privacy = call("/users/me/privacy")
    if privacy is None:
        return
    storage, manage = st.tabs(["Lưu trữ", "Quản lý dữ liệu"])
    with storage, panel():
        current = privacy.get("save_history")
        if type(current) is not bool:
            st.error("Backend chưa trả thiết lập lưu trữ hợp lệ.")
            return
        st.subheader("Lịch sử hội thoại")
        st.caption("Thiết lập áp dụng cho việc lưu hội thoại mới. Xóa hội thoại đã lưu được thực hiện riêng.")
        with st.form("privacy_setting"):
            save_history = st.toggle("Cho phép lưu lịch sử hội thoại", value=current)
            submit = st.form_submit_button("Lưu quyền riêng tư")
        if submit:
            if save_history == current:
                st.info("Không có thay đổi cần lưu.")
            else:
                confirm_action("privacy_history_" + str(st.session_state.account["id"]),
                    "Bật lưu lịch sử hội thoại mới?" if save_history else "Tắt lưu nội dung hội thoại mới?",
                    lambda: call("/users/me/privacy", "PATCH", {"save_history": save_history}))
    with manage, panel():
        st.subheader("Dữ liệu của bạn")
        if st.button("Quản lý lịch sử hội thoại"):
            navigate("Lịch sử hội thoại")
        st.info("Chưa có API xóa hàng loạt dữ liệu AI, bộ nhớ dài hạn hoặc tài liệu cá nhân. Các thao tác này chưa được kích hoạt.")



def account_page(account):
    profile = call("/users/me")
    if profile is None:
        return
    st.write(f"Email: {profile.get('email', '')} · Vai trò: {profile.get('role', account.get('role', ''))}")
    with panel(), st.form("update_profile"):
        name = st.text_input("Tên hiển thị", value=field(profile, "display_name"))
        save = st.form_submit_button("Cập nhật hồ sơ")
    if save:
        result = call("/users/me", "PATCH", {"display_name": name.strip()})
        if result is not None:
            st.success("Đã cập nhật hồ sơ.")
    st.subheader("Đổi mật khẩu")
    with panel(), st.form("change_password"):
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
    from thanh_phan.bieu_mau.xac_nhan import confirm_action
    with panel():
        search = st.text_input("Tìm người dùng")
        result = collection("/users", query={"search": search} if search else None)
        if result is None:
            return
        selected_rows = table(result, key="users_api", filters=("role", "status"))
    for user in selected_rows:
        uid = str(user["id"])
        with st.expander(f"{user.get('display_name', '')} · {user.get('email', '')}"):
            role = st.selectbox("Vai trò", ["USER", "ADMIN"],
                               index=1 if user.get("role") == "ADMIN" else 0, key=f"role_{uid}")
            if st.button("Lưu vai trò", key=f"save_role_{uid}"):
                confirm_action("user_role_" + uid, f"Thay đổi vai trò tài khoản ID {uid}?",
                    lambda uid=uid, role=role: call(f"/users/{uid}/role", "PATCH", {"role": role}))
            statuses = ["active", "suspended", "disabled"]
            status = st.selectbox("Trạng thái tài khoản", statuses,
                index=statuses.index(user["status"]) if user.get("status") in statuses else 0, key=f"status_{uid}")
            if st.button("Lưu trạng thái", key=f"save_status_{uid}"):
                confirm_action("user_status_" + uid, f"Thay đổi trạng thái tài khoản ID {uid}?",
                    lambda uid=uid, status=status: call(f"/users/{uid}/status", "PATCH", {"status": status}))



def devices_admin():
    devices = collection("/devices/admin/all")
    if devices is not None:
        st.subheader("Thiết bị đã đăng ký")
        shown_devices = table(devices, key="admin_devices", filters=("connection_status", "lifecycle_status"))
        for device in shown_devices:
            ident = str(device.get("id", ""))
            with st.expander(f"Thiết bị {device.get('device_uid', ident)}"):
                st.json(device)
                ttl = st.number_input("Pairing code hết hạn (phút)", 1, 60, 10, key=f"ttl_{ident}")
                if st.button("Tạo pairing code", key=f"paircode_{ident}"):
                    code = call(f"/devices/admin/{ident}/pairing-codes", "POST", {"ttl_minutes": int(ttl)})
                    if code is not None:
                        st.warning("Mã chỉ hiển thị theo phản hồi một lần từ Backend. Hãy chuyển mã an toàn cho người dùng.")
                        st.code(json.dumps(code, ensure_ascii=False))
    with panel(), st.form("register_device"):
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
    requests = collection("/devices/admin/pairing-requests")
    if requests is not None:
        st.subheader("Yêu cầu ghép nối")
        shown_requests = table(requests, key="admin_pairing_requests", filters=("status",))
        for request in shown_requests:
            rid = str(request.get("id", ""))
            st.caption(f"Yêu cầu {rid} · trạng thái {request.get('status', '—')}")
            if request.get("status") == "pending":
                note = st.text_input("Ghi chú xử lý", key=f"note_{rid}")
                left, right = st.columns(2)
                if left.button("Duyệt", key=f"approve_{rid}"):
                    from thanh_phan.bieu_mau.xac_nhan import confirm_action
                    confirm_action("approve_pair_" + rid, f"Duyệt yêu cầu ghép nối ID {rid}?",
                        lambda rid=rid, note=note: call(f"/devices/admin/pairing-requests/{rid}/approve", "POST", {"note": note}))
                if right.button("Từ chối", key=f"reject_{rid}"):
                    from thanh_phan.bieu_mau.xac_nhan import confirm_action
                    confirm_action("reject_pair_" + rid, f"Từ chối yêu cầu ghép nối ID {rid}?",
                        lambda rid=rid, note=note: call(f"/devices/admin/pairing-requests/{rid}/reject", "POST", {"note": note}))


def ai_admin():
    from thanh_phan.bieu_mau.xac_nhan import confirm_action
    providers = call("/ai/providers")
    if providers is None:
        return
    table(providers, key="providers_api", filters=("is_enabled",))
    columns = st.columns(2, gap="large")
    for index, provider in enumerate(rows(providers)):
        ident = str(provider["id"])
        with columns[index % 2], panel():
            st.subheader(provider.get("name") or provider.get("code") or ident)
            st.caption(str(provider.get("health_status") or "Chưa có trạng thái sức khỏe"))
            enabled = st.toggle("Đang bật", value=bool(provider.get("is_enabled")), key="provider_" + ident)
            if enabled != bool(provider.get("is_enabled")) and st.button("Lưu trạng thái provider", key="provider_save_" + ident):
                confirm_action("provider_" + ident, f"Thay đổi trạng thái provider {provider.get('name') or ident}?",
                    lambda ident=ident, enabled=enabled: call(f"/admin/ai/providers/{ident}", "PATCH", {"is_enabled": enabled}))
            with st.expander("Model đang được phép"):
                models = call(f"/ai/providers/{ident}/models")
                if models is not None:
                    table(models, key="provider_models_" + ident)



def quota_admin(is_admin):
    from thanh_phan.bieu_mau.xac_nhan import confirm_action
    if not is_admin:
        value = call("/quotas")
        if value is not None:
            table(value, key="user_quotas")
        return
    system, policies = st.tabs(["System API Key", "Chính sách quota"])
    with system:
        keys = call("/admin/api-keys/system")
        if keys is not None:
            safe = [{key: row.get(key) for key in ("id", "provider_id", "label", "secret_hint", "is_active", "created_at")}
                    for row in rows(keys)]
            for row in table(safe, key="system_keys", filters=("is_active",)):
                ident = str(row["id"])
                if row.get("is_active") is not False and st.button("Thu hồi " + str(row.get("label") or ident), key="revoke_system_" + ident):
                    confirm_action("system_key_" + ident, f"Thu hồi system key ID {ident}?",
                        lambda ident=ident: call(f"/admin/api-keys/system/{ident}", "DELETE"))
        providers = rows(call("/ai/providers"))
        choices = {str(p["id"]): str(p.get("name") or p.get("code")) for p in providers if p.get("is_enabled")}
        with panel():
            if choices:
                with st.form("system_key_create", clear_on_submit=True):
                    provider = st.selectbox("Provider system key", list(choices), format_func=choices.get)
                    label = st.text_input("Nhãn system key", max_chars=100)
                    secret = st.text_input("System API key", type="password")
                    create = st.form_submit_button("Lưu system key")
                if create and call("/admin/api-keys/system", "POST",
                                   {"provider_id": provider, "label": label.strip(), "secret": secret}) is not None:
                    st.session_state.ui_notice = "Đã lưu system key; chỉ hiển thị phần gợi ý."
                    st.rerun()
            else:
                st.info("Chưa có provider hoạt động.")
    with policies:
        result = call("/admin/quotas")
        if result is not None:
            for row in table(result, key="quota_policies"):
                if row.get("is_active") is not False:
                    ident = str(row["id"])
                    if st.button("Ngừng chính sách " + ident, key="quota_disable_" + ident):
                        confirm_action("quota_disable_" + ident, f"Ngừng chính sách quota ID {ident}?",
                            lambda ident=ident: call(f"/admin/quotas/{ident}", "DELETE"))
        st.info("Chính sách được lưu qua API hiện có. Điều này không xác nhận admission/usage đã sẵn sàng trên V1.5.")
        with panel(), st.form("quota_create"):
            st.subheader("Tạo chính sách")
            user_id = st.text_input("User ID (để trống cho toàn hệ thống)")
            provider_id = st.text_input("Provider ID (để trống cho mọi provider)")
            rpm = st.text_input("Yêu cầu / phút (để trống nếu không đặt)")
            rpd = st.text_input("Yêu cầu / ngày (để trống nếu không đặt)")
            monthly = st.text_input("Token / tháng (để trống nếu không đặt giới hạn)")
            unlimited = st.checkbox("Tôi chủ động chọn chính sách không có giới hạn nếu mọi hạn mức để trống")
            create = st.form_submit_button("Tạo chính sách quota")
        if create:
            values = [user_id.strip(), provider_id.strip(), monthly.strip(), rpm.strip(), rpd.strip()]
            if any(value and (not value.isascii() or not value.isdecimal() or not 0 < int(value) <= 9223372036854775807) for value in values):
                st.error("ID và hạn mức token phải là số nguyên dương hợp lệ.")
            elif any(value and int(value) > 2147483647 for value in (rpm.strip(), rpd.strip())):
                st.error("Hạn mức yêu cầu vượt phạm vi số nguyên được hỗ trợ.")
            elif not (rpm.strip() or rpd.strip() or monthly.strip() or unlimited):
                st.error("Chọn ít nhất một hạn mức hoặc xác nhận rõ chính sách không giới hạn.")
            else:
                body = {"user_id": user_id.strip() or None, "provider_id": provider_id.strip() or None,
                        "requests_per_minute": int(rpm) if rpm.strip() else None,
                        "requests_per_day": int(rpd) if rpd.strip() else None,
                        "tokens_per_month": monthly.strip() or None}
                confirm_action("quota_create", "Tạo chính sách quota với phạm vi và hạn mức vừa nhập?",
                               lambda body=body: call("/admin/quotas", "POST", body))



def firmware_admin():
    result = call("/admin/firmware")
    if result is not None:
        table(result)
    with panel(), st.form("firmware_metadata"):
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
                from thanh_phan.bieu_mau.xac_nhan import confirm_action
                ident = str(fw["id"])
                confirm_action("firmware_release_" + ident, f"Phát hành firmware metadata ID {ident}?",
                    lambda ident=ident: call(f"/admin/firmware/{ident}/release", "POST"))


def monitoring_admin():
    logs = collection("/admin/logs")
    audits = collection("/admin/audit-logs")
    instances = call("/admin/monitoring/instances")
    for title, value in (("System logs", logs), ("Audit logs", audits), ("AI Server instances", instances)):
        with panel():
            st.subheader(title)
            if value is not None:
                table(value, filters=("severity", "component"))


def system_settings():
    settings = call("/admin/system-settings")
    if settings is not None:
        table(settings)
    with panel(), st.form("system_setting"):
        key = st.text_input("Setting key")
        value = st.text_area("JSON value", value="{}")
        save = st.form_submit_button("Lưu setting")
    if save:
        try:
            parsed = json.loads(value)
        except ValueError:
            st.error("Giá trị phải là JSON hợp lệ.")
        else:
            from thanh_phan.bieu_mau.xac_nhan import confirm_action
            setting_path = f"/admin/system-settings/{quote(key.strip(), safe='')}"
            confirm_action("system_setting_" + key.strip(), "Cập nhật cấu hình hệ thống đã chọn?",
                lambda setting_path=setting_path, parsed=parsed: call(setting_path, "PUT", {"value": parsed}))


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
