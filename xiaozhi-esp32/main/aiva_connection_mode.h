#ifndef AIVA_CONNECTION_MODE_H
#define AIVA_CONNECTION_MODE_H

#include <string>

namespace aiva::connection {

enum class Mode {
    kLan,
    kWifiInternet,
};

constexpr const char* kInternetOtaUrl =
    "https://desktop-m27leua.tail022082.ts.net/xiaozhi/ota/";
constexpr const char* kInternetWebsocketUrl =
    "wss://desktop-m27leua.tail022082.ts.net/ws/robot";

Mode GetMode();
bool SetMode(const std::string& value);
const char* ModeName(Mode mode);
const char* OtaNamespace(Mode mode);
const char* WebsocketNamespace(Mode mode);
std::string GetOtaUrl();
std::string GetWebsocketUrl();
int GetWebsocketVersion();

}  // namespace aiva::connection

#endif
