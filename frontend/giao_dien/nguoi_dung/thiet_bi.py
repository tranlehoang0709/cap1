"""Trang Người dùng: thiet_bi."""
import streamlit as st
from nen_tang.trang_thai import data, current_user, approved_devices, done, uid, now, mine
from thanh_phan.dung_chung.khung_noi_dung import panel
from thanh_phan.dung_chung.bang_du_lieu import table, select_record
from thanh_phan.bieu_mau.xac_nhan import confirm
from thanh_phan.robot.khung_hien_thi import render_robot_scene


def robots():
    u = current_user()
    owned = approved_devices(u["id"])
    st.subheader("Robot đã được duyệt")
    table(owned, "my_robots", ["online"])
    st.subheader("Yêu cầu ghép nối")
    if any(r["status"] == "Chờ duyệt" for r in mine("requests")):
        st.markdown('<div class="pairing-state" role="status"><span class="pairing-radar" aria-hidden="true"><i></i><i></i><b>⌁</b></span><span><strong>Đang chờ duyệt ghép nối</strong><br><small>Yêu cầu demo đã được gửi. Chờ Admin duyệt robot.</small></span></div>', unsafe_allow_html=True)
    st.caption("Mã mẫu chưa gán: PAIR002, PAIR003. PAIR003 đang có một yêu cầu chờ Admin duyệt. Admin duyệt từng robot.")
    table(mine("requests"), "my_requests", ["status"])
    with st.form("pair_request"):
        code = st.text_input("Mã ghép nối robot")
        send = st.form_submit_button("Gửi yêu cầu mẫu", type="primary")
    if send:
        robot = next((d for d in data()["devices"] if d["code"] == code.strip()), None)
        if not robot:
            st.error("Không tìm thấy mã trong danh sách robot mẫu.")
        elif robot["owner"]:
            st.error("Robot đã có chủ sở hữu.")
        elif any(r["device"] == robot["id"] and r["user"] == u["id"] and r["status"] == "Chờ duyệt" for r in data()["requests"]):
            st.error("Bạn đã có yêu cầu chờ duyệt cho robot này.")
        else:
            data()["requests"].append({"id": uid("REQ"), "device": robot["id"], "user": u["id"], "status": "Chờ duyệt", "created": now(), "note": ""})
            done(f"Gửi yêu cầu ghép nối {robot['id']}; chờ Admin duyệt", "Ghép nối")
    robot = select_record(owned, "my_robot_edit", "Chọn robot của tôi")
    if robot:
        with st.form(f"rename_{robot['id']}"):
            name = st.text_input("Tên robot", value=robot["name"])
            save = st.form_submit_button("Đổi tên mẫu")
        if save:
            if not name.strip():
                st.error("Tên robot không được trống.")
            else:
                robot["name"] = name.strip()
                done(f"Đổi tên robot {robot['id']}", "Thiết bị")
        accepted = confirm(f"unlink_{robot['id']}", "Xác nhận hủy liên kết robot; nếu đây là robot cuối, các trang AI sẽ đóng")
        if st.button("Hủy liên kết mẫu"):
            if not accepted:
                st.error("Cần xác nhận hủy liên kết.")
            else:
                robot["owner"] = None
                done(f"Hủy liên kết robot {robot['id']}", "Thiết bị")



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



def devices_user():
    robot_cards(approved_devices(current_user()['id']))
    with st.expander('＋ Ghép nối robot / Quản lý liên kết'):
        robots()

