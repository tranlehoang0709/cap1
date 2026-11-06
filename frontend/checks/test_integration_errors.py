"""Safe readiness messages; isolated unit tests, not live provider evidence."""
import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from tich_hop.http_client import ApiError
class IntegrationErrorTests(unittest.TestCase):
    def test_disabled_contract_is_actionable(self):
        error=ApiError("server",503,"AI_CONFIGURATION_CONTRACT_NOT_APPROVED")
        self.assertIn("khóa cấu hình",str(error))
        self.assertEqual(error.code,"AI_CONFIGURATION_CONTRACT_NOT_APPROVED")
    def test_unavailable_local_model_does_not_offer_cloud_fallback(self):
        error=ApiError("server",503,"LOCAL_RUNTIME_UNAVAILABLE")
        self.assertIn("Local AI",str(error))
        self.assertNotIn("Gemini",str(error))
    def test_unknown_code_is_not_echoed(self):
        error=ApiError("server",503,"PRIVATE_UPSTREAM_VALUE")
        self.assertNotIn("PRIVATE_UPSTREAM_VALUE",str(error))
if __name__=="__main__":unittest.main()
