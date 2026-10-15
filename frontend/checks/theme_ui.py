"""UI state/rerun and semantic palette checks; no browser/CSS layout claims."""
import ast
from smoke import ROOT, clean, login, navigate, widget
from streamlit.testing.v1 import AppTest


def luminance(color):
    channels = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return sum(c * weight for c, weight in zip(linear, (0.2126, 0.7152, 0.0722)))


def contrast(a, b):
    low, high = sorted((luminance(a), luminance(b)))
    return (high + 0.05) / (low + 0.05)


# Read the actual semantic palette, rather than copying its color values here.
tree = ast.parse((ROOT / 'nen_tang' / 'chu_de.py').read_text(encoding='utf-8'))
palette = next(node.value for node in ast.walk(tree) if isinstance(node, ast.Assign)
               and any(isinstance(target, ast.Name) and target.id == 'palette' for target in node.targets))
for light in (False, True):
    colors = eval(compile(ast.Expression(palette), '<palette>', 'eval'), {'__builtins__': {}}, {'light': light})
    assert contrast(colors['text'], colors['surface']) >= 4.5
    assert contrast(colors['muted'], colors['surface']) >= 4.5
    assert contrast('#fdfdfe', colors['button']) >= 4.5
    assert contrast(colors['control-border'], colors['surface']) >= 3
    assert contrast(colors['muted'], colors['raised']) >= 4.5
    assert contrast(colors['text'], colors['tint']) >= 4.5
print('PASS: actual palette text, placeholders, primary buttons and field boundaries meet contrast thresholds')

for email in ['user@example.test', 'admin@example.test']:
    app = clean(AppTest.from_file(str(ROOT / 'app.py'), default_timeout=30).run())
    for dark in [False, True]:
        app.toggle(key='aiva_theme_switch').set_value(dark)
        clean(app.run())
        assert app.title[0].value
        assert len([m for m in app.markdown if '<div class="brand">' in m.value]) == 1
    login(app, email)
    pages = list(widget(app.sidebar.radio, 'Điều hướng').options)
    for dark in [False, True, False]:
        app.toggle(key='aiva_theme_switch').set_value(dark)
        clean(app.run())
        for page in pages:
            navigate(app, page)
            # Verify the emitted frontend document, not just session_state.
            # Browser computed styles and layout still need browser verification.
            theme_documents = [element.proto.body for element in app.get('html')
                               if 'id="aiva-application-theme"' in element.proto.body]
            assert len(theme_documents) == 1
            document = theme_documents[0]
            assert f"color-scheme:{'dark' if dark else 'light'}" in document
            assert f"--aiva-surface:{'#191e2a' if dark else '#fdfdfe'}" in document
            assert 'stNumberInputContainer' in document and 'stMultiSelectDropdown' in document
            assert app.title[0].value == page
            assert len([element for element in app.get('html') if '<div class="brand">' in element.proto.body]) == 1
            for select in app.selectbox:
                assert select.index is None or 0 <= select.index < len(select.options)
            clean(app.run())
            assert widget(app.sidebar.radio, 'Điều hướng').value == page
            assert app.session_state['appearance'] == ('🌙 Tối' if dark else '☀️ Sáng')
    print(f'PASS: {email}, {len(pages)} routes, light/dark/light, headers, select values, navigation and reruns')
