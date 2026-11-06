"""Static privacy and scope checks for the User Wi-Fi setup wizard."""
import ast
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "giao_dien" / "live.py"


class WifiSetupContract(unittest.TestCase):
    def test_wizard_uses_owned_device_list_and_direct_local_portal(self):
        source = SOURCE.read_text(encoding="utf-8")
        tree = ast.parse(source)
        function = next(node for node in tree.body
                        if isinstance(node, ast.FunctionDef) and node.name == "user_devices")
        calls = [node for node in ast.walk(function) if isinstance(node, ast.Call)]
        backend_paths = [node.args[0].value for node in calls
                         if isinstance(node.func, ast.Name) and node.func.id == "call"
                         and node.args and isinstance(node.args[0], ast.Constant)
                         and isinstance(node.args[0].value, str)]
        self.assertIn("/devices", backend_paths)
        self.assertFalse(any("wifi" in path.lower() for path in backend_paths))
        self.assertIn('"http://192.168.4.1"', source)
        self.assertIn("không đi qua website AIVA-IoT hoặc Backend", source)

    def test_wifi_password_is_not_a_frontend_input(self):
        tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
        function = next(node for node in tree.body
                        if isinstance(node, ast.FunctionDef) and node.name == "user_devices")
        for node in ast.walk(function):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
                continue
            if node.func.attr != "text_input":
                continue
            if node.args and isinstance(node.args[0], ast.Constant):
                label = str(node.args[0].value).lower()
                self.assertNotIn("wi-fi password", label)
                self.assertNotIn("mật khẩu wi-fi", label)


if __name__ == "__main__":
    unittest.main()
