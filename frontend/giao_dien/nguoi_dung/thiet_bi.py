"""Trang Người dùng: thiet_bi."""
import streamlit as st
from nen_tang.trang_thai import data, current_user, approved_devices, done, uid, now, mine
from thanh_phan.dung_chung.khung_noi_dung import panel
from thanh_phan.dung_chung.bang_du_lieu import table, select_record
from thanh_phan.bieu_mau.xac_nhan import confirm
from thanh_phan.robot.khung_hien_thi import render_robot_scene


def pairing():
    """Hướng dẫn dùng đúng form và bản ghi yêu cầu ghép nối hiện có."""
    u = current_user()
    requests = mine("requests")
    st.subheader("Ghép nối robot")
    st.write("1. Nhập mã được cấp cho robot → 2. Gửi yêu cầu → 3. Chờ quản trị viên duyệt.")
    st.caption("Bản demo chỉ tạo yêu cầu trong phiên; thao tác này chưa kết nối với phần cứng.")
    if requests:
        latest = requests[-1]
        st.caption(f"Yêu cầu gửi gần nhất: {latest['device']}")
        if latest["status"] == "Chờ duyệt":
            st.progress(2 / 3, text="Đã gửi yêu cầu · Đang chờ duyệt (mẫu)")
        elif latest["status"] == "Đã duyệt":
            st.progress(1.0, text="Yêu cầu đã được duyệt (mẫu)")
            if any(r["id"] == latest["device"] for r in approved_devices(u["id"])):
                st.success("Robot của yêu cầu này đã được liên kết với tài khoản trong dữ liệu mẫu.")
            else:
                st.info("Yêu cầu trước đã được duyệt, nhưng robot này hiện không liên kết với tài khoản trong dữ liệu mẫu.")
        elif latest["status"] == "Từ chối":
            st.warning("Yêu cầu gần nhất không được duyệt. Xem ghi chú ở bảng bên dưới hoặc nhờ quản trị viên hỗ trợ.")
    else:
        st.progress(0, text="Chưa gửi yêu cầu ghép nối mới")
    if any(r["status"] == "Chờ duyệt" for r in requests):
        st.markdown('<div class="pairing-state" role="status"><span class="pairing-radar" aria-hidden="true"><i></i><i></i><b>⌁</b></span><span><strong>Đang chờ duyệt ghép nối</strong><br><small>Yêu cầu demo đã được gửi. Chờ Admin duyệt robot.</small></span></div>', unsafe_allow_html=True)
    st.caption("Mã minh họa trong demo: PAIR002, PAIR003. Kết quả kiểm tra mã và liên kết được hiển thị khi bạn gửi yêu cầu; quản trị viên duyệt riêng từng yêu cầu.")
    with st.form("pair_request"):
        code = st.text_input("Mã ghép nối robot")
        send = st.form_submit_button("Gửi yêu cầu mẫu", type="primary")
    if send:
        robot = next((d for d in data()["devices"] if d["code"] == code.strip()), None)
        if not robot:
            st.error("Bạn chưa nhập mã. Nhập mã robot rồi gửi lại yêu cầu." if not code.strip() else
                     "Không tìm thấy mã trong dữ liệu mẫu. Kiểm tra lại mã; bạn có thể thử PAIR002 hoặc PAIR003 trong demo.")
        elif robot["owner"]:
            st.error("Robot này đã được liên kết với một tài khoản. Hãy nhờ quản trị viên kiểm tra nếu bạn cần chuyển liên kết.")
        elif any(r["device"] == robot["id"] and r["user"] == u["id"] and r["status"] == "Chờ duyệt" for r in data()["requests"]):
            st.error("Yêu cầu cho robot này đang chờ duyệt. Bạn không cần gửi lại; hãy theo dõi tiến trình bên trên.")
        else:
            data()["requests"].append({"id": uid("REQ"), "device": robot["id"], "user": u["id"], "status": "Chờ duyệt", "created": now(), "note": ""})
            done(f"Gửi yêu cầu ghép nối {robot['id']}; chờ Admin duyệt", "Ghép nối")
    st.subheader("Yêu cầu đã gửi")
    table(requests, "my_requests", ["status"])


def robots(*, show_pairing=True):
    """Giữ API cũ; trang mới tách hướng dẫn ra khỏi quản lý liên kết nâng cao."""
    u = current_user()
    owned = approved_devices(u["id"])
    st.subheader("Robot đã được duyệt")
    table(owned, "my_robots", ["online"])
    if show_pairing:
        pairing()
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
        accepted = confirm(f"unlink_{robot['id']}", "Xác nhận hủy liên kết robot khỏi tài khoản trong dữ liệu mẫu")
        if st.button("Hủy liên kết mẫu"):
            if not accepted:
                st.error("Cần xác nhận hủy liên kết.")
            else:
                robot["owner"] = None
                done(f"Hủy liên kết robot {robot['id']}", "Thiết bị")



def robot_cards(robots):
    if not robots:
        st.info("Bạn chưa có robot được duyệt trong dữ liệu mẫu. Làm theo các bước Ghép nối robot bên dưới để gửi yêu cầu.")
    for start in range(0, len(robots), 3):
        for col, robot in zip(st.columns(3), robots[start:start+3]):
            with col, panel():
                st.write(f"**{robot['name']}**")
                render_robot_scene(online=robot['online'], show_expressions=True)
                online = robot['online']
                st.markdown(f'<span class="status {"online" if online else "offline"}">● {"Online" if online else "Offline"}</span>', unsafe_allow_html=True)
                st.caption(f"ID: {robot['id']}")
                with st.expander("Xem chi tiết"):
                    st.write(f"Pin: {robot['battery']}% · Firmware: {robot['firmware']}")
                    st.caption(f"Kết nối cuối: {robot['heartbeat']} · RSSI: {robot['rssi']} dBm")



def devices_user():
    robot_cards(approved_devices(current_user()['id']))
    with st.container(key="pairing_guide", border=True):
        pairing()
    with st.expander('Quản lý liên kết'):
        robots(show_pairing=False)

