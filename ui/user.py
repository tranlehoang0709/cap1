"""User portal: personal presentation and mock interactions only."""
import streamlit as st
import pandas as pd
import plotly.express as px

from ui.state import data, current_user, approved_devices, preferences, privacy, done, uid, now, PROVIDERS
from ui.common import panel, render_frame, table, select_record, confirm, email_valid


def mine(collection):
    return [r for r in data()[collection] if r["user"] == current_user()["id"]]


def account():
    u = current_user()
    profile, password = st.tabs(["Hồ sơ", "Đổi mật khẩu"])
    with profile:
        with st.form("profile"):
            name = st.text_input("Họ tên", value=u["name"])
            email = st.text_input("Email", value=u["email"])
            st.text_input("Vai trò", value=u["role"], disabled=True)
            save = st.form_submit_button("Lưu hồ sơ mẫu")
        if save:
            if not name.strip() or not email_valid(email.strip()):
                st.error("Họ tên và email phải hợp lệ.")
            elif any(x["id"] != u["id"] and x["email"].casefold() == email.strip().casefold() for x in data()["users"]):
                st.error("Email đã tồn tại.")
            else:
                u.update(name=name.strip(), email=email.strip())
                done("Cập nhật hồ sơ cá nhân", "Tài khoản")
    with password:
        st.caption("Chỉ dùng mật khẩu thử nghiệm; không nhập mật khẩu thật.")
        with st.form("password"):
            old = st.text_input("Mật khẩu hiện tại", type="password")
            new = st.text_input("Mật khẩu mới", type="password")
            repeat = st.text_input("Nhập lại mật khẩu mới", type="password")
            save = st.form_submit_button("Đổi mật khẩu mẫu")
        if save:
            if old != u["password"]:
                st.error("Mật khẩu hiện tại không đúng.")
            elif len(new) < 8 or new != repeat:
                st.error("Mật khẩu mới cần ít nhất 8 ký tự và khớp xác nhận.")
            else:
                u["password"] = new
                done("Đổi mật khẩu mẫu", "Tài khoản")


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


def assistant():
    p = preferences(current_user()["id"])
    persona, language, voice = st.tabs(["Cá nhân hóa · USR-03", "Ngôn ngữ · USR-04 / P1", "Giọng nói · USR-05"])
    with persona:
        with st.form("assistant_persona"):
            name = st.text_input("Tên trợ lý", value=p["name"])
            personality = st.text_input("Tính cách", value=p["personality"])
            address = st.text_input("Cách xưng hô", value=p["address"])
            prompt = st.text_area("System prompt", value=p["prompt"])
            save = st.form_submit_button("Lưu cá nhân hóa mẫu")
        if save:
            if not all(v.strip() for v in [name, personality, address, prompt]):
                st.error("Các trường không được để trống.")
            else:
                p.update(name=name.strip(), personality=personality.strip(), address=address.strip(), prompt=prompt.strip())
                done("Lưu cá nhân hóa trợ lý", "Cấu hình AI")
    with language:
        st.caption("Tiếng Việt theo Proposal. Các ngôn ngữ khác cần xác nhận dịch vụ ASR/TTS hỗ trợ trước khi bổ sung.")
        with st.form("assistant_language"):
            value = st.selectbox("Ngôn ngữ hỗ trợ trong demo", ["Tiếng Việt"])
            save = st.form_submit_button("Lưu ngôn ngữ mẫu")
        if save:
            p["language"] = value
            done("Lưu ngôn ngữ mẫu", "Cấu hình AI")
    with voice:
        st.caption("Giọng và tốc độ được lưu để minh họa; chưa kết nối dịch vụ TTS.")
        with st.form("assistant_voice"):
            voices = ["Giọng mẫu A", "Giọng mẫu B"]
            value = st.selectbox("Giọng TTS mẫu", voices, index=voices.index(p["voice"]))
            speed = st.slider("Tốc độ giọng nói", .5, 2., float(p.get("speed", 1.)), .1)
            save = st.form_submit_button("Lưu giọng nói mẫu")
        if save:
            p["voice"] = value
            p["speed"] = speed
            done("Lưu giọng TTS mẫu", "Cấu hình AI")


def allowed_providers():
    return [p for p in PROVIDERS if data()["providers"][p]["enabled"]]


def provider():
    p = preferences(current_user()["id"])
    allowed = allowed_providers()
    st.caption(f"Chính sách mẫu: {data()['provider_policy']}. Danh sách do Admin bật/tắt.")
    if not allowed:
        st.warning("Admin chưa bật Provider nào.")
        return
    with st.form("user_provider"):
        selected = st.selectbox("AI Provider", allowed, index=allowed.index(p["provider"]) if p["provider"] in allowed else 0)
        save = st.form_submit_button("Lưu lựa chọn mẫu")
    if save:
        p["provider"] = selected
        done(f"Chọn Provider {selected}", "Cấu hình AI")


def key_manager(store, prefix):
    st.warning("Chỉ nhập chuỗi thử nghiệm (ví dụ demo-key-123). Không nhập API Key thật. Giá trị được che; kiểm tra chỉ mô phỏng.")
    provider_name = st.selectbox("Provider", ["OpenAI", "Gemini"], key=f"key_provider_{prefix}")
    entry = store.get(provider_name)
    if entry:
        st.write(f"Khóa mẫu: •••••••• · Cập nhật: {entry['updated']} · Kiểm tra: {entry['status']}")
    else:
        st.info("Chưa có khóa mẫu cho Provider này.")
    with st.form(f"key_form_{prefix}_{provider_name}", clear_on_submit=True):
        value = st.text_input("Chuỗi API Key thử nghiệm", type="password")
        save = st.form_submit_button("Thêm / thay thế khóa mẫu")
    if save:
        if len(value.strip()) < 8:
            st.error("Chuỗi thử nghiệm cần ít nhất 8 ký tự.")
        else:
            store[provider_name] = {"value": value.strip(), "updated": now(), "status": "Chưa kiểm tra"}
            done(f"Thêm / thay thế {provider_name} Key mẫu", "API Key")
    if entry:
        if st.button("Kiểm tra khóa mẫu", key=f"test_key_{prefix}"):
            entry["status"] = "Đạt kiểm tra kịch bản mẫu; chưa xác thực với Provider"
            done(f"Kiểm tra mô phỏng {provider_name} Key; không gọi Provider", "API Key")
        accept = confirm(f"delete_key_{prefix}_{provider_name}")
        if st.button("Xóa khóa mẫu", key=f"delete_key_{prefix}"):
            if not accept:
                st.error("Cần xác nhận xóa.")
            else:
                del store[provider_name]
                done(f"Xóa {provider_name} Key mẫu", "API Key")


def personal_keys():
    store = data()["personal_keys"].setdefault(current_user()["id"], {})
    for col, name in zip(st.columns(2), ["OpenAI", "Gemini"]):
        with col, panel():
            st.subheader("✧ " + name)
            entry = store.get(name)
            st.caption("● Đã cấu hình" if entry else "● Chưa cấu hình")
            if entry:
                st.write("API Key: ••••••••••••")
                st.caption(f"Cập nhật: {entry['updated']}")
                st.caption(entry['status'])
            else:
                st.caption("Chưa có API Key được thêm.")
    with panel():
        key_manager(store, f"personal_{current_user()['id']}")


def history():
    rows = [{k: v for k, v in r.items() if k != "messages"} for r in mine("conversations")]
    filtered = table(rows, "history", ["provider", "active"])
    record = select_record(filtered, "history_selected")
    if not record:
        return
    chat = next(c for c in mine("conversations") if c["id"] == record["id"])
    for message in chat["messages"]:
        with st.chat_message(message["role"]):
            st.write(message["content"])
    st.caption("Mở lại phiên hội thoại trong AI Chat.")
    if st.button("Tiếp tục phiên mẫu"):
        if chat["provider"] not in allowed_providers():
            st.error("Provider của phiên đã bị Admin tắt. Chọn phiên khác hoặc tạo phiên mới.")
        else:
            chat["active"] = True
            st.session_state[f"chat_selected_{current_user()['id']}"] = chat["id"]
            st.session_state.navigate_to = "AI Chat"
            done("Mở lại phiên hội thoại", "Hội thoại")
    accept = confirm(f"history_delete_{chat['id']}")
    if st.button("Xóa hội thoại mẫu"):
        if not accept:
            st.error("Cần xác nhận xóa.")
        else:
            data()["conversations"].remove(chat)
            done("Xóa hội thoại mẫu", "Quyền riêng tư")


def memory():
    st.info("USR-09 · P2 · Bộ nhớ mẫu, không học hay trích xuất từ hội thoại.")
    rows = table(mine("memory"), "memory")
    record = select_record(rows, "memory_edit")
    if record:
        m = next(m for m in mine("memory") if m["id"] == record["id"])
        with st.form(f"memory_form_{m['id']}"):
            content = st.text_area("Nội dung bộ nhớ", value=m["content"])
            save = st.form_submit_button("Chỉnh sửa bộ nhớ mẫu")
        if save:
            if not content.strip():
                st.error("Nội dung không được trống.")
            else:
                m["content"] = content.strip()
                done("Chỉnh sửa bộ nhớ mẫu", "Bộ nhớ")
        accept = confirm(f"memory_delete_{m['id']}")
        if st.button("Xóa bộ nhớ mẫu"):
            if not accept:
                st.error("Cần xác nhận xóa.")
            else:
                data()["memory"].remove(m)
                done("Xóa bộ nhớ mẫu", "Bộ nhớ")


def knowledge():
    st.info("USR-11 · P2 · Chỉ quản lý metadata tài liệu trong phiên. Không đọc nội dung, embedding, indexing hoặc chạy RAG.")
    table(mine("knowledge"), "knowledge")
    with st.form("knowledge_upload"):
        file = st.file_uploader("Tài liệu thử nghiệm", type=["pdf", "docx", "txt"])
        title = st.text_input("Tên hiển thị")
        save = st.form_submit_button("Thêm tài liệu mẫu")
    if save:
        if file is None or not title.strip():
            st.error("Chọn tài liệu và nhập tên.")
        else:
            data()["knowledge"].append({"id": uid("DOC"), "user": current_user()["id"], "title": title.strip(), "filename": file.name, "bytes": file.size, "created": now(), "status": "Metadata mẫu; chưa xử lý RAG"})
            done("Thêm metadata tài liệu mẫu", "Tài liệu")
    doc = select_record(mine("knowledge"), "knowledge_edit")
    if doc:
        st.json(doc)
        with st.form(f"doc_rename_{doc['id']}"):
            name = st.text_input("Tên tài liệu", value=doc["title"])
            save = st.form_submit_button("Cập nhật tên mẫu")
        if save:
            if not name.strip():
                st.error("Tên tài liệu không được trống.")
            else:
                doc["title"] = name.strip()
                done("Cập nhật tên tài liệu mẫu", "Tài liệu")
        accept = confirm(f"knowledge_delete_{doc['id']}")
        if st.button("Xóa tài liệu mẫu"):
            if not accept:
                st.error("Cần xác nhận.")
            else:
                data()["knowledge"].remove(doc)
                done("Xóa metadata tài liệu mẫu", "Tài liệu")


def privacy_page():
    u = current_user()
    config = privacy(u["id"])
    st.caption("Không thu âm hay gửi dữ liệu đến dịch vụ AI. Khi tắt lưu lịch sử, tin nhắn chat vẫn tồn tại tạm trong phiên chat hiện tại nhưng không được đưa vào danh sách lịch sử.")
    with st.form("privacy"):
        history_enabled = st.checkbox("Cho phép lưu lịch sử hội thoại mẫu", value=config["history"])
        memory_enabled = st.checkbox("Đồng ý lưu bộ nhớ dài hạn (cờ mô phỏng)", value=config["memory"])
        save = st.form_submit_button("Lưu lựa chọn quyền riêng tư")
    if save:
        config.update(history=history_enabled, memory=memory_enabled)
        done("Cập nhật lựa chọn quyền riêng tư", "Quyền riêng tư")
    action = st.selectbox("Dữ liệu cần xóa", ["Lịch sử hội thoại", "Bộ nhớ dài hạn", "Tài liệu cá nhân", "Toàn bộ dữ liệu AI cá nhân"])
    accept = confirm("privacy_delete", "Xác nhận xóa dữ liệu mẫu đã chọn")
    if st.button("Xóa dữ liệu mẫu"):
        if not accept:
            st.error("Cần xác nhận thao tác xóa.")
        else:
            groups = {"Lịch sử hội thoại": ["conversations"], "Bộ nhớ dài hạn": ["memory"], "Tài liệu cá nhân": ["knowledge"], "Toàn bộ dữ liệu AI cá nhân": ["conversations", "memory", "knowledge", "usage"]}[action]
            for group in groups:
                data()[group] = [r for r in data()[group] if r["user"] != u["id"]]
            if "conversations" in groups:
                st.session_state.pop(f"temporary_chat_{u['id']}", None)
                st.session_state.pop(f"chat_selected_{u['id']}", None)
            if action == "Toàn bộ dữ liệu AI cá nhân":
                data()["personal_keys"].pop(u["id"], None)
                data()["assistant"].pop(u["id"], None)
            done(f"Xóa {action.lower()}", "Quyền riêng tư")


def usage():
    st.caption("USR-13 · P1 · Dữ liệu thống kê minh họa; không đo mức sử dụng hay chi phí thật.")
    rows = mine("usage")
    if not rows:
        st.info("Chưa có dữ liệu mẫu.")
        return
    chosen = st.multiselect("Provider", PROVIDERS, default=PROVIDERS)
    frame = pd.DataFrame([r for r in rows if r["provider"] in chosen])
    if frame.empty:
        st.info("Không có dữ liệu cho lựa chọn này.")
        return
    start, end = st.slider("Khoảng ngày mẫu trong tháng 10/2026", 1, 10, (1, 10))
    frame = frame[(pd.to_datetime(frame["date"]).dt.day >= start) & (pd.to_datetime(frame["date"]).dt.day <= end)]
    cols = st.columns(2)
    cols[0].metric("Phiên mẫu", int(frame["sessions"].sum()))
    cols[1].metric("Token mẫu", int(frame["tokens"].sum()))
    st.plotly_chart(px.bar(frame, x="date", y="tokens", color="provider", title="Sử dụng AI · mẫu"), width="stretch")
    table(frame.to_dict("records"), "usage", ["provider"])


def web_chat():
    u = current_user()
    selected_key = f"chat_selected_{u['id']}"
    private = not privacy(u["id"])["history"]
    st.markdown("""<style>
    .stApp:has(.st-key-chat_workspace) .brand{display:none}
    .st-key-chat_workspace{margin-top:0}
    .st-key-chat_history{border-right:1px solid var(--aiva-field-border);padding-right:18px;min-height:65vh}
    .st-key-chat_history .stButton button{text-align:left;justify-content:flex-start;border:0;background:transparent}
    .st-key-chat_history .stButton button:hover{background:#8172ff18}
    .st-key-chat_main{max-width:900px;margin:0 auto}
    .chat-welcome{text-align:center;padding:clamp(50px,13vh,150px) 8px 30px}
    .chat-welcome h2{font-size:clamp(24px,2.4vw,34px)!important;font-weight:600}
    .chat-welcome p{color:var(--aiva-field-muted);font-size:15px}
    .st-key-chat_main [data-testid="stChatMessage"]{border:0;background:transparent;padding:16px 4px}
    .st-key-chat_main [data-testid="stChatMessage"]:has([data-testid="stChatMessageAvatarUser"]){background:#8172ff12;border-radius:20px}
    .st-key-chat_main [data-testid="stChatInput"]{border-radius:24px!important}
    @media(max-width:700px){.st-key-chat_history{min-height:0;border:0}.chat-welcome{padding-top:35px}}
    </style>""", unsafe_allow_html=True)
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
                for chat in chats:
                    if query.casefold() not in chat["title"].casefold():
                        continue
                    if st.button(chat["title"], key=f"open_{chat['id']}", width="stretch", type="primary" if st.session_state.get(selected_key) == chat["id"] else "secondary"):
                        st.session_state[selected_key] = chat["id"]
                        st.rerun()
        with messages, st.container(key="chat_main"):
            render_chat()


def render_chat():
    u = current_user()
    allowed = allowed_providers()
    if not allowed:
        st.warning("Không có Provider được Admin cho phép.")
        return
    private = not privacy(u["id"])["history"]
    selected_key = f"chat_selected_{u['id']}"
    chat = (st.session_state.get(f"temporary_chat_{u['id']}") if private else
            next((c for c in mine("conversations") if c["id"] == st.session_state.get(selected_key)), None))
    pref = preferences(u["id"])
    top, actions = st.columns([2, 3])
    with top:
        selected_provider = st.selectbox("Provider cho phiên mới", allowed,
            index=allowed.index(pref["provider"]) if pref["provider"] in allowed else 0,
            label_visibility="collapsed", key="chat_provider")
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
        st.markdown('<div class="chat-welcome"><h2>Hôm nay bạn muốn làm gì?</h2><p>Trò chuyện cùng AIVA, khám phá AI và robot của bạn.</p></div>', unsafe_allow_html=True)
    else:
        with st.container(height=430, border=False, key="chat_messages"):
            for message in chat["messages"]:
                with st.chat_message(message["role"]):
                    st.write(message["content"])
    search = st.checkbox("Internet Search (mô phỏng)", key="chat_search")
    can_chat = not chat or (chat["active"] and chat["provider"] in allowed)
    if chat and chat["provider"] not in allowed:
        st.warning("Provider của hội thoại đã bị tắt. Hãy mở đoạn chat mới.")
    elif chat and not chat["active"]:
        st.caption("Hội thoại đã kết thúc. Chọn tiếp tục trong menu ⋯ hoặc mở đoạn chat mới.")
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
        content = ("KẾT QUẢ INTERNET SEARCH MẪU: Đây là bản minh họa kết quả tìm kiếm, chưa truy cập Internet." if search else f"PHẢN HỒI AI MẪU ({chat['provider']}): Đã nhận tin nhắn của bạn. Đây là câu trả lời cố định phục vụ kiểm tra giao diện.")
        chat["messages"].append({"role": "assistant", "content": content})
        st.rerun()


ROUTES = {
    "Robot của tôi": robots,
    "Trợ lý AI": assistant,
    "AI Provider": provider,
    "Personal API Key": personal_keys,
    "Lịch sử hội thoại": history,
    "Bộ nhớ dài hạn": memory,
    "Tài liệu cá nhân": knowledge,
    "Quyền riêng tư": privacy_page,
    "Thống kê sử dụng": usage,
    "Website AI Chat": web_chat,
    "Tài khoản": account,
}
