"""Kiểm tra hợp đồng import và ranh giới phụ thuộc của các trang User."""
import ast
import importlib
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
PAGES = "giao_dien.nguoi_dung."
USER = {
    "thiet_bi": ["robots"],
    "cau_hinh_tro_ly": ["assistant", "provider"],
    "lich_su_hoi_thoai": ["history", "memory", "knowledge"],
    "bang_dieu_khien": ["usage"],
    "tro_chuyen_ai": ["web_chat", "render_chat"],
    "khoa_api_ca_nhan": ["personal_keys"],
    "quyen_rieng_tu": ["privacy_page"],
}


class UserPageContracts(unittest.TestCase):
    def test_old_imports_are_actual_implementations(self):
        legacy = importlib.import_module("ui.user")
        for module, names in USER.items():
            target = importlib.import_module(PAGES + module)
            for name in names:
                self.assertIs(getattr(legacy, name), getattr(target, name))
        portal = importlib.import_module("ui.portal")
        for module, name, exported in [
            ("bang_dieu_khien", "dashboard_user", "dashboard_user"),
            ("thiet_bi", "robot_cards", "robot_cards"),
            ("thiet_bi", "devices_user", "devices_user"),
            ("cau_hinh_tro_ly", "render_page", "assistant"),
            ("lich_su_hoi_thoai", "render_page", "history"),
        ]:
            self.assertIs(getattr(portal, exported),
                          getattr(importlib.import_module(PAGES + module), name))

    def test_no_reverse_page_imports(self):
        for path in (ROOT / "giao_dien").rglob("*.py"):
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                modules = ([node.module] if isinstance(node, ast.ImportFrom)
                           else [a.name for a in node.names] if isinstance(node, ast.Import) else [])
                for module in modules:
                    # API robot giữ nguyên tại ui.motion cho tới giai đoạn riêng.
                    self.assertFalse(module == "ui" or module and module.startswith("ui.")
                                     and module != "ui.motion", str(path))

    def test_legacy_user_contains_no_duplicate_functions(self):
        tree = ast.parse((ROOT / "ui/user.py").read_text(encoding="utf-8"))
        self.assertFalse(any(isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                             for n in tree.body))


if __name__ == "__main__":
    unittest.main()
