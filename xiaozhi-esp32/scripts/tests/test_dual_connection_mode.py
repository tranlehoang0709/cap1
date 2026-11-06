import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]


class DualConnectionModeTests(unittest.TestCase):
    def setUp(self):
        self.header = (ROOT / "main/aiva_connection_mode.h").read_text(encoding="utf-8")
        self.source = (ROOT / "main/aiva_connection_mode.cc").read_text(encoding="utf-8")
        self.board = (
            ROOT / "main/boards/custom/aiva-iot-s3-st7789/aiva_iot_s3_board.cc"
        ).read_text(encoding="utf-8")
        self.ota = (ROOT / "main/ota.cc").read_text(encoding="utf-8")
        self.websocket = (ROOT / "main/protocols/websocket_protocol.cc").read_text(
            encoding="utf-8"
        )

    def test_funnel_variant_only_enables_dual_mode(self):
        config = json.loads(
            (ROOT / "main/boards/custom/aiva-iot-s3-st7789/config.json").read_text(
                encoding="utf-8"
            )
        )
        variants = {item["name"]: item["sdkconfig_append"] for item in config["builds"]}
        self.assertIn(
            "CONFIG_AIVA_DUAL_CONNECTION_MODE=y",
            variants["aiva-iot-s3-st7789-funnel"],
        )
        self.assertNotIn(
            "CONFIG_AIVA_DUAL_CONNECTION_MODE=y",
            variants["aiva-iot-s3-st7789-lan"],
        )
        funnel = variants["aiva-iot-s3-st7789-funnel"]
        self.assertIn("CONFIG_MBEDTLS_CERTIFICATE_BUNDLE_DEFAULT_FULL=y", funnel)
        self.assertIn("CONFIG_MBEDTLS_CUSTOM_CERTIFICATE_BUNDLE=y", funnel)
        self.assertIn(
            'CONFIG_MBEDTLS_CUSTOM_CERTIFICATE_BUNDLE_PATH="main/certs/aiva-lan-root-ca.pem"',
            funnel,
        )

    def test_missing_or_invalid_mode_stays_lan_without_migration(self):
        self.assertIn('return Mode::kLan;', self.source)
        self.assertIn('settings.GetString(kModeKey) == "wifi_internet"', self.source)
        self.assertNotIn("EraseAll", self.source)
        self.assertNotIn("EraseKey", self.source)

    def test_profiles_have_independent_nvs_namespaces(self):
        self.assertIn('kLanOtaNamespace = "wifi"', self.source)
        self.assertIn('kLanWebsocketNamespace = "websocket"', self.source)
        self.assertIn('kInternetOtaNamespace = "aiva_iota"', self.source)
        self.assertIn('kInternetWebsocketNamespace = "aiva_iws"', self.source)
        self.assertIn("WebsocketNamespace(connection_mode)", self.websocket)
        self.assertIn("WebsocketNamespace(aiva::connection::GetMode())", self.ota)

    def test_internet_endpoints_are_fixed_secure_funnel_urls(self):
        self.assertIn(
            '"https://desktop-m27leua.tail022082.ts.net/xiaozhi/ota/"', self.header
        )
        self.assertIn(
            '"wss://desktop-m27leua.tail022082.ts.net/ws/robot"', self.header
        )
        self.assertNotIn("192.168.", self.header)

    def test_explicit_mode_command_and_no_automatic_fallback(self):
        self.assertIn('command.rfind("mode ", 0) == 0', self.board)
        self.assertIn('expected lan or wifi_internet', self.board)
        combined = self.source + self.ota + self.websocket
        self.assertNotIn("fallback", combined.lower())
        self.assertNotIn("SetMode(\"wifi_internet\")", combined)
        self.assertNotIn("SetMode(\"lan\")", combined)

    def test_internet_still_uses_secure_transport_and_device_proof(self):
        self.assertIn('HasSecureUrl(url, "https")', self.ota)
        self.assertIn('HasSecureUrl(url, "wss")', self.websocket)
        self.assertIn('Settings device("device", false)', self.websocket)
        self.assertIn('SetHeader("Device-Credential"', self.websocket)


if __name__ == "__main__":
    unittest.main()
