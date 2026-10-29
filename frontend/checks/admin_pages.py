"""Kiểm tra re-export và ranh giới phụ thuộc của các trang Quản trị."""
import ast
import importlib
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
PAGES = "giao_dien.quan_tri."
MAPPING = {
    "bang_dieu_khien": ["dashboard"],
    "quan_ly_nguoi_dung": ["users", "roles"],
    "quan_ly_thiet_bi": ["devices", "telemetry"],
    "quan_ly_ai": ["providers", "server"],
    "khoa_api_va_han_muc": ["system_keys", "quotas"],
    "firmware_ota": ["firmware"],
    "nhat_ky_giam_sat": ["logs", "resources"],
    "cau_hinh_he_thong": ["settings"],
}


class AdminPageContracts(unittest.TestCase):
    def test_legacy_functions_keep_same_implementation(self):
        legacy = importlib.import_module("ui.admin")
        for module, names in MAPPING.items():
            target = importlib.import_module(PAGES + module)
            for name in names:
                self.assertIs(getattr(legacy, name), getattr(target, name))
        portal = importlib.import_module("ui.portal")
        for module, name, exported in [
            ("bang_dieu_khien", "dashboard_admin", "dashboard_admin"),
            ("quan_ly_nguoi_dung", "render_page", "users"),
            ("quan_ly_thiet_bi", "devices_admin", "devices_admin"),
            ("quan_ly_ai", "ai", "ai"),
            ("khoa_api_va_han_muc", "keys", "keys"),
            ("nhat_ky_giam_sat", "monitoring", "monitoring"),
            ("cau_hinh_he_thong", "render_page", "settings"),
        ]:
            self.assertIs(getattr(portal, exported),
                          getattr(importlib.import_module(PAGES + module), name))

    def test_no_legacy_imports_in_admin_pages(self):
        for path in (ROOT / "giao_dien/quan_tri").rglob("*.py"):
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                modules = ([node.module] if isinstance(node, ast.ImportFrom)
                           else [a.name for a in node.names] if isinstance(node, ast.Import) else [])
                for module in modules:
                    self.assertFalse(module == "ui" or module and module.startswith("ui."), str(path))

    def test_legacy_modules_do_not_duplicate_admin_functions(self):
        for name in ["admin", "portal"]:
            tree = ast.parse((ROOT / f"ui/{name}.py").read_text(encoding="utf-8"))
            self.assertFalse(any(isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) for n in tree.body))


if __name__ == "__main__":
    unittest.main()
