/*
 * WiFi Manager Implementation
 */

#include "wifi_manager.h"
#include "wifi_station.h"
#include "wifi_configuration_ap.h"

#include <esp_log.h>
#include <esp_random.h>
#include <mbedtls/platform_util.h>
#include <esp_wifi.h>
#include <esp_netif.h>
#include <esp_event.h>
#include <esp_mac.h>
#include <nvs_flash.h>

#define TAG "WifiManager"

WifiManager& WifiManager::GetInstance() {
    static WifiManager instance;
    return instance;
}

WifiManager::WifiManager() = default;

WifiManager::~WifiManager() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (station_active_ && station_) {
        station_->Stop();
    }
    if (config_mode_active_ && config_ap_) {
        config_ap_->Stop();
    }
    if (!config_.ap_password.empty()) {
        mbedtls_platform_zeroize(config_.ap_password.data(), config_.ap_password.size());
        config_.ap_password.clear();
    }
    if (initialized_) {
        esp_wifi_deinit();
    }
}

void WifiManager::NotifyEvent(WifiEvent event, const std::string& data) {
    // Copy callback under lock, invoke without lock to avoid deadlock
    std::function<void(WifiEvent, const std::string&)> callback;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        callback = event_callback_;
    }
    if (callback) {
        callback(event, data);
    }
}

bool WifiManager::Initialize(const WifiManagerConfig& config) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    if (initialized_) {
        ESP_LOGW(TAG, "Already initialized");
        return true;
    }

    config_ = config;
    ESP_LOGI(TAG, "Initializing...");

    // Initialize NVS
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_LOGE(TAG, "NVS requires approved recovery; preserving stored data");
    }
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "NVS init failed: %s", esp_err_to_name(ret));
        return false;
    }

    // Initialize netif
    ret = esp_netif_init();
    if (ret != ESP_OK && ret != ESP_ERR_INVALID_STATE) {
        ESP_LOGE(TAG, "Netif init failed: %s", esp_err_to_name(ret));
        return false;
    }

    // Create event loop
    ret = esp_event_loop_create_default();
    if (ret != ESP_OK && ret != ESP_ERR_INVALID_STATE) {
        ESP_LOGE(TAG, "Event loop create failed: %s", esp_err_to_name(ret));
        return false;
    }

    // Initialize WiFi driver
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    cfg.nvs_enable = false;
    ret = esp_wifi_init(&cfg);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "WiFi init failed: %s", esp_err_to_name(ret));
        return false;
    }

    station_ = std::make_unique<WifiStation>();
    config_ap_ = std::make_unique<WifiConfigurationAp>();

    initialized_ = true;
    ESP_LOGI(TAG, "Initialized");
    return true;
}

bool WifiManager::IsInitialized() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return initialized_;
}

// ==================== Station Mode ====================

void WifiManager::StartStation() {
    std::unique_lock<std::mutex> lock(mutex_);

    if (!initialized_) {
        ESP_LOGE(TAG, "Not initialized");
        return;
    }
    if (station_active_) {
        ESP_LOGW(TAG, "Station already active");
        return;
    }

    // Auto-stop config AP if active
    if (config_mode_active_) {
        ESP_LOGI(TAG, "Stopping config AP before starting station");
        config_ap_->Stop();
        config_mode_active_ = false;
        // Notify outside lock
        lock.unlock();
        NotifyEvent(WifiEvent::ConfigModeExit);
        lock.lock();
    }

    ESP_LOGI(TAG, "Starting station");

    // Apply configuration
    station_->SetScanIntervalRange(config_.station_scan_min_interval_seconds,
                                   config_.station_scan_max_interval_seconds);
    station_->SetFailureRetryCnt(config_.station_failure_retry_cnt);
    station_->SetHostname(config_.station_hostname);

    // Setup callbacks
    station_->OnScanBegin([this]() {
        NotifyEvent(WifiEvent::Scanning);
    });
    station_->OnConnect([this](const std::string& ssid) {
        NotifyEvent(WifiEvent::Connecting, ssid);
    });
    station_->OnConnected([this](const std::string& ssid) {
        NotifyEvent(WifiEvent::Connected, ssid);
    });
    station_->OnDisconnected([this](int reason) {
        NotifyEvent(WifiEvent::Disconnected, std::to_string(reason));
    });

    station_->Start();
    station_active_ = true;
}

void WifiManager::StopStation() {
    std::unique_lock<std::mutex> lock(mutex_);

    if (!station_active_) {
        return;
    }

    ESP_LOGI(TAG, "Stopping station");
    station_->Stop();
    ESP_LOGI(TAG, "Station stopped");
    station_active_ = false;

    lock.unlock();
    NotifyEvent(WifiEvent::Disconnected);
    lock.lock();
}

bool WifiManager::IsConnected() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return station_active_ && station_ && station_->IsConnected();
}

std::string WifiManager::GetSsid() const {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!station_active_ || !station_) return "";
    return station_->GetSsid();
}

std::string WifiManager::GetIpAddress() const {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!station_active_ || !station_) return "";
    return station_->GetIpAddress();
}

int WifiManager::GetRssi() const {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!station_active_ || !station_ || !station_->IsConnected()) return 0;
    return station_->GetRssi();
}

int WifiManager::GetChannel() const {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!station_active_ || !station_ || !station_->IsConnected()) return 0;
    return station_->GetChannel();
}

std::string WifiManager::GetMacAddress() const {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!mac_address_.empty()) {
        return mac_address_;
    }

    uint8_t mac[6];
    if (esp_read_mac(mac, ESP_MAC_WIFI_STA) == ESP_OK) {
        char buf[18];
        snprintf(buf, sizeof(buf), "%02X:%02X:%02X:%02X:%02X:%02X",
                 mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
        mac_address_ = buf;
    }
    return mac_address_;
}

// ==================== Config AP Mode ====================

bool WifiManager::StartConfigAp() {
    std::unique_lock<std::mutex> lock(mutex_);

    if (!initialized_) {
        ESP_LOGE(TAG, "Not initialized");
        return false;
    }
    if (config_mode_active_) {
        ESP_LOGW(TAG, "Config AP already active");
        return false;
    }

    if (config_.ap_password.empty()) {
        uint8_t random[16];
        esp_fill_random(random, sizeof(random));
        static constexpr char hex[] = "0123456789abcdef";
        config_.ap_password.resize(sizeof(random) * 2);
        for (size_t i = 0; i < sizeof(random); ++i) {
            config_.ap_password[2 * i] = hex[random[i] >> 4];
            config_.ap_password[2 * i + 1] = hex[random[i] & 0x0f];
        }
        mbedtls_platform_zeroize(random, sizeof(random));
    }
    if (config_.ap_password.size() < 8 || config_.ap_password.size() > 63) {
        ESP_LOGE(TAG, "Refusing to start an unprotected config AP");
        mbedtls_platform_zeroize(config_.ap_password.data(), config_.ap_password.size());
        config_.ap_password.clear();
        return false;
    }

    // Auto-stop station if active
    if (station_active_) {
        ESP_LOGI(TAG, "Stopping station before starting config AP");
        station_->Stop();
        station_active_ = false;
        lock.unlock();
        NotifyEvent(WifiEvent::Disconnected);
        lock.lock();
    }

    ESP_LOGI(TAG, "Starting config AP");

    config_ap_->SetSsidPrefix(config_.ssid_prefix);
    config_ap_->SetLanguage(config_.language);
    config_ap_->SetShowOtaConfig(config_.show_ota_config);
    config_ap_->SetShowSleepConfig(config_.show_sleep_config);
    config_ap_->SetApPassword(config_.ap_password);

    // Web handler calls this when user submits config
    config_ap_->OnExitRequested([this]() {
        ESP_LOGI(TAG, "Config exit requested from web");
        StopConfigAp();
    });

    config_ap_->Start();
    config_mode_active_ = true;

    lock.unlock();
    NotifyEvent(WifiEvent::ConfigModeEnter);
    lock.lock();
    return true;
}

bool WifiManager::SetConfigApPassword(const std::string& password) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (config_mode_active_ || password.size() < 8 || password.size() > 63) {
        return false;
    }
    config_.ap_password = password;
    return true;
}

void WifiManager::StopConfigAp() {
    std::unique_lock<std::mutex> lock(mutex_);

    if (!config_mode_active_) {
        return;
    }

    ESP_LOGI(TAG, "Stopping config AP");
    config_ap_->Stop();
    if (!config_.ap_password.empty()) {
        mbedtls_platform_zeroize(config_.ap_password.data(), config_.ap_password.size());
        config_.ap_password.clear();
    }
    config_mode_active_ = false;

    lock.unlock();
    NotifyEvent(WifiEvent::ConfigModeExit);
    lock.lock();
}

bool WifiManager::IsConfigMode() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return config_mode_active_;
}

std::string WifiManager::GetApSsid() const {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!config_mode_active_ || !config_ap_) return "";
    return config_ap_->GetSsid();
}

std::string WifiManager::GetApWebUrl() const {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!config_mode_active_ || !config_ap_) return "";
    return config_ap_->GetWebServerUrl();
}

std::string WifiManager::GetApPassword() const {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!config_mode_active_) return "";
    return config_.ap_password;
}

// ==================== Power ====================

void WifiManager::SetPowerSaveLevel(WifiPowerSaveLevel level) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!station_active_ || !station_) {
        return;
    }
    station_->SetPowerSaveLevel(level);
}

// ==================== Event ====================

void WifiManager::SetEventCallback(std::function<void(WifiEvent, const std::string&)> callback) {
    std::lock_guard<std::mutex> lock(mutex_);
    event_callback_ = std::move(callback);
}
