"""Source-level security regression checks for the SD1/SD2 Wi-Fi portal."""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]
FW = ROOT
COMPONENT = FW / "aiva-components" / "esp-wifi-connect"


class SecureWifiProvisioningSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ap = (COMPONENT / "wifi_configuration_ap.cc").read_text(encoding="utf-8")
        cls.manager = (COMPONENT / "wifi_manager.cc").read_text(encoding="utf-8")
        cls.manager_header = (COMPONENT / "include" / "wifi_manager.h").read_text(encoding="utf-8")
        cls.ssid = (COMPONENT / "ssid_manager.cc").read_text(encoding="utf-8")
        cls.manifest = (FW / "main" / "idf_component.yml").read_text(encoding="utf-8")
        cls.html = (COMPONENT / "assets" / "wifi_configuration.html").read_text(encoding="utf-8")
        cls.board = (FW / "main" / "boards" / "common" / "wifi_board.cc").read_text(encoding="utf-8")

    def test_component_manager_uses_repo_override(self):
        self.assertRegex(self.manifest, r"78/esp-wifi-connect:\s*\n\s*override_path:\s*\.\./aiva-components/esp-wifi-connect")

    def test_ap_is_configured_wpa2_before_start_and_never_open(self):
        self.assertNotIn("WIFI_AUTH_OPEN", self.ap)
        config = self.ap.index("wifi_config.ap.authmode = WIFI_AUTH_WPA2_PSK")
        set_config = self.ap.index("esp_wifi_set_config(WIFI_IF_AP, &wifi_config)")
        start = self.ap.index("esp_wifi_start()", set_config)
        self.assertLess(config, set_config)
        self.assertLess(set_config, start)
        self.assertIn("ap_password_.size() < 8 || ap_password_.size() > 63", self.ap)

    def test_empty_password_gets_random_per_session_secret(self):
        generation = self.manager.index("esp_fill_random(random, sizeof(random))")
        self.assertLess(generation, self.manager.index("config_ap_->SetApPassword(config_.ap_password)"))
        self.assertIn("mbedtls_platform_zeroize(random, sizeof(random))", self.manager)
        self.assertIn("Temporary AP password: ", self.board)
        self.assertNotRegex(self.board, r"ESP_LOG[DIWE]\([^\n]*GetApPassword")

    def test_submit_requires_one_time_token_and_limits_attempts(self):
        self.assertIn('"X-Provisioning-Token"', self.ap)
        self.assertIn("ConstantTimeTokenMatch", self.ap)
        self.assertIn("this_->session_token_ = NewSessionToken()", self.ap)
        self.assertIn("this_->submit_attempts_ > 10", self.ap)
        self.assertIn("X-Provisioning-Token", self.html)
        self.assertIn("session.token", self.html)

    def test_credentials_are_not_logged_and_buffers_are_cleared(self):
        # These component log statements must never interpolate Wi-Fi passwords.
        logs = re.findall(r"ESP_LOG[DIWE]\([^;]*\);", self.ap, re.S)
        self.assertFalse(any(re.search(r"password[^\n]*%s|%s[^\n]*password", log, re.I) for log in logs))
        self.assertIn("mbedtls_platform_zeroize(buf, buf_len + 1)", self.ap)
        self.assertIn("mbedtls_platform_zeroize(password_str.data(), password_str.size())", self.ap)
        self.assertIn("payload.password = '';", self.html)
        self.assertIn("document.getElementById('password').value = '';", self.html)

    def test_sd1_sd2_refuse_plaintext_nvs_save(self):
        guard = self.ssid.index("CONFIG_AIVA_SECURE_WIFI_PROVISIONING")
        refused = self.ssid.index("return false;", guard)
        persist = self.ssid.index("SaveToNvs();", refused)
        self.assertLess(guard, refused)
        self.assertLess(refused, persist)
        self.assertIn("CONFIG_NVS_ENCRYPTION", self.ssid)

    def test_profiles_keep_existing_button_configuration(self):
        sd1 = (FW / "main" / "boards" / "custom" / "xiaozhi-s3-tft" / "config.h").read_text(encoding="utf-8")
        sd2 = (FW / "main" / "boards" / "custom" / "aiva-iot-s3-st7789" / "config.h").read_text(encoding="utf-8")
        self.assertRegex(sd1, r"BOOT_BUTTON_GPIO\s+GPIO_NUM_0")
        self.assertRegex(sd2, r"BOOT_BUTTON_GPIO\s+GPIO_NUM_NC")

    def test_portal_has_wait_connect_success_and_failure_states(self):
        for state in ("Waiting for Wi-Fi setup", "Connecting", "Connected", "Failed"):
            self.assertTrue(state in self.html or state in self.board, state)

    def test_failed_wifi_attempt_does_not_persist_credentials_and_stop_cleans_secrets(self):
        failed_connect = self.ap.index("if (!this_->ConnectToWifi(ssid_str, password_str))")
        save = self.ap.index("const bool saved = this_->Save(ssid_str, password_str)")
        self.assertLess(failed_connect, save)
        self.assertIn("void WifiConfigurationAp::Stop()", self.ap)
        stop = self.ap.index("void WifiConfigurationAp::Stop()")
        stop_body = self.ap[stop:]
        self.assertIn("httpd_stop(server_)", stop_body)
        self.assertIn("dns_server_->Stop()", stop_body)
        self.assertIn("mbedtls_platform_zeroize(ap_password_.data()", stop_body)
        self.assertIn("mbedtls_platform_zeroize(session_token_.data()", stop_body)
        self.assertIn("mbedtls_platform_zeroize(config_.ap_password.data()", self.manager)

    def test_ap_password_is_not_persisted_in_manager_config(self):
        # It is generated per provisioning session and erased when the AP stops.
        self.assertIn("std::string ap_password", self.manager_header)
        self.assertIn("config_.ap_password.clear()", self.manager)
        self.assertIn("std::string WifiManager::GetApPassword() const", self.manager)


if __name__ == "__main__":
    unittest.main()
