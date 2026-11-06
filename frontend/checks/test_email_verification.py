"""Targeted verification UI fixtures; never evidence of live email ownership."""
import sys
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from streamlit.testing.v1 import AppTest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from giao_dien import live
from nen_tang.backend import BackendError
from nen_tang import email_verification
APP='from giao_dien.live import login_screen\nlogin_screen()'

class VerificationTests(unittest.TestCase):
    def test_resend_uses_public_endpoint_and_never_displays_a_token(self):
        app=AppTest.from_string(APP).run()
        next(i for i in app.text_input if i.label=='Email cần xác minh').set_value('unit@example.invalid')
        with patch.object(live,'api',return_value={'message':'Nếu tài khoản đủ điều kiện, hướng dẫn xác minh sẽ được gửi.'}) as api:
            next(b for b in app.button if b.label=='Gửi lại hướng dẫn xác minh').click().run()
            api.assert_called_once_with('/auth/resend-verification','POST',{'email':'unit@example.invalid'},auth=False)
        self.assertFalse(app.exception)
        self.assertTrue(any('Nếu tài khoản đủ điều kiện' in e.value for e in app.info))
        self.assertEqual(len(app.success),0)
    def test_resend_unavailable_and_rate_limit_are_visible(self):
        for status,word in [(503,'Kênh gửi'),(429,'giới hạn')]:
            app=AppTest.from_string(APP).run()
            next(i for i in app.text_input if i.label=='Email cần xác minh').set_value('unit@example.invalid')
            with patch.object(live,'api',side_effect=BackendError(status,'sanitized')):
                next(b for b in app.button if b.label=='Gửi lại hướng dẫn xác minh').click().run()
            self.assertFalse(app.exception)
            self.assertTrue(any(word in e.value for e in app.warning))
    def test_expired_verification_does_not_report_success(self):
        app=AppTest.from_string(APP).run()
        next(i for i in app.text_input if i.label=='Mã xác minh email').set_value('unit-only-expired')
        with patch.object(live,'api',side_effect=BackendError(400,'Invalid or expired')):
            next(b for b in app.button if b.label=='Xác minh email').click().run()
        self.assertFalse(app.exception)
        self.assertTrue(any('hết hạn' in e.value for e in app.warning))
        self.assertEqual(len(app.success),0)
    def test_fragment_received_in_ram_requires_explicit_confirmation(self):
        with patch.object(email_verification,'_fragment',return_value=SimpleNamespace(received={'token':'fixture-only.payload-only.signature-only'})),patch.object(live,'api') as api:
            app=AppTest.from_string(APP).run()
        self.assertFalse(app.exception)
        api.assert_not_called()
        token=next(i for i in app.text_input if i.label=='Mã xác minh email')
        self.assertEqual(token.value,'fixture-only.payload-only.signature-only')
        self.assertEqual(app.session_state['backend_auth_tabs'],'Xác minh email')
        self.assertFalse(any('fixture-only.payload-only.signature-only' in e.value for e in app.markdown))

if __name__=='__main__': unittest.main()
