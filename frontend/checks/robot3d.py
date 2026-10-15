"""Test actual Streamlit iframe integration; does not test browser WebGL pixels."""
import inspect
import json
import re
from smoke import ROOT, clean, login, navigate
from streamlit.testing.v1 import AppTest
from ui.aiva3d import build_document
from ui.motion import render_robot_scene
from ui.robot import ROBOT


def configuration(document):
    return json.loads(re.search(r'<script id="aiva-config" type="application/json">(.*?)</script>', document, re.S)[1])


signature = inspect.signature(render_robot_scene)
assert list(signature.parameters) == ["hero", "online"]
assert signature.parameters["hero"].default is False
assert signature.parameters["online"].default is True
for hero in (False, True):
    for online in (False, True):
        for light in (False, True):
            for paused in (False, True):
                document = build_document(hero=hero, online=online, light=light, paused=paused)
                assert configuration(document) == dict(hero=hero, online=online, paused=paused)
                assert ROBOT in document  # Original art preserved for WebGL fallback.
                assert '__BUNDLE__' not in document and '__CONFIG__' not in document
                assert '__DIAGNOSTICS__' not in document
                assert document.index('Runs before the bundle') < document.rindex('<script>')
                assert '<script src=' not in document and '<script type="module"' not in document
                assert re.search(r'<body class="dark', document)
                assert document == build_document(hero=hero, online=online, light=not light, paused=paused)
print('PASS: 16 iframe configurations; self-contained bundle; original SVG fallback')

app = clean(AppTest.from_file(str(ROOT / 'app.py'), default_timeout=30).run())
assert len(app.get('iframe')) == 1
assert configuration(app.get('iframe')[0].proto.srcdoc)['hero']
login_document = app.get('iframe')[0].proto.srcdoc
for dark in (False, True):
    app.toggle(key='aiva_theme_switch').set_value(dark)
    clean(app.run())
    assert app.get('iframe')[0].proto.srcdoc == login_document
app.toggle(key='aiva_pause_robot').set_value(True)
clean(app.run())
assert configuration(app.get('iframe')[0].proto.srcdoc)['paused']
app.toggle(key='aiva_pause_robot').set_value(False)
clean(app.run())
login(app, 'user@example.test')
assert len(app.get('iframe')) == 1
assert not configuration(app.get('iframe')[0].proto.srcdoc)['hero']
dashboard_document = app.get('iframe')[0].proto.srcdoc
for dark in (False, True):
    app.toggle(key='aiva_theme_switch').set_value(dark)
    clean(app.run())
    assert app.get('iframe')[0].proto.srcdoc == dashboard_document
navigate(app, 'Thiết bị của tôi')
assert len(app.get('iframe')) == 3
assert [configuration(element.proto.srcdoc)['online'] for element in app.get('iframe')] == [True, True, False]
stable_documents = [element.proto.srcdoc for element in app.get('iframe')]
for dark in (False, True):
    app.toggle(key='aiva_theme_switch').set_value(dark)
    clean(app.run())
    assert [element.proto.srcdoc for element in app.get('iframe')] == stable_documents
    assert app.session_state['appearance'] == ('🌙 Tối' if dark else '☀️ Sáng')
print('PASS: login hero, pause, dashboard card, online/offline device cards and both themes')
