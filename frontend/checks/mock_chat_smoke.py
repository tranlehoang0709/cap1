"""Real FE AppTest + HTTP smoke. Called only by tools/mock_chat/run.py.

No patched API calls, fake Streamlit modules, demo login or live provider.
"""
import json
from pathlib import Path
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch
import streamlit as st
from streamlit.testing.v1 import AppTest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
EXPECTED = "[MOCK] AIVA fixture response from FastAPI."

def clean(app):
    assert not app.exception, [e.message for e in app.exception]
    return app

def widget(elements, label):
    return next(item for item in elements if item.label == label)

def http(base, path, body=None, token=None):
    headers={"Content-Type":"application/json"}
    if token: headers["Authorization"]="Bearer "+token
    req=Request(base+path,headers=headers,data=None if body is None else json.dumps(body).encode())
    try:
        with urlopen(req,timeout=10) as response:return response.status,json.load(response)
    except HTTPError as error:return error.code,json.load(error)

def verify_success(base):
    assert http(base,"/web-chat/messages",{"content":"synthetic question"})[0]==401
    app=clean(AppTest.from_file(str(ROOT/"app.py"),default_timeout=20).run())
    widget(app.text_input,"Email").set_value("mock-user@example.test")
    widget(app.text_input,"Mật khẩu").set_value("wrong-password")
    widget(app.button,"Đăng nhập").click().run()
    clean(app);assert app.error
    widget(app.text_input,"Mật khẩu").set_value("MockOnly-Password-2026!")
    widget(app.button,"Đăng nhập").click().run()
    clean(app);assert app.session_state["access_token"]
    assert len(widget(app.sidebar.radio,"Điều hướng").options)==8
    widget(app.sidebar.radio,"Điều hướng").set_value("AI Chat").run()
    clean(app);assert not app.chat_input[0].disabled
    with patch.object(st,"spinner",wraps=st.spinner) as spinner:
        app.chat_input[0].set_value("SYNTHETIC MOCK QUESTION D4-S1-05").run()
        clean(app)
        assert any("Đang chờ phản hồi" in str(c) for c in spinner.call_args_list)
    assert any(EXPECTED in item.value for item in app.markdown)
    token=app.session_state["access_token"]
    assert http(base,"/web-chat/messages",{"content":"fixture","userId":"8"},token)[0]==400
    status,value=http(base,"/conversations/11",token=token)
    assert status==200 and value["user_id"]=="7"
    assert value["messages"][-1]["content"]==EXPECTED
    assert http(base,"/conversations/99",token=token)[0]==404
    assert "demo" not in app.session_state
    return app

def verify_ai_disconnected(app):
    before=app.session_state["api_chat_result_7"]
    app.chat_input[0].set_value("SYNTHETIC DISCONNECTED QUESTION").run()
    clean(app);assert app.error
    assert app.session_state["api_chat_result_7"]==before
    assert any(EXPECTED in item.value for item in app.markdown)

def verify_backend_disconnected(app):
    clean(app.run())
    assert app.error
