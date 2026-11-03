"""Offline client contract checks; these do not prove live Gemini execution."""
import io
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.modules.setdefault('streamlit', types.SimpleNamespace(session_state={}))
from nen_tang import backend


class ClientContractTests(unittest.TestCase):
    def setUp(self):
        self.state = patch.object(backend.st, 'session_state', {'access_token': 'test-jwt'})
        self.state.start()
        self.addCleanup(self.state.stop)

    def test_jwt_and_json_body(self):
        response = unittest.mock.MagicMock()
        response.__enter__.return_value.read.return_value = b'{}'
        with patch.object(backend, 'urlopen', return_value=response) as request:
            backend.api('/ai/profile', 'PATCH', {'assistant_name': 'AIVA'})
        sent = request.call_args.args[0]
        self.assertEqual(sent.get_header('Authorization'), 'Bearer test-jwt')
        self.assertEqual(sent.method, 'PATCH')
        self.assertIn(b'assistant_name', sent.data)

    def test_internal_reason_is_preserved(self):
        error = HTTPError('http://localhost', 409, '', {}, io.BytesIO(b'{"allowed":false,"reason":"QUOTA_SCHEMA_NOT_READY"}'))
        with patch.object(backend, 'urlopen', side_effect=error):
            with self.assertRaises(backend.BackendError) as caught:
                backend.api('/user/ai/usage')
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(caught.exception.message, 'QUOTA_SCHEMA_NOT_READY')

    def test_network_failure_is_visible(self):
        with patch.object(backend, 'urlopen', side_effect=URLError('offline')):
            with self.assertRaises(backend.BackendError) as caught:
                backend.api('/conversations')
        self.assertEqual(caught.exception.status, 0)

    def test_pipeline_503_does_not_fabricate_reply(self):
        error = HTTPError('http://localhost', 503, '', {}, io.BytesIO(b'{"code":"AI_PIPELINE_UNAVAILABLE"}'))
        with patch.object(backend, 'urlopen', side_effect=error):
            with self.assertRaisesRegex(backend.BackendError, 'AI_PIPELINE_UNAVAILABLE'):
                backend.api('/web-chat/messages', 'POST', {'content': 'hello', 'provider_id': '3'})


if __name__ == '__main__':
    unittest.main()
