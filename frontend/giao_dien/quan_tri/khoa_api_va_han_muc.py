"""Trang Quản trị: khoa_api_va_han_muc."""
import streamlit as st
from nen_tang.trang_thai import data, uid, done, PROVIDERS
from thanh_phan.dung_chung.bang_du_lieu import table


def system_keys():
    from thanh_phan.dung_chung.quan_ly_khoa_api import key_manager
    st.info("ADM-11 · Chỉ System Key. Không hiển thị Personal Key của User.")
    key_manager(data()["system_keys"], "system")



def quotas():
    rows = table(data()["quotas"], "quotas", ["scope", "provider"])
    choices = ["Tạo mới"] + [r["id"] for r in rows]
    selected = st.selectbox("Hạn mức", choices)
    existing = next((r for r in data()["quotas"] if r["id"] == selected), None)
    r = existing or {"scope": "User", "target": "user1", "provider": "OpenAI", "daily": 10000, "rpm": 20}
    # Phạm vi ở ngoài form để cập nhật ngay danh sách đối tượng.
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
        if not targets:
            st.info("Chưa có User để áp dụng hạn mức. Hãy thêm User hoặc chọn phạm vi khác.")
        save = st.form_submit_button("Lưu hạn mức mẫu", disabled=not targets)
    if save:
        if target is None or target not in targets:
            st.error("Chọn đối tượng hợp lệ trước khi lưu hạn mức.")
            return
        values = {"scope": scope, "target": target, "provider": provider, "daily": daily, "rpm": rpm}
        if existing:
            existing.update(values)
        else:
            data()["quotas"].append({"id": uid("Q"), **values})
        done("Cập nhật Quota / Rate Limit mẫu; không thực thi hạn mức thật")



def keys():
    keys,quota=st.tabs(['API Key hệ thống','Cấu hình Quota & Rate Limit'])
    with keys:
        system_keys()
    with quota:
        quotas()

