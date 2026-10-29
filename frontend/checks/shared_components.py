"""Kiểm tra hợp đồng import và chiều phụ thuộc của shared components."""
import ast
import importlib
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

ALIASES = {
    "ui.common": {
        "page_header": "thanh_phan.bo_cuc.tieu_de",
        "panel": "thanh_phan.dung_chung.khung_noi_dung",
        "render_frame": "thanh_phan.dung_chung.bang_du_lieu",
        "table": "thanh_phan.dung_chung.bang_du_lieu",
        "select_record": "thanh_phan.dung_chung.bang_du_lieu",
        "confirm": "thanh_phan.bieu_mau.xac_nhan",
    },
    "ui.theme_switch": {
        "render_theme_switch": "thanh_phan.dung_chung.nut_chuyen_chu_de",
    },
    "ui.user": {
        "account": "thanh_phan.dung_chung.bieu_mau_tai_khoan",
        "key_manager": "thanh_phan.dung_chung.quan_ly_khoa_api",
    },
}


class SharedComponentContracts(unittest.TestCase):
    def test_legacy_imports_are_same_implementation(self):
        for legacy, names in ALIASES.items():
            module = importlib.import_module(legacy)
            for name, destination in names.items():
                with self.subTest(legacy=legacy, function=name):
                    implementation = getattr(importlib.import_module(destination), name)
                    self.assertIs(getattr(module, name), implementation)
                    self.assertEqual(implementation.__module__, destination)

    def test_components_do_not_depend_on_legacy_pages(self):
        for path in (ROOT / "thanh_phan").rglob("*.py"):
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                names = ([node.module] if isinstance(node, ast.ImportFrom)
                         else [alias.name for alias in node.names]
                         if isinstance(node, ast.Import) else [])
                for name in names:
                    self.assertFalse(name == "ui" or name and name.startswith("ui."),
                                     f"Phụ thuộc ngược: {path}: {name}")

    def test_legacy_modules_do_not_duplicate_moved_functions(self):
        for legacy, names in ALIASES.items():
            path = ROOT.joinpath(*legacy.split(".")).with_suffix(".py")
            definitions = {node.name for node in ast.parse(path.read_text(encoding="utf-8")).body
                           if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
            self.assertFalse(definitions.intersection(names))


if __name__ == "__main__":
    unittest.main()
