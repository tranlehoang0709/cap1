"""Behavior checks with Streamlit's own testing API; no external services."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from streamlit.testing.v1 import AppTest


def clean(app):
    assert not app.exception, [e.message for e in app.exception]
    return app


def widget(elements, label):
    return next(e for e in elements if e.label == label)


def login(app, email):
    widget(app.text_input, "Email").set_value(email)
    widget(app.text_input, "Mật khẩu").set_value("Demo123!")
    widget(app.button, "Đăng nhập mẫu").click()
    return clean(app.run())


def navigate(app, page):
    widget(app.sidebar.radio, "Điều hướng").set_value(page)
    return clean(app.run())


def logout(app):
    widget(app.sidebar.button, "Đăng xuất").click()
    return clean(app.run())


def main():
    app = clean(AppTest.from_file(str(ROOT / "app.py"), default_timeout=30).run())
    login(app, "admin@example.test")
    admin_pages = list(widget(app.sidebar.radio, "Điều hướng").options)
    assert len(admin_pages) == 8
    for page in admin_pages:
        navigate(app, page)
    print("PASS: 8 Admin pages render")
    navigate(app, "API Key & Quota")
    widget(app.text_input, "Chuỗi API Key thử nghiệm").set_value("demo-system-key")
    widget(app.button, "Thêm / thay thế khóa mẫu").click()
    clean(app.run())
    logout(app)
    login(app, "user@example.test")
    user_pages = list(widget(app.sidebar.radio, "Điều hướng").options)
    assert len(user_pages) == 8
    for page in user_pages:
        navigate(app, page)
    print("PASS: 8 User pages render")
    navigate(app, "API Key cá nhân")
    assert any("Chưa có khóa mẫu" in e.value for e in app.info)
    widget(app.text_input, "Chuỗi API Key thử nghiệm").set_value("demo-personal-key")
    widget(app.button, "Thêm / thay thế khóa mẫu").click()
    clean(app.run())
    d = app.session_state["demo"]
    assert d["personal_keys"]["user1"]["OpenAI"]["value"] == "demo-personal-key"
    assert d["system_keys"]["OpenAI"]["value"] == "demo-system-key"
    assert all("demo-personal-key" not in r["event"] and "demo-system-key" not in r["event"] for r in d["logs"])
    print("PASS: System/Personal keys isolated and absent from audit")
    navigate(app, "Lịch sử hội thoại")
    count = len(d["conversations"])
    widget(app.button, "Xóa hội thoại mẫu").click()
    clean(app.run())
    assert len(app.session_state["demo"]["conversations"]) == count
    assert app.error
    print("PASS: destructive action requires confirmation")
    navigate(app, "AI Chat")
    widget(app.button, "＋ Đoạn chat mới").click()
    clean(app.run())
    app.chat_input[0].set_value("Xin chào thử nghiệm").run()
    clean(app)
    chat = app.session_state["demo"]["conversations"][-1]
    assert len(chat["messages"]) == 2
    assert "MẪU" in chat["messages"][-1]["content"]
    widget(app.button, "Kết thúc phiên chat").click()
    clean(app.run())
    assert not app.session_state["demo"]["conversations"][-1]["active"]
    assert app.chat_input[0].disabled
    print("PASS: chat session, labelled mock reply and ending")
    navigate(app, "Quyền riêng tư")
    widget(app.checkbox, "Cho phép lưu lịch sử hội thoại mẫu").uncheck()
    widget(app.button, "Lưu lựa chọn quyền riêng tư").click()
    clean(app.run())
    navigate(app, "AI Chat")
    count = len(app.session_state["demo"]["conversations"])
    widget(app.button, "＋ Đoạn chat mới").click()
    clean(app.run())
    app.chat_input[0].set_value("Tin nhắn riêng tư mẫu").run()
    clean(app)
    assert len(app.session_state["demo"]["conversations"]) == count
    widget(app.button, "Kết thúc phiên chat").click()
    clean(app.run())
    assert "temporary_chat_user1" not in app.session_state
    navigate(app, "Quyền riêng tư")
    widget(app.checkbox, "Cho phép lưu lịch sử hội thoại mẫu").check()
    widget(app.button, "Lưu lựa chọn quyền riêng tư").click()
    clean(app.run())
    navigate(app, "AI Chat")
    print("PASS: private chat excluded from history, discarded at end, mode switch works")
    logout(app)
    login(app, "new@example.test")
    assert len(widget(app.sidebar.radio, "Điều hướng").options) == 8
    navigate(app, "Thiết bị của tôi")
    widget(app.text_input, "Mã ghép nối robot").set_value("PAIR002")
    widget(app.button, "Gửi yêu cầu mẫu").click()
    clean(app.run())
    assert any(r["user"] == "user2" and r["device"] == "XB-002" and r["status"] == "Chờ duyệt" for r in app.session_state["demo"]["requests"])
    print("PASS: unapproved user can view portal and can request pairing")
    logout(app)
    login(app, "admin@example.test")
    navigate(app, "Quản lý thiết bị")
    widget(app.selectbox, "Yêu cầu chờ duyệt").set_value("REQ-001")
    clean(app.run())
    widget(app.checkbox, "Xác nhận quyết định cho robot này").check()
    widget(app.button, "Xác nhận mẫu").click()
    clean(app.run())
    d = app.session_state["demo"]
    assert next(r for r in d["devices"] if r["id"] == "XB-003")["owner"] == "user2"
    assert next(r for r in d["devices"] if r["id"] == "XB-002")["owner"] is None
    logout(app)
    login(app, "new@example.test")
    assert "AI Chat" in widget(app.sidebar.radio, "Điều hướng").options
    navigate(app, "API Key cá nhân")
    assert any("Chưa có khóa mẫu" in e.value for e in app.info)
    assert not app.session_state["demo"]["personal_keys"].get("user2")
    print("PASS: approval is per robot; approved user unlocked; User keys isolated")
    navigate(app, "Thiết bị của tôi")
    widget(app.checkbox, "Xác nhận hủy liên kết robot; nếu đây là robot cuối, các trang AI sẽ đóng").check()
    widget(app.button, "Hủy liên kết mẫu").click()
    clean(app.run())
    assert not any(r["owner"] == "user2" for r in app.session_state["demo"]["devices"])
    print("PASS: unlinking final robot removes ownership")
    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    main()
