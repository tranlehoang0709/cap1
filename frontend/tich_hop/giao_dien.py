"""API presentation using the existing portal layout and shared components."""
from html import escape
import streamlit as st
from .cau_hinh import IntegrationConfig
from .portal import PortalService
from .http_client import ApiError
from .phien_xac_thuc import AUTH_KEY
from thanh_phan.dung_chung.khung_noi_dung import panel
from thanh_phan.dung_chung.bang_du_lieu import table
from thanh_phan.robot.khung_hien_thi import render_robot_scene


def api_mode():
    return IntegrationConfig.from_env().mode == "API"


def service():
    return PortalService(st.session_state)


def clear_widgets():
    # Do not carry user-specific widgets, confirmations or navigation across identities.
    keep = {AUTH_KEY, "appearance", "aiva_pause_robot", "demo", "logout_warning"}
    for key in list(st.session_state):
        if key not in keep:
            del st.session_state[key]


def show_error(error):
    st.error(str(error))
    if error.status == 401:
        st.caption("Vui lòng đăng nhập lại. Không chuyển sang tài khoản mô phỏng.")
        if st.button("Về đăng nhập", key="api_login_again"):
            service().session.clear()
            clear_widgets()
            st.rerun()
    elif error.kind in ("connection", "timeout", "server"):
        st.caption("Nếu lỗi xảy ra sau khi gửi thao tác, hãy kiểm tra trạng thái trước khi gửi lại.")
        if st.button("Tải lại dữ liệu", key="api_reload"):
            st.rerun()


def login_forms():
    from nen_tang.kiem_tra_du_lieu import email_valid
    st.title("Chào mừng đến AIVA-IoT")
    st.caption("Quản lý robot Xiaozhi và trợ lý AI")
    warning = st.session_state.pop("logout_warning", None)
    if warning:
        st.warning(warning)
    login, register = st.tabs(["Đăng nhập", "Đăng ký User"])
    with login:
        with st.form("login", clear_on_submit=True):
            email = st.text_input("Email", autocomplete="username")
            password = st.text_input("Mật khẩu", type="password", autocomplete="current-password")
            st.checkbox("Ghi nhớ đăng nhập trong phiên", value=True)
            submitted = st.form_submit_button("Đăng nhập", type="primary", width="stretch")
        if submitted:
            try:
                service().login(email.strip(), password)
            except ApiError as error:
                st.error(str(error))
            else:
                clear_widgets()
                st.rerun()
        with st.expander("Quên mật khẩu"):
            st.info("Chưa có dữ liệu. Luồng khôi phục mật khẩu chưa được kết nối.")
    with register:
        with st.form("register", clear_on_submit=True):
            name = st.text_input("Họ tên", autocomplete="name")
            email = st.text_input("Email đăng ký", autocomplete="email")
            password = st.text_input("Mật khẩu đăng ký", type="password", autocomplete="new-password")
            repeat = st.text_input("Nhập lại mật khẩu", type="password", autocomplete="new-password")
            submitted = st.form_submit_button("Tạo tài khoản User", width="stretch")
        if submitted:
            if not email_valid(email.strip()) or password != repeat:
                st.error("Kiểm tra email và hai mật khẩu phải trùng nhau.")
            else:
                try:
                    service().register(name, email, password)
                    st.success("Tài khoản chờ xác minh email. Bạn cần hoàn tất bước xác minh riêng trước khi đăng nhập.")
                except ApiError as error:
                    st.error(str(error))


def device_cards(rows, api):
    if not rows:
        st.info("Chưa có robot được duyệt. Bạn có thể gửi yêu cầu ghép nối bên dưới.")
    for start in range(0, len(rows), 3):
        for col, robot in zip(st.columns(3), rows[start:start + 3]):
            with col, panel():
                st.write(f"**{robot['displayName'] or robot['deviceUid']}**")
                online = robot["connectionStatus"] == "online"
                render_robot_scene(online=online, show_expressions=True)
                st.caption("Robot 3D · Demo frontend; trạng thái kết nối lấy từ Backend.")
                st.markdown(f'<span class="status {"online" if online else "offline"}">● {"Online" if online else "Offline"}</span>', unsafe_allow_html=True)
                st.caption(f"ID: {robot['id']}")
                with st.expander("Xem chi tiết"):
                    detail = api.detail(robot["id"])
                    st.write(f"Tên: {detail['displayName'] or 'Chưa có dữ liệu'}")
                    st.caption(f"Mã robot: {detail['deviceUid']}")
                    st.caption("Pin · Firmware · RSSI · Kết nối cuối: Chưa có dữ liệu")


def pairing(api):
    requests = api.pairing_requests()
    st.subheader("Ghép nối robot")
    st.write("1. Nhập mã được cấp cho robot → 2. Gửi yêu cầu → 3. Chờ quản trị viên duyệt.")
    with st.form("pair_request", clear_on_submit=True):
        code = st.text_input("Mã ghép nối robot", type="password")
        send = st.form_submit_button("Gửi yêu cầu", type="primary")
    if send:
        api.pair(code)
        st.session_state.api_flash = "Đã gửi yêu cầu ghép nối; chờ quản trị viên duyệt."
        st.rerun()
    st.subheader("Yêu cầu đã gửi")
    if requests:
        table(requests, "my_requests", ["status"])
    else:
        st.info("Chưa có yêu cầu ghép nối.")


def user_dashboard(api, account):
    access = api.access()
    if not access.allowed:
        st.info("Bạn chưa có robot được Admin duyệt để truy cập Dashboard thiết bị. Mở Robot của tôi để gửi hoặc theo dõi yêu cầu ghép nối.")
        return
    robots = api.devices()
    with st.container(key="dashboard_hero"):
        intro, mascot = st.columns([2.1, 1], gap="large")
        with intro:
            st.subheader(f"Chào mừng trở lại, {account['name']}")
            st.caption("Theo dõi robot đã được duyệt. Dữ liệu được đọc từ Backend.")
        with mascot:
            render_robot_scene()
            st.caption("Robot 3D · Demo frontend")
    with st.container(key="dashboard_metrics"):
        online = sum(r["connectionStatus"] == "online" for r in robots)
        for col, label, value in zip(st.columns(4), ["Tổng số robot", "Đang Online", "Đang Offline", "AI Provider"],
                                     [len(robots), online, len(robots) - online, "Chưa có dữ liệu"]):
            col.metric(label, value)
    left, right = st.columns([2, 1])
    with left, panel():
        st.subheader("Thiết bị của tôi")
        for robot in robots:
            online = robot["connectionStatus"] == "online"
            st.markdown(f'<div class="provider-row"><div><strong>{escape(robot["displayName"] or robot["deviceUid"])}</strong><small>{escape(robot["deviceUid"])}</small></div><span class="status {"online" if online else "offline"}">{"Trực tuyến" if online else "Ngoại tuyến"}</span></div>', unsafe_allow_html=True)
        if st.button("Xem tất cả →"):
            st.session_state.navigate_to = "Thiết bị của tôi"
            st.rerun()
    with right, panel():
        st.subheader("Trợ lý AI")
        st.info("Chưa có dữ liệu")
    with st.expander("Thống kê sử dụng"):
        st.info("Chưa có dữ liệu")


def admin_dashboard(api):
    data = api.dashboard()
    if data["online_devices"] > data["devices"]:
        raise ApiError("response")
    with st.container(key="dashboard_metrics"):
        for col, label, value in zip(st.columns(4), ["Tổng người dùng", "Tổng robot", "Đang Online", "Đang Offline"],
                                     [data["users"], data["devices"], data["online_devices"], data["devices"] - data["online_devices"]]):
            col.metric(label, value)
    left, right = st.columns([1.4, 1])
    with left, panel():
        st.subheader("Số phiên trò chuyện AI")
        st.metric("Hội thoại", data["conversations"])
        st.caption("Biểu đồ theo thời gian: Chưa có dữ liệu")
    with right, panel():
        st.subheader("Trạng thái AI Provider")
        st.info("Chưa có dữ liệu")
    left, right = st.columns(2)
    with left, panel():
        st.subheader("Thiết bị hoạt động gần đây")
        rows = api.devices()
        if rows:
            table(rows, "api_recent_devices")
        else:
            st.info("Chưa có dữ liệu")
    with right, panel():
        st.subheader("Lỗi hệ thống gần đây")
        st.info("Chưa có dữ liệu")


def admin_devices(api):
    registry, requests, assignment = st.tabs(["Thiết bị", "Yêu cầu ghép nối", "Gán / hủy liên kết"])
    with registry:
        rows = api.devices()
        if rows:
            table(rows, "devices", ["connection_status", "lifecycle_status"])
        else:
            st.info("Chưa có dữ liệu")
    with requests:
        rows = api.pairing_requests()
        if rows:
            table(rows, "requests", ["status", "userId"])
        else:
            st.info("Chưa có yêu cầu ghép nối.")
        pending = {r["id"]: r for r in rows if r["status"] == "PENDING"}
        if pending:
            selected = st.selectbox("Yêu cầu chờ duyệt", list(pending), key="request_review")
            # Confirmation widgets belong to the specific target request.
            with st.form(f"request_form_{selected}", clear_on_submit=True):
                decision = st.radio("Quyết định", ["Duyệt", "Từ chối"], horizontal=True)
                note = st.text_input("Ghi chú", max_chars=500)
                accept = st.checkbox("Xác nhận quyết định cho robot này")
                save = st.form_submit_button("Xác nhận")
            if save:
                if not accept:
                    st.error("Cần xác nhận quyết định.")
                else:
                    api.review(selected, decision == "Duyệt", note)
                    st.session_state.api_flash = "Đã cập nhật yêu cầu ghép nối."
                    st.rerun()
    with assignment:
        st.info("Chưa có dữ liệu. Thao tác gán / hủy liên kết trực tiếp chưa được kết nối trong bước này.")


def account_page(api, account):
    profile, privacy = st.tabs(["Thông tin tài khoản", "Quyền riêng tư"],
        key=f"user_account_section_{account['id']}", on_change="rerun")
    if profile.open:
        with profile:
            value = api.profile()
            details, password = st.tabs(["Hồ sơ", "Đổi mật khẩu"])
            with details:
                with st.form("profile"):
                    name = st.text_input("Họ tên", value=value["display_name"])
                    st.text_input("Email", value=value["email"], disabled=True)
                    st.text_input("Vai trò", value=account["role"], disabled=True)
                    save = st.form_submit_button("Lưu hồ sơ")
                if save:
                    api.update_profile(name)
                    st.session_state.api_flash = "Đã cập nhật hồ sơ."
                    st.rerun()
            with password:
                st.info("Chưa có dữ liệu. Đổi mật khẩu chưa được kết nối trong bước này.")
    if privacy.open:
        with privacy:
            st.info("Chưa có dữ liệu. Quyền riêng tư chưa được kết nối trong bước này.")



def api_chat(api):
    """Baseline workspace, with only authenticated Backend data and execution."""
    identity = api.session.identity()
    if identity is None or identity.role != "USER":
        raise ApiError("forbidden", 403)
    profile = api.ai_profile()
    configured = profile.get("preferred_provider_id") is not None
    uid = identity.id
    result_key = "api_chat_result_" + uid
    selected_key = "chat_selected_" + uid
    with st.container(key="chat_workspace"):
        rail, main = st.columns([1, 3.4], gap="large")
        with rail, st.container(key="chat_history"):
            st.subheader("Hội thoại")
            if st.button("＋ Đoạn chat mới", width="stretch", key="chat_new_" + uid):
                st.session_state.pop(result_key, None)
                st.session_state.pop(selected_key, None)
                st.rerun()
            search = st.text_input("Tìm kiếm hội thoại…", key="chat_search_" + uid,
                                   placeholder="Tìm kiếm hội thoại…", label_visibility="collapsed").strip()
            listing = None
            try:
                page_key = "chat_history_page_" + uid
                page = max(1, int(st.session_state.get(page_key, 1)))
                listing = api.conversations(page, 10)
                records = listing["items"]
                if search:
                    records = []
                    total = None
                    for index in range(1, 101):
                        batch = api.conversations(index, 100)
                        if total is not None and total != batch["total"]:
                            raise ApiError("conflict", 409)
                        total = batch["total"]
                        records.extend(batch["items"])
                        if len(records) == total:
                            break
                        if not batch["items"] or len(records) > total:
                            raise ApiError("response")
                    else:
                        raise ApiError("response")
                    records = [item for item in records if search.casefold() in
                               str(item.get("title") or "").casefold()]
                    st.caption(f"{len(records)} kết quả tìm kiếm")
                else:
                    pages = max(1, (listing["total"] + 9) // 10)
                    if page > pages:
                        st.session_state[page_key] = pages
                        st.rerun()
                    st.number_input("Trang hội thoại", min_value=1, max_value=pages,
                                    key=page_key, disabled=pages == 1)
                if not records:
                    st.caption("Chưa có hội thoại phù hợp.")
                for item in records:
                    title = str(item.get("title") or "Hội thoại chưa đặt tên")
                    if st.button(title, key="open_chat_" + item["id"], width="stretch",
                                 type="primary" if st.session_state.get(selected_key) == item["id"] else "secondary"):
                        saved = api.conversation(item["id"])
                        st.session_state[result_key] = saved
                        st.session_state[selected_key] = item["id"]
                        st.rerun()
            except ApiError as error:
                st.warning(str(error))
            st.caption("Danh sách gồm các hội thoại đã được Backend lưu.")
        with main, st.container(key="chat_main"):
            st.subheader(profile.get("assistant_name") or "Trợ lý AI")
            provider = "Chưa chọn provider"
            if configured:
                provider = "Provider " + profile["preferred_provider_id"]
                try:
                    available = api.request("GET", "/ai/providers")
                    if isinstance(available, list):
                        provider = next((p.get("name") or p.get("code") for p in available
                                         if p.get("id") == profile["preferred_provider_id"]), provider)
                except ApiError:
                    pass
            st.caption(f"{provider} · Nhà cung cấp và model theo cấu hình trợ lý đã lưu trên Backend.")
            if not configured:
                st.info("Chưa có nhà cung cấp trong cấu hình trợ lý. Cần lưu AI Profile trước khi trò chuyện.")
            viewing = st.session_state.get(selected_key) is not None
            if viewing:
                st.info("Đang xem lịch sử. Chọn Đoạn chat mới để gửi câu hỏi mới.")
            with st.popover("⋯ Hội thoại"):
                st.caption("Đổi tên, kết thúc và tiếp tục hội thoại chưa có API được thống nhất.")
                st.button("Đổi tên", disabled=True, key="chat_rename_unavailable")
                st.button("Kết thúc phiên chat", disabled=True, key="chat_end_unavailable")
                st.button("Tiếp tục trò chuyện", disabled=True, key="chat_resume_unavailable")
            result = st.session_state.get(result_key)
            with st.container(key="chat_messages", height=380):
                if result:
                    for message in result["messages"]:
                        if message["role"] in ("user", "assistant"):
                            with st.chat_message(message["role"]):
                                st.write(message["content"])
                else:
                    st.markdown('<div class="chat-welcome"><h2>Bạn muốn trò chuyện về điều gì?</h2><p>Bắt đầu một câu hỏi cùng AIVA.</p></div>', unsafe_allow_html=True)
            text = st.chat_input("Nhắn tin cho AIVA…", disabled=not configured or viewing,
                                 key="api_chat_input_" + uid)
            st.caption("Yêu cầu có thể mất tới 100 giây. Khi lỗi mạng hoặc hết thời gian chờ, hãy kiểm tra kết quả trước khi gửi lại.")
            if text:
                with st.spinner("Đang chờ phản hồi từ AI Server…"):
                    reply = api.chat(text)
                    st.session_state[result_key] = reply
                st.rerun()





def run():
    from giao_dien.xac_thuc import dang_nhap
    from giao_dien.dinh_tuyen import USER_ROUTES, ADMIN_ROUTES
    from nen_tang.chu_de import apply_theme
    from nen_tang.dieu_huong import USER_LABELS
    from thanh_phan.bo_cuc.tieu_de import page_header, render_login_header
    from thanh_phan.bo_cuc.thanh_ben import render_sidebar

    api = service()
    if api.session.value() is None:
        render_login_header()
        apply_theme()
        dang_nhap.render()
        return
    try:
        identity = api.me()
    except ApiError as error:
        render_login_header()
        apply_theme()
        show_error(error)
        return
    account = identity.ui_account()
    routes = ADMIN_ROUTES if identity.role == "ADMIN" else USER_ROUTES
    page = render_sidebar(account, routes)
    apply_theme()
    page_header(USER_LABELS.get(page, page) if identity.role == "USER" else page,
                "Dữ liệu Backend · Các phần chưa kết nối hiển thị Chưa có dữ liệu.")
    flash = st.session_state.pop("api_flash", None)
    if flash:
        st.success(flash)
    try:
        with st.spinner("Đang tải dữ liệu…"):
            if page == "Dashboard":
                admin_dashboard(api) if identity.role == "ADMIN" else user_dashboard(api, account)
            elif page == "Thiết bị của tôi" and identity.role == "USER":
                device_cards(api.devices(), api)
                with st.container(key="pairing_guide", border=True):
                    pairing(api)
                with st.expander("Quản lý liên kết"):
                    st.info("Chưa có dữ liệu. Đổi tên / hủy liên kết chưa được kết nối trong bước này.")
            elif page == "Quản lý thiết bị" and identity.role == "ADMIN":
                admin_devices(api)
            elif page == "AI Chat" and identity.role == "USER":
                api_chat(api)
            elif page == "Tài khoản":
                account_page(api, account)
            else:
                st.info("Chưa có dữ liệu. Chức năng này chưa được kết nối Backend trong bước tích hợp P0.")
    except ApiError as error:
        show_error(error)
