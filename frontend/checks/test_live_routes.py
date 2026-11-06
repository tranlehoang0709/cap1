"""Verify retired routes cannot bypass authentication or fabricate data."""
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.modules.setdefault('streamlit', types.SimpleNamespace(session_state={}))
from giao_dien import ket_noi, live
from nen_tang import trang_thai
from nen_tang.backend import BackendError


class LiveRouteTests(unittest.TestCase):
    def test_nullable_backend_field_uses_form_default(self):
        self.assertEqual(live.field({"voice_code": None}, "voice_code"), "")
        self.assertEqual(live.field({"language_code": None}, "language_code", "vi"), "vi")
        self.assertIsNone(live.optional_text(None))
        self.assertIsNone(live.optional_text("  "))
        self.assertEqual(live.optional_text(" Xiaozhi "), "Xiaozhi")

    def test_no_session_store_can_be_created(self):
        with self.assertRaises(RuntimeError):
            trang_thai.init_demo()
        with self.assertRaises(RuntimeError):
            trang_thai.data()

    def test_admin_page_requires_backend_admin(self):
        with patch.object(ket_noi, 'api', return_value={'role': 'USER'}), \
             patch.object(ket_noi, 'st', types.SimpleNamespace(error=Mock())), \
             patch.object(live, 'users_admin') as page:
            ket_noi.render('users_admin', admin=True)
            page.assert_not_called()

    def test_auth_failure_is_visible_and_does_not_render(self):
        error = BackendError(401, 'Unauthorized')
        with patch.object(ket_noi, 'api', side_effect=error), \
             patch.object(live, 'api_error') as report, \
             patch.object(live, 'history_page') as page:
            ket_noi.render('history_page')
            report.assert_called_once_with(error)
            page.assert_not_called()

    def test_dashboard_receives_backend_identity(self):
        account = {'id': '123', 'role': 'USER', 'display_name': 'Actual user'}
        with patch.object(ket_noi, 'api', return_value=account) as api, \
             patch.object(live, 'dashboard_user') as page:
            ket_noi.render('dashboard_user')
            api.assert_called_once_with('/auth/me')
            page.assert_called_once_with(account)

    def test_old_chat_routes_use_live_unavailable_state(self):
        from giao_dien.nguoi_dung import tro_chuyen_ai
        with patch.object(ket_noi, 'api', return_value={'role': 'USER'}), \
             patch.object(live, 'chat_page') as page:
            tro_chuyen_ai.render_chat()
            page.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
