"""Trang Người dùng: tro_chuyen_ai."""
import streamlit as st
from nen_tang.trang_thai import data, current_user, preferences, privacy, uid, now, mine, allowed_providers, approved_devices
from nen_tang.dieu_huong import go
from thanh_phan.dung_chung.trang_thai_robot import render_robot_status


def render_page():
    """Giữ hội thoại đang chọn khi chuyển giữa trò chuyện và lịch sử."""
    from giao_dien.nguoi_dung.lich_su_hoi_thoai import render_page as history
    chat, archive = st.tabs(["Trò chuyện", "Lịch sử"],
        key=f"user_chat_section_{current_user()['id']}", on_change="rerun")
    if chat.open:
        with chat:
            web_chat()
    if archive.open:
        with archive:
            history()


def web_chat():
    u = current_user()
    selected_key = f"chat_selected_{u['id']}"
    private = not privacy(u["id"])["history"]
    with st.container(key="chat_workspace"):
        conversations, messages = st.columns([1, 3.4], gap="large")
        with conversations, st.container(key="chat_history"):
            st.subheader("AIVA Chat")
            if st.button("＋ Đoạn chat mới", width="stretch", key="chat_new"):
                st.session_state.pop(selected_key, None)
                st.session_state.pop(f"temporary_chat_{u['id']}", None)
                st.rerun()
            query = st.text_input("Tìm kiếm hội thoại…", placeholder="Tìm kiếm hội thoại…", label_visibility="collapsed")
            st.caption("Gần đây" if not private else "Không lưu lịch sử")
            if not private:
                chats = sorted(mine("conversations"), key=lambda c: c["created"], reverse=True)
                matched = False
                for chat in chats:
                    if query.casefold() not in chat["title"].casefold():
                        continue
                    matched = True
                    if st.button(chat["title"], key=f"open_{chat['id']}", width="stretch", type="primary" if st.session_state.get(selected_key) == chat["id"] else "secondary"):
                        st.session_state[selected_key] = chat["id"]
                        st.rerun()
                if query and not matched:
                    st.caption("Không tìm thấy hội thoại phù hợp.")
                    st.caption("Thử từ khóa ngắn hơn hoặc xóa nội dung ô tìm kiếm.")
                elif not chats:
                    st.caption("Chưa có hội thoại được lưu. Chọn Đoạn chat mới để bắt đầu.")
        with messages, st.container(key="chat_main"):
            robots = approved_devices(u["id"])
            render_robot_status(robots, "chat")
            if not robots:
                st.caption("Bạn vẫn có thể dùng chat mô phỏng trên web khi chưa có robot.")
                if st.button("Xem cách ghép nối robot", key="chat_pairing_help"):
                    go("Thiết bị của tôi")
            render_chat()



def render_chat():
    u = current_user()
    allowed = allowed_providers()
    if not allowed:
        st.warning("Hiện chưa có dịch vụ AI nào được bật trong bản demo. Hãy nhờ quản trị viên kiểm tra; bạn vẫn có thể xem tab Lịch sử.")
        with st.expander("Thông tin kỹ thuật"):
            st.caption("Không có Provider được Admin cho phép: danh sách allowed_providers() đang rỗng.")
        return
    private = not privacy(u["id"])["history"]
    selected_key = f"chat_selected_{u['id']}"
    chat = (st.session_state.get(f"temporary_chat_{u['id']}") if private else
            next((c for c in mine("conversations") if c["id"] == st.session_state.get(selected_key)), None))
    pref = preferences(u["id"])
    if chat and chat["provider"] in allowed:
        st.session_state.chat_provider = chat["provider"]
    elif st.session_state.get("chat_provider") not in allowed:
        st.session_state.chat_provider = pref["provider"] if pref["provider"] in allowed else allowed[0]
    top, actions = st.columns([2, 3], vertical_alignment="bottom")
    with top:
        with st.expander("Cài đặt nâng cao"):
            selected_provider = st.selectbox("Provider cho phiên mới", allowed,
                index=allowed.index(pref["provider"]) if pref["provider"] in allowed else 0,
                key="chat_provider", disabled=chat is not None)
    with actions:
        st.caption(f"{chat['provider']} · {'Đang mở' if chat['active'] else 'Đã kết thúc'}" if chat else "AIVA-IoT · Trợ lý AI")
    if chat:
        with st.popover("⋯ Hội thoại"):
            with st.form(f"chat_rename_{chat['id']}"):
                title = st.text_input("Tên hội thoại", value=chat["title"])
                save = st.form_submit_button("Đổi tên")
            if save:
                if title.strip():
                    chat["title"] = title.strip()
                    st.rerun()
                else:
                    st.error("Tên hội thoại không được trống.")
            if st.button("Kết thúc phiên chat", disabled=not chat["active"]):
                chat["active"] = False
                if private:
                    st.session_state.pop(f"temporary_chat_{u['id']}", None)
                st.rerun()
            if not chat["active"] and chat["provider"] in allowed:
                if st.button("Tiếp tục trò chuyện"):
                    chat["active"] = True
                    st.rerun()
    if not chat or not chat["messages"]:
        st.markdown('<div class="chat-welcome"><h2>Hôm nay bạn muốn làm gì?</h2><p>Nhập tin nhắn bên dưới để bắt đầu. Phản hồi hiện là mô phỏng, không gửi đến robot.</p></div>', unsafe_allow_html=True)
    else:
        with st.container(height=430, border=False, key="chat_messages"):
            for message in chat["messages"]:
                with st.chat_message(message["role"]):
                    st.write(message["content"])
    can_chat = not chat or (chat["active"] and chat["provider"] in allowed)
    if chat and chat["provider"] not in allowed:
        st.warning("Dịch vụ AI của hội thoại này hiện không khả dụng. Mở Đoạn chat mới để chọn một dịch vụ đang bật.")
        with st.expander("Thông tin kỹ thuật"):
            st.write(f"Provider của hội thoại: {chat['provider']}. Provider này không nằm trong danh sách được bật.")
    elif chat and not chat["active"]:
        st.caption("Hội thoại này đã kết thúc. Mở menu ⋯ Hội thoại để tiếp tục, hoặc chọn Đoạn chat mới.")
    text = st.chat_input("Nhắn tin cho AIVA…", disabled=not can_chat, key="aiva_chat_input")
    st.caption("Phản hồi mô phỏng · Chưa kết nối backend" + (" · Không lưu lịch sử" if private else ""))
    if text and text.strip():
        if not chat:
            first = " ".join(text.split())
            chat = {"id": uid("CHAT"), "user": u["id"], "title": first[:48] + ("…" if len(first) > 48 else ""),
                    "provider": selected_provider, "created": now(), "active": True, "messages": []}
            if private:
                st.session_state[f"temporary_chat_{u['id']}"] = chat
            else:
                data()["conversations"].append(chat)
            st.session_state[selected_key] = chat["id"]
        chat["messages"].append({"role": "user", "content": text.strip()})
        content = f"PHẢN HỒI AI MẪU ({chat['provider']}): Đã nhận tin nhắn của bạn. Đây là câu trả lời cố định phục vụ kiểm tra giao diện."
        chat["messages"].append({"role": "assistant", "content": content})
        st.rerun()

