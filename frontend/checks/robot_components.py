"""Kiểm tra compatibility và cache dùng chung của thành phần robot Python."""
import ast
import importlib
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class RobotComponentContracts(unittest.TestCase):
    def test_expression_selector_requires_explicit_page_context(self):
        from thanh_phan.robot.tai_lieu_3d import build_document
        hidden = build_document()
        visible = build_document(show_expressions=True)
        self.assertIn('class="expression-demo" hidden', hidden)
        self.assertNotIn('class="expression-demo" hidden', visible)
        self.assertEqual(hidden.replace('class="expression-demo" hidden', 'class="expression-demo"', 1), visible)
        for document in (hidden, visible):
            self.assertIn('aria-label="Điều khiển robot" hidden', document)

    def test_old_imports_share_actual_implementation(self):
        for old, new, names in [
            ("ui.motion", "thanh_phan.robot.khung_hien_thi", ["render_robot_scene"]),
            ("ui.aiva3d", "thanh_phan.robot.tai_lieu_3d",
             ["ASSETS", "_read_asset", "asset", "build_document"]),
            ("ui.robot", "thanh_phan.robot.du_phong", ["ROBOT"]),
        ]:
            legacy, target = importlib.import_module(old), importlib.import_module(new)
            for name in names:
                self.assertIs(getattr(legacy, name), getattr(target, name))

    def test_asset_location_and_cache_are_shared(self):
        legacy = importlib.import_module("ui.aiva3d")
        target = importlib.import_module("thanh_phan.robot.tai_lieu_3d")
        self.assertEqual(target.ASSETS, ROOT / "ui/assets/aiva3d")
        self.assertEqual(target._read_asset.cache_parameters(), {"maxsize": 8, "typed": False})
        before = target._read_asset.cache_info()
        self.assertEqual(legacy.asset("template.html"), target.asset("template.html"))
        self.assertGreater(target._read_asset.cache_info().hits, before.hits)

    def test_no_duplicate_legacy_functions_or_reverse_imports(self):
        for name in ["motion", "aiva3d", "robot"]:
            tree = ast.parse((ROOT / f"ui/{name}.py").read_text(encoding="utf-8"))
            self.assertFalse(any(isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                                 for n in tree.body))
        for path in (ROOT / "thanh_phan/robot").glob("*.py"):
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                names = ([node.module] if isinstance(node, ast.ImportFrom)
                         else [a.name for a in node.names] if isinstance(node, ast.Import) else [])
                for name in names:
                    self.assertFalse(name == "ui" or name and name.startswith("ui."), str(path))


if __name__ == "__main__":
    unittest.main()
