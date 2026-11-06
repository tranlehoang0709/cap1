#include "aiva_connection_mode.h"

#include "settings.h"

namespace aiva::connection {
namespace {
constexpr const char* kModeNamespace = "aiva_conn";
constexpr const char* kModeKey = "mode";
constexpr const char* kLanOtaNamespace = "wifi";
constexpr const char* kLanWebsocketNamespace = "websocket";
constexpr const char* kInternetOtaNamespace = "aiva_iota";
constexpr const char* kInternetWebsocketNamespace = "aiva_iws";
}  // namespace

Mode GetMode() {
#if CONFIG_AIVA_DUAL_CONNECTION_MODE
    Settings settings(kModeNamespace, false);
    if (settings.GetString(kModeKey) == "wifi_internet") {
        return Mode::kWifiInternet;
    }
#endif
    // Missing or invalid state deliberately preserves the historical LAN mode.
    return Mode::kLan;
}

bool SetMode(const std::string& value) {
#if CONFIG_AIVA_DUAL_CONNECTION_MODE
    if (value != "lan" && value != "wifi_internet") {
        return false;
    }
    Settings settings(kModeNamespace, true);
    settings.SetString(kModeKey, value);
    return true;
#else
    return value == "lan";
#endif
}

const char* ModeName(Mode mode) {
    return mode == Mode::kWifiInternet ? "wifi_internet" : "lan";
}

const char* OtaNamespace(Mode mode) {
    return mode == Mode::kWifiInternet ? kInternetOtaNamespace : kLanOtaNamespace;
}

const char* WebsocketNamespace(Mode mode) {
    return mode == Mode::kWifiInternet ? kInternetWebsocketNamespace : kLanWebsocketNamespace;
}

std::string GetOtaUrl() {
    const auto mode = GetMode();
    Settings settings(OtaNamespace(mode), false);
    return settings.GetString("ota_url", mode == Mode::kWifiInternet ? kInternetOtaUrl : "");
}

std::string GetWebsocketUrl() {
    const auto mode = GetMode();
    Settings settings(WebsocketNamespace(mode), false);
    return settings.GetString("url", mode == Mode::kWifiInternet ? kInternetWebsocketUrl : "");
}

int GetWebsocketVersion() {
    const auto mode = GetMode();
    Settings settings(WebsocketNamespace(mode), false);
    return settings.GetInt("version", mode == Mode::kWifiInternet ? 1 : 0);
}

}  // namespace aiva::connection
