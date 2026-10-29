"""Trang Quản trị: firmware_ota."""
import streamlit as st
from nen_tang.trang_thai import data, uid, now, done
from thanh_phan.dung_chung.bang_du_lieu import table, select_record
from thanh_phan.bieu_mau.xac_nhan import confirm


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
        if robot is None:
            st.info("Chưa có robot nhận bản cập nhật. Hãy đăng ký robot trong Quản lý thiết bị.")
        accept = confirm("ota", "Xác nhận mô phỏng cung cấp bản cập nhật", scope=(f["id"], robot["id"] if robot else None))
        if st.button("Cung cấp bản cập nhật mẫu", disabled=not f["available"] or robot is None):
            if not accept:
                st.error("Cần xác nhận.")
            else:
                data()["ota"].append({"id": uid("OTA"), "device": robot["id"], "version": f["version"], "time": now(), "status": "Đã cung cấp (mô phỏng); chưa cài đặt"})
                done(f"Cung cấp OTA mẫu cho {robot['id']}; firmware thiết bị chưa thay đổi", "OTA")
    table(data()["ota"], "ota")

