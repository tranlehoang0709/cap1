"""Admin presentation and explicit session-local mock interactions."""
import streamlit as st
import pandas as pd
import plotly.express as px

from ui.state import data, uid, now, done, current_user, PROVIDERS
from ui.common import panel, render_frame, table, select_record, confirm, email_valid


def dashboard():
    d = data()
    cols = st.columns(4)
    for col, label, value in zip(cols, ["User", "Robot", "Phiên AI mẫu", "Chờ ghép nối"], [sum(u["role"] == "User" for u in d["users"]), len(d["devices"]), len(d["conversations"]), sum(r["status"] == "Chờ duyệt" for r in d["requests"])]):
        col.metric(label, value)
    st.subheader("Trạng thái hệ thống mẫu")
    st.success("AI Server: sẵn sàng (mẫu) · Telemetry là ảnh chụp dữ liệu mẫu, không cập nhật thời gian thực.")
    offline = sum(not r["online"] for r in d["devices"])
    if offline:
        st.warning(f"{offline} robot offline trong dữ liệu mẫu.")
    rows = [{"Trạng thái": "Online" if r["online"] else "Offline", "Robot": 1} for r in d["devices"]]
    if rows:
        st.plotly_chart(px.pie(pd.DataFrame(rows), names="Trạng thái", values="Robot", hole=.65, title="Kết nối thiết bị · mẫu"), width="stretch")
    table(d["logs"][-10:][::-1], "dashboard")


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
    render_frame(pd.DataFrame([{"Role": "Admin", "Quyền": "ADM-01 đến ADM-14; quản trị toàn bộ dữ liệu mẫu"}, {"Role": "User", "Quyền": "USR-01 đến USR-15; dữ liệu cá nhân; AI cần robot được duyệt"}]), hide_index=True, width="stretch")
    u = select_record(data()["users"], "role_user", "Chọn tài khoản")
    with st.form(f"role_form_{u['id']}"):
        role = st.selectbox("Role", ["Admin", "User"], index=["Admin", "User"].index(u["role"]))
        accept = st.checkbox("Xác nhận thay đổi quyền mẫu")
        save = st.form_submit_button("Cập nhật Role")
    if save:
        if not accept:
            st.error("Cần xác nhận thay đổi quyền.")
        elif u["id"] == current_user()["id"] and role != "Admin":
            st.error("Không hạ quyền tài khoản Admin đang đăng nhập trong demo.")
        else:
            u["role"] = role
            done(f"Đổi quyền {u['id']} thành {role}")


def devices():
    registry, requests, assignment = st.tabs(["Thiết bị", "Yêu cầu ghép nối", "Gán / hủy liên kết"])
    with registry:
        table(data()["devices"], "devices", ["owner", "online"])
        with st.form("register_device"):
            device_id = st.text_input("Mã thiết bị")
            code = st.text_input("Mã ghép nối")
            name = st.text_input("Tên robot")
            save = st.form_submit_button("Đăng ký robot mẫu")
        if save:
            if not all(v.strip() for v in [device_id, code, name]):
                st.error("Nhập đầy đủ ba trường.")
            elif any(d["id"] == device_id.strip() or d["code"] == code.strip() for d in data()["devices"]):
                st.error("Mã thiết bị hoặc mã ghép nối đã tồn tại.")
            else:
                data()["devices"].append({"id": device_id.strip(), "code": code.strip(), "name": name.strip(), "owner": None, "online": False, "heartbeat": "Chưa có", "battery": 0, "rssi": 0, "firmware": "Chưa rõ"})
                done(f"Đăng ký robot {device_id.strip()}", "Thiết bị")
    with requests:
        rows = table(data()["requests"], "requests", ["status", "user"])
        pending = [r for r in rows if r["status"] == "Chờ duyệt"]
        selected = select_record(pending, "request_review", "Yêu cầu chờ duyệt")
        if selected:
            r = next(r for r in data()["requests"] if r["id"] == selected["id"])
            with st.form(f"request_form_{r['id']}"):
                decision = st.radio("Quyết định", ["Duyệt", "Từ chối"], horizontal=True)
                note = st.text_input("Ghi chú")
                accept = st.checkbox("Xác nhận quyết định cho robot này")
                save = st.form_submit_button("Xác nhận mẫu")
            if save:
                robot = next(d for d in data()["devices"] if d["id"] == r["device"])
                if not accept:
                    st.error("Cần xác nhận quyết định.")
                elif decision == "Duyệt" and robot["owner"] is not None:
                    st.error("Robot đã được gán. Hãy hủy liên kết trước.")
                else:
                    r.update(status="Đã duyệt" if decision == "Duyệt" else "Từ chối", note=note, reviewed=now())
                    if decision == "Duyệt":
                        robot["owner"] = r["user"]
                        for other in data()["requests"]:
                            if other["device"] == robot["id"] and other["id"] != r["id"] and other["status"] == "Chờ duyệt":
                                other.update(status="Từ chối", note="Robot đã được duyệt cho yêu cầu khác.")
                    done(f"{decision} yêu cầu {r['id']} cho robot {robot['id']}", "Ghép nối")
    with assignment:
        robot = select_record(data()["devices"], "assign_robot", "Chọn robot")
        targets = [u for u in data()["users"] if u["role"] == "User" and not u["locked"]]
        options = {"Hủy liên kết": None, **{f"{u['name']} ({u['id']})": u["id"] for u in targets}}
        st.write(f"Chủ sở hữu hiện tại: {robot['owner'] or 'Chưa gán'}")
        target = st.selectbox("Gán cho", list(options))
        accepted = confirm("assign")
        if st.button("Cập nhật liên kết mẫu"):
            if not accepted:
                st.error("Cần xác nhận thao tác.")
            else:
                robot["owner"] = options[target]
                for r in data()["requests"]:
                    if r["device"] == robot["id"] and r["status"] == "Chờ duyệt":
                        r.update(status="Từ chối", note="Admin đã cập nhật gán thiết bị.")
                done(f"Cập nhật chủ sở hữu robot {robot['id']}", "Thiết bị")


def telemetry():
    st.info("Online/offline, heartbeat và telemetry đều là dữ liệu mẫu cố định.")
    rows = table(data()["devices"], "telemetry", ["online", "owner"])
    r = select_record(rows, "telemetry_device")
    if r:
        st.subheader(r["name"])
        cols = st.columns(3)
        cols[0].metric("Pin mẫu", f"{r['battery']}%")
        cols[1].metric("RSSI mẫu", f"{r['rssi']} dBm")
        cols[2].metric("Firmware", r["firmware"])
        st.write(f"Heartbeat: {r['heartbeat']} · User: {r['owner'] or 'Chưa gán'}")
        if st.button("Làm mới hiển thị"):
            st.info("Đã đọc lại dữ liệu mẫu trong phiên; không truy vấn thiết bị.")


def server():
    st.metric("AI Server mẫu", "Sẵn sàng")
    table([{"id": p, **values} for p, values in data()["providers"].items()], "server")
    if st.button("Kiểm tra kết nối mô phỏng"):
        st.success("Kịch bản mẫu: AI Server, Local AI, OpenAI và Gemini sẵn sàng. Không thực hiện kết nối mạng.")


def resources():
    st.caption("ADM-08 · P1 · Các số liệu chỉ minh họa hạ tầng có GPU; không đọc tài nguyên máy thật.")
    frame = pd.DataFrame({"Phút": list(range(1, 13)), "CPU (%)": [24, 28, 33, 29, 35, 40, 38, 31, 28, 35, 32, 30], "RAM (%)": [42, 42, 43, 44, 44, 45, 44, 44, 43, 43, 44, 43], "GPU (%)": [10, 18, 42, 30, 12, 48, 52, 24, 14, 32, 28, 20]})
    cols = st.columns(4)
    for col, label, value in zip(cols, ["CPU", "RAM", "GPU", "VRAM"], ["30%", "43%", "20%", "3.2 / 8 GB"]):
        col.metric(f"{label} mẫu", value)
    st.plotly_chart(px.line(frame, x="Phút", y=["CPU (%)", "RAM (%)", "GPU (%)"], title="Tài nguyên · dữ liệu mẫu"), width="stretch")


def logs():
    rows = table(data()["logs"][::-1], "logs", ["level", "type", "actor"])
    record = select_record(rows, "log_details")
    if record:
        st.json(record)


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


def system_keys():
    from ui.user import key_manager
    st.info("ADM-11 · Chỉ System Key. Không hiển thị Personal Key của User.")
    key_manager(data()["system_keys"], "system")


def quotas():
    rows = table(data()["quotas"], "quotas", ["scope", "provider"])
    choices = ["Tạo mới"] + [r["id"] for r in rows]
    selected = st.selectbox("Hạn mức", choices)
    existing = next((r for r in data()["quotas"] if r["id"] == selected), None)
    r = existing or {"scope": "User", "target": "user1", "provider": "OpenAI", "daily": 10000, "rpm": 20}
    # Scope lives outside the form so target options change immediately.
    scope = st.selectbox("Phạm vi", ["User", "Provider", "Hệ thống"], index=["User", "Provider", "Hệ thống"].index(r["scope"]), key=f"scope_{selected}")
    with st.form(f"quota_form_{selected}_{scope}"):
        if scope == "User":
            targets = [u["id"] for u in data()["users"] if u["role"] == "User"]
        elif scope == "Provider":
            targets = PROVIDERS
        else:
            targets = ["Toàn hệ thống"]
        target = st.selectbox("Đối tượng", targets, index=targets.index(r["target"]) if r["target"] in targets else 0)
        provider = st.selectbox("Provider áp dụng", ["Tất cả"] + PROVIDERS, index=(["Tất cả"] + PROVIDERS).index(r["provider"]))
        daily = st.number_input("Token / ngày (đơn vị mẫu)", 1, 10000000, r["daily"])
        rpm = st.number_input("Yêu cầu / phút", 1, 10000, r["rpm"])
        save = st.form_submit_button("Lưu hạn mức mẫu")
    if save:
        values = {"scope": scope, "target": target, "provider": provider, "daily": daily, "rpm": rpm}
        if existing:
            existing.update(values)
        else:
            data()["quotas"].append({"id": uid("Q"), **values})
        done("Cập nhật Quota / Rate Limit mẫu; không thực thi hạn mức thật")


def firmware():
    st.info("Upload chỉ giữ tên, dung lượng và ghi chú trong phiên; không flash robot hay lưu tệp firmware.")
    table(data()["firmware"], "firmware", ["available"])
    with st.form("firmware_upload"):
        file = st.file_uploader("Firmware mẫu (.bin)", type=["bin"])
        version = st.text_input("Phiên bản")
        notes = st.text_area("Ghi chú phiên bản")
        save = st.form_submit_button("Thêm phiên bản mẫu")
    if save:
        if file is None or not version.strip():
            st.error("Chọn file .bin và nhập phiên bản.")
        elif any(f["version"] == version.strip() for f in data()["firmware"]):
            st.error("Phiên bản đã tồn tại.")
        else:
            data()["firmware"].append({"id": uid("FW"), "version": version.strip(), "file": file.name, "size": file.size, "notes": notes, "available": True})
            done(f"Thêm firmware mẫu {version.strip()}", "OTA")
    f = select_record(data()["firmware"], "firmware_selected", "Phiên bản cập nhật")
    if f:
        with st.form(f"firmware_availability_{f['id']}"):
            available = st.checkbox("Cho phép cung cấp bản cập nhật mẫu", value=f["available"])
            save = st.form_submit_button("Cập nhật trạng thái phiên bản")
        if save:
            f["available"] = available
            done("Cập nhật trạng thái firmware", "OTA")
        robot = select_record(data()["devices"], "ota_robot", "Robot nhận bản cập nhật")
        accept = confirm("ota", "Xác nhận mô phỏng cung cấp bản cập nhật")
        if st.button("Cung cấp bản cập nhật mẫu", disabled=not f["available"]):
            if not accept:
                st.error("Cần xác nhận.")
            else:
                data()["ota"].append({"id": uid("OTA"), "device": robot["id"], "version": f["version"], "time": now(), "status": "Đã cung cấp (mô phỏng); chưa cài đặt"})
                done(f"Cung cấp OTA mẫu cho {robot['id']}; firmware thiết bị chưa thay đổi", "OTA")
    table(data()["ota"], "ota")


def providers():
    p = st.selectbox("AI Provider", PROVIDERS)
    config = data()["providers"][p]
    with st.form(f"provider_{p}"):
        enabled = st.checkbox("Cho phép User chọn", value=config["enabled"])
        model = st.text_input("Tên model (mẫu)", value=config["model"])
        endpoint = st.text_input("Địa chỉ dịch vụ (chỉ lưu cấu hình mẫu, không kết nối)", value=config["endpoint"])
        policies = ["User lựa chọn", "Ưu tiên Local AI", "Ưu tiên Cloud AI"]
        policy = st.selectbox("Chính sách lựa chọn", policies, index=policies.index(data()["provider_policy"]))
        save = st.form_submit_button("Lưu cấu hình Provider mẫu")
    if save:
        if not model.strip():
            st.error("Nhập tên model mẫu.")
        else:
            config.update(enabled=enabled, model=model.strip(), endpoint=endpoint)
            data()["provider_policy"] = policy
            done(f"Cập nhật Provider {p}; chính sách chỉ mô phỏng")


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
