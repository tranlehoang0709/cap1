"""Trang Quản trị: quan_ly_thiet_bi."""
import streamlit as st
from nen_tang.trang_thai import data, now, done
from thanh_phan.dung_chung.bang_du_lieu import table, select_record
from thanh_phan.bieu_mau.xac_nhan import confirm


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
        if robot is None:
            st.info("Chưa có robot để gán hoặc hủy liên kết. Hãy đăng ký robot ở tab Thiết bị.")
            return
        targets = [u for u in data()["users"] if u["role"] == "User" and not u["locked"]]
        options = {"Hủy liên kết": None, **{f"{u['name']} ({u['id']})": u["id"] for u in targets}}
        st.write(f"Chủ sở hữu hiện tại: {robot['owner'] or 'Chưa gán'}")
        target = st.selectbox("Gán cho", list(options))
        accepted = confirm("assign", scope=(robot["id"], options[target]))
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



render_telemetry = telemetry


def devices_admin():
    robots=data()['devices']
    for col,label,value in zip(st.columns(3),['Tổng robot','Đang Online','Đang Offline'],[len(robots),sum(r['online'] for r in robots),sum(not r['online'] for r in robots)]):
        col.metric(label,value)
    registry, telemetry=st.tabs(['Quản lý thiết bị','Giám sát kết nối'])
    with registry:
        devices()
    with telemetry:
        render_telemetry()

