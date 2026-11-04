"""LAN build selection and stable-board isolation; not hardware acceptance."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class LanVariantTests(unittest.TestCase):
    def test_lan_variant_is_explicit_and_leaves_stable_variant_unchanged(self):
        config = json.loads((ROOT / 'main/boards/custom/aiva-iot-s3-st7789/config.json').read_text())
        variants = {item['name']: item['sdkconfig_append'] for item in config['builds']}
        self.assertIn('CONFIG_AIVA_LAN_BOOTSTRAP=y', variants['aiva-iot-s3-st7789-lan'])
        self.assertIn('CONFIG_AIVA_SD2_USB_DEV_CONSOLE=y', variants['aiva-iot-s3-st7789-lan'])
        self.assertIn('CONFIG_MBEDTLS_CERTIFICATE_BUNDLE=y', variants['aiva-iot-s3-st7789-lan'])
        for name in ('aiva-iot-s3-st7789', 'aiva-iot-s3-st7789-dev-voice'):
            self.assertNotIn('CONFIG_AIVA_LAN_BOOTSTRAP=y', variants[name])

    def test_lan_credentials_are_gated_on_https_wss_and_signed_ota_support(self):
        ota = (ROOT / 'main/ota.cc').read_bytes().decode('utf-8', errors='replace')
        protocol = (ROOT / 'main/protocols/websocket_protocol.cc').read_bytes().decode('utf-8', errors='replace')
        url_policy = (ROOT / 'main/secure_url.h').read_text(encoding='utf-8')
        app = (ROOT / 'main/main.cc').read_text(encoding='utf-8')
        self.assertIn('HasSecureUrl(url, "https")', ota)
        self.assertIn('HasSecureUrl(websocket_url->valuestring, "wss")', ota)
        self.assertIn('HasSecureUrl(url, "wss")', protocol)
        self.assertIn('!CONFIG_SECURE_BOOT', ota)
        self.assertIn('authority.find(\'@\')', url_policy)
        self.assertIn('esp_log_level_set("HttpClient", ESP_LOG_WARN)', app)

    def test_sd2_lan_turn_status_and_reconnect_are_bounded_and_session_scoped(self):
        app = (ROOT / 'main/application.cc').read_text(encoding='utf-8')
        header = (ROOT / 'main/application.h').read_text(encoding='utf-8')
        protocol = (ROOT / 'main/protocols/websocket_protocol.cc').read_text(encoding='utf-8')
        self.assertIn('uint32_t lan_retry_delay_seconds_ = 5', header)
        self.assertIn('delay >= 30 ? 60 : delay * 2', app)
        self.assertIn('activation_task_handle_ == nullptr', app)
        self.assertIn('Server: connecting', app)
        self.assertIn('Server: connected', app)
        self.assertIn('Server: disconnected', app)
        self.assertIn('active_server_turn_id_ != turn->valuestring', app)
        self.assertIn('Device-Credential', protocol)


if __name__ == '__main__':
    unittest.main()
