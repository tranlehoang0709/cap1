"""Kiểm tra ranh giới import và compatibility sau cleanup an toàn."""
import ast
import importlib
import importlib.util
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class LegacyCleanupContracts(unittest.TestCase):
    def test_active_application_does_not_import_legacy(self):
        paths = [ROOT / "app.py"]
        for package in ["nen_tang", "giao_dien", "thanh_phan"]:
            paths.extend((ROOT / package).rglob("*.py"))
        for path in paths:
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8-sig"))):
                modules = ([node.module] if isinstance(node, ast.ImportFrom)
                           else [a.name for a in node.names] if isinstance(node, ast.Import) else [])
                for module in modules:
                    self.assertFalse(module == "ui" or module and module.startswith("ui."), str(path))

    def test_auth_and_registry_compatibility_keep_identity(self):
        old = importlib.import_module("ui.auth")
        new = importlib.import_module("giao_dien.xac_thuc.dang_nhap")
        for name in ["render", "render_forms"]:
            self.assertIs(getattr(old, name), getattr(new, name))
        old = importlib.import_module("ui.portal")
        new = importlib.import_module("giao_dien.dinh_tuyen")
        for name in ["USER_ROUTES", "ADMIN_ROUTES"]:
            self.assertIs(getattr(old, name), getattr(new, name))
            self.assertEqual(len(getattr(new, name)), 8)

    def test_local_import_modules_resolve(self):
        for package in ["ui", "nen_tang", "giao_dien", "thanh_phan", "checks"]:
            for path in (ROOT / package).rglob("*.py"):
                for node in ast.walk(ast.parse(path.read_text(encoding="utf-8-sig"))):
                    modules = ([node.module] if isinstance(node, ast.ImportFrom)
                               else [a.name for a in node.names] if isinstance(node, ast.Import) else [])
                    for module in modules:
                        if module and module.split(".")[0] in ["ui", "nen_tang", "giao_dien", "thanh_phan"]:
                            self.assertIsNotNone(importlib.util.find_spec(module), f"{path}: {module}")


if __name__ == "__main__":
    unittest.main()
