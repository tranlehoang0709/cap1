"""Copy reviewed, existing AIVA Three.js assets into this app only. No rebuilding."""
import ast
import shutil
from pathlib import Path

app = Path(__file__).resolve().parents[1]
frontend = app.parent
source = frontend / 'ui/assets/aiva3d'
target = app / 'public/robot'
target.mkdir(parents=True, exist_ok=True)
fallback = ''
tree = ast.parse((frontend / 'thanh_phan/robot/du_phong.py').read_text(encoding='utf-8'))
for node in tree.body:
    if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'ROBOT' for t in node.targets):
        fallback = ast.literal_eval(node.value)
template = (source / 'template.html').read_text(encoding='utf-8')
values = {'STYLE': (source / 'style.css').read_text(encoding='utf-8'), 'THEME': 'dark hero',
          'CONFIG': '{"hero":true,"online":false,"paused":false}', 'FALLBACK': fallback,
          'DIAGNOSTICS': '', 'BUNDLE': ''}
for key, value in values.items():
    template = template.replace('__' + key + '__', value)
template = template.replace('</body>', '<script src="diagnostics.js"></script><script src="robot.bundle.js"></script></body>')
template = template.replace('class="expression-demo" hidden', 'class="expression-demo"')
template = template.replace('<footer><span>', '<footer><span hidden>')
(target / 'index.html').write_text(template, encoding='utf-8')
for name in ['diagnostics.js', 'robot.bundle.js', 'THREE-LICENSE.txt']:
    shutil.copyfile(source / name, target / name)
print('Prepared local robot assets in frontend/next-app/public/robot')
