"""Real Streamlit rendering with isolated HTTP responses; not live API evidence."""
import sys
from pathlib import Path
import unittest
from unittest.mock import patch
from streamlit.testing.v1 import AppTest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from giao_dien import live
APP = "from giao_dien.live import login_screen\nlogin_screen()"
class RegistrationTests(unittest.TestCase):
    def test_registration_does_not_autoverify_or_expose_returned_token(self):
        app=AppTest.from_string(APP).run()
        app.text_input[2].set_value('AIVA Local User')
        app.text_input[3].set_value('unit@example.invalid')
        app.text_input[4].set_value('unit-only-password')
        app.text_input[5].set_value('unit-only-password')
        with patch.object(live,'api',return_value={'id':'7','verification_token':'unit-only-private-verification'}) as api:
            app.button[1].click().run()
            self.assertEqual(api.call_count,1)
            self.assertEqual(api.call_args.args[0],'/auth/register')
        self.assertFalse(app.exception)
        self.assertTrue(any('xác minh email' in e.value for e in app.info))
        self.assertFalse(any('unit-only-private-verification' in e.value for e in app.markdown))
        self.assertEqual(len(app.success),0)
    def test_explicit_verification_uses_official_endpoint(self):
        app=AppTest.from_string(APP).run()
        next(i for i in app.text_input if i.label == 'Mã xác minh email').set_value('unit-only-private-verification')
        with patch.object(live,'api',return_value={'success':True}) as api:
            app.button[2].click().run()
            api.assert_called_once_with('/auth/verify-email','POST',{'token':'unit-only-private-verification'},auth=False)
        self.assertFalse(app.exception)
        self.assertEqual(len(app.success),1)
if __name__=='__main__':unittest.main()
