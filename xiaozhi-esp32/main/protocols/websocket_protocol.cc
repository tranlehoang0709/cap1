#include "websocket_protocol.h"
#include "aiva_connection_mode.h"
#include "application.h"
#include "board.h"
#include "settings.h"
#include "secure_url.h"
#include "secure_transport_config.h"
#include "system_info.h"

#include <esp_log.h>
#include <arpa/inet.h>
#include <cJSON.h>
#include <cstring>
#include "assets/lang_config.h"

#define TAG "WS"

WebsocketProtocol::WebsocketProtocol() { event_group_handle_ = xEventGroupCreate(); }

WebsocketProtocol::~WebsocketProtocol() {
    websocket_.reset();
    vEventGroupDelete(event_group_handle_);
}

bool WebsocketProtocol::Start() {
#if CONFIG_AIVA_LAN_BOOTSTRAP
    // InitializeProtocol runs on the activation task, never the audio task.
    return OpenAudioChannel();
#endif
    // Only connect to server when audio channel is needed
    return true;
}

bool WebsocketProtocol::SendAudio(std::unique_ptr<AudioStreamPacket> packet) {
    if (websocket_ == nullptr || !websocket_->IsConnected()) {
        return false;
    }

    if (version_ == 2) {
        std::string serialized;
        serialized.resize(sizeof(BinaryProtocol2) + packet->payload.size());
        auto bp2 = (BinaryProtocol2*)serialized.data();
        bp2->version = htons(version_);
        bp2->type = 0;
        bp2->reserved = 0;
        bp2->timestamp = htonl(packet->timestamp);
        bp2->payload_size = htonl(packet->payload.size());
        memcpy(bp2->payload, packet->payload.data(), packet->payload.size());

        return websocket_->Send(serialized.data(), serialized.size(), true);
    } else if (version_ == 3) {
        std::string serialized;
        serialized.resize(sizeof(BinaryProtocol3) + packet->payload.size());
        auto bp3 = (BinaryProtocol3*)serialized.data();
        bp3->type = 0;
        bp3->reserved = 0;
        bp3->payload_size = htons(packet->payload.size());
        memcpy(bp3->payload, packet->payload.data(), packet->payload.size());

        return websocket_->Send(serialized.data(), serialized.size(), true);
    } else {
        return websocket_->Send(packet->payload.data(), packet->payload.size(), true);
    }
}

bool WebsocketProtocol::SendText(const std::string& text) {
    if (websocket_ == nullptr || !websocket_->IsConnected()) {
        return false;
    }

    if (!websocket_->Send(text)) {
        ESP_LOGE(TAG, "Failed to send control message");
        SetError(Lang::Strings::SERVER_ERROR);
        return false;
    }

    return true;
}

bool WebsocketProtocol::SendDeviceHeartbeat() {
#if CONFIG_AIVA_LAN_BOOTSTRAP
    if (!IsAudioChannelOpened() || session_id_.empty())
        return false;
    cJSON* root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "heartbeat");
    cJSON_AddStringToObject(root, "session_id", session_id_.c_str());
    char* json = cJSON_PrintUnformatted(root);
    bool sent = json && SendText(json);
    cJSON_free(json);
    cJSON_Delete(root);
    return sent;
#else
    return false;
#endif
}

bool WebsocketProtocol::IsAudioChannelOpened() const {
    return websocket_ != nullptr && websocket_->IsConnected() && !error_occurred_ && !IsTimeout();
}

void WebsocketProtocol::CloseAudioChannel(bool send_goodbye) {
    (void)send_goodbye;  // Websocket doesn't need to send goodbye message
    websocket_.reset();
}

bool WebsocketProtocol::OpenAudioChannel() {
#if CONFIG_AIVA_DUAL_CONNECTION_MODE
    const auto connection_mode = aiva::connection::GetMode();
    Settings settings(aiva::connection::WebsocketNamespace(connection_mode), false);
    std::string url = aiva::connection::GetWebsocketUrl();
#else
    Settings settings("websocket", false);
    std::string url = settings.GetString("url");
#endif
    std::string token = settings.GetString("token");
#if CONFIG_AIVA_DUAL_CONNECTION_MODE
    int version = aiva::connection::GetWebsocketVersion();
#else
    int version = settings.GetInt("version");
#endif
    if (version != 0) {
        version_ = version;
    }

    half_duplex_ = false;
    session_id_.clear();
#if CONFIG_AIVA_DEV_VOICE
    bool missing_token = token.empty();
#if CONFIG_AIVA_LAN_BOOTSTRAP
    missing_token = false;  // Dedicated device proof is checked below.
#endif
    if (url.empty() || missing_token || version < 1 || version > 3) {
        SetError(Lang::Strings::SERVER_ERROR);
        return false;
    }
#endif
#if CONFIG_AIVA_LAN_BOOTSTRAP
    if (!aiva::security::HasSecureUrl(url, "wss")) {
        ESP_LOGE(TAG, "LAN WebSocket requires a WSS endpoint without URL credentials/query");
        SetError(Lang::Strings::SERVER_ERROR);
        return false;
    }
#endif

    error_occurred_ = false;

    auto network = Board::GetInstance().GetNetwork();
    websocket_ = network->CreateWebSocket(1);
    if (websocket_ == nullptr) {
        ESP_LOGE(TAG, "Failed to create websocket");
        return false;
    }

#if !CONFIG_AIVA_LAN_BOOTSTRAP
    if (!token.empty()) {
        // If token not has a space, add "Bearer " prefix
        if (token.find(" ") == std::string::npos) {
            token = "Bearer " + token;
        }
        websocket_->SetHeader("Authorization", token.c_str());
    }
#endif
    websocket_->SetHeader("Protocol-Version", std::to_string(version_).c_str());
    websocket_->SetHeader("Device-Id", SystemInfo::GetMacAddress().c_str());
    websocket_->SetHeader("Client-Id", Board::GetInstance().GetUuid().c_str());
#if CONFIG_AIVA_LAN_BOOTSTRAP
    Settings device("device", false);
    const auto uid = device.GetString("uid");
    const auto credential = device.GetString("credential");
    if (uid.empty() || credential.empty()) {
        ESP_LOGE(TAG, "Provisioned device identity is missing from NVS; refusing LAN authentication");
        SetError(Lang::Strings::SERVER_ERROR);
        return false;
    }
    websocket_->SetHeader("Device-Uid", uid.c_str());
    websocket_->SetHeader("Device-Credential", credential.c_str());
#endif

    websocket_->OnData([this](const char* data, size_t len, bool binary) {
        if (binary) {
            if (on_incoming_audio_ != nullptr) {
                if (version_ == 2) {
                    if (len < sizeof(BinaryProtocol2)) {
                        SetError(Lang::Strings::SERVER_ERROR);
                        return;
                    }
                    BinaryProtocol2 header;
                    memcpy(&header, data, sizeof(header));
                    auto payload_size = ntohl(header.payload_size);
                    if (ntohs(header.version) != 2 || ntohs(header.type) != 0 ||
                        header.reserved != 0 || payload_size == 0 ||
                        payload_size != len - sizeof(header) || payload_size > 4096) {
                        SetError(Lang::Strings::SERVER_ERROR);
                        return;
                    }
                    auto payload = (const uint8_t*)data + sizeof(header);
                    on_incoming_audio_(std::make_unique<AudioStreamPacket>(AudioStreamPacket{
                        .sample_rate = server_sample_rate_,
                        .frame_duration = server_frame_duration_,
                        .timestamp = ntohl(header.timestamp),
                        .payload = std::vector<uint8_t>(payload, payload + payload_size)}));
                } else if (version_ == 3) {
                    if (len < sizeof(BinaryProtocol3)) {
                        SetError(Lang::Strings::SERVER_ERROR);
                        return;
                    }
                    BinaryProtocol3 header;
                    memcpy(&header, data, sizeof(header));
                    auto payload_size = ntohs(header.payload_size);
                    if (header.type != 0 || header.reserved != 0 || payload_size == 0 ||
                        payload_size != len - sizeof(header) || payload_size > 4096) {
                        SetError(Lang::Strings::SERVER_ERROR);
                        return;
                    }
                    auto payload = (const uint8_t*)data + sizeof(header);
                    on_incoming_audio_(std::make_unique<AudioStreamPacket>(AudioStreamPacket{
                        .sample_rate = server_sample_rate_,
                        .frame_duration = server_frame_duration_,
                        .timestamp = 0,
                        .payload = std::vector<uint8_t>(payload, payload + payload_size)}));
                } else {
                    if (len == 0 || len > 4096) {
                        SetError(Lang::Strings::SERVER_ERROR);
                        return;
                    }
                    on_incoming_audio_(std::make_unique<AudioStreamPacket>(AudioStreamPacket{
                        .sample_rate = server_sample_rate_,
                        .frame_duration = server_frame_duration_,
                        .timestamp = 0,
                        .payload = std::vector<uint8_t>((uint8_t*)data, (uint8_t*)data + len)}));
                }
            }
        } else {
            // Parse JSON data
            auto root = cJSON_ParseWithLength(data, len);
            auto type = cJSON_GetObjectItem(root, "type");
            if (cJSON_IsString(type)) {
                if (strcmp(type->valuestring, "hello") == 0) {
                    ParseServerHello(root);
                } else {
                    if (on_incoming_json_ != nullptr) {
                        on_incoming_json_(root);
                    }
                }
            } else {
                ESP_LOGE(TAG, "Missing message type");
            }
            cJSON_Delete(root);
        }
        last_incoming_time_ = std::chrono::steady_clock::now();
    });

    websocket_->OnDisconnected([this]() {
        ESP_LOGI(TAG, "Websocket disconnected");
        if (on_audio_channel_closed_ != nullptr) {
            on_audio_channel_closed_();
        }
    });

    ESP_LOGI(TAG, "Connecting to configured websocket server, version: %d", version_);
    if (!websocket_->Connect(url.c_str())) {
        ESP_LOGE(TAG, "Failed to connect to websocket server, code=%d", websocket_->GetLastError());
        SetError(Lang::Strings::SERVER_NOT_CONNECTED);
        return false;
    }

    // Send hello message to describe the client
    auto message = GetHelloMessage();
    if (!SendText(message)) {
        return false;
    }

    // Wait for server hello
    EventBits_t bits =
        xEventGroupWaitBits(event_group_handle_, WEBSOCKET_PROTOCOL_SERVER_HELLO_EVENT, pdTRUE,
                            pdFALSE, pdMS_TO_TICKS(10000));
    if (!(bits & WEBSOCKET_PROTOCOL_SERVER_HELLO_EVENT)) {
        ESP_LOGE(TAG, "Failed to receive server hello");
        SetError(Lang::Strings::SERVER_TIMEOUT);
        return false;
    }

    if (on_audio_channel_opened_ != nullptr) {
        on_audio_channel_opened_();
    }

    return true;
}

std::string WebsocketProtocol::GetHelloMessage() {
    // keys: message type, version, audio_params (format, sample_rate, channels)
    cJSON* root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type", "hello");
    cJSON_AddNumberToObject(root, "version", version_);
    cJSON* features = cJSON_CreateObject();
#if CONFIG_AIVA_DEV_VOICE
    cJSON_AddBoolToObject(features, "aiva_half_duplex_v1", true);
#endif
#if CONFIG_AIVA_LAN_BOOTSTRAP
    cJSON_AddBoolToObject(features, "aiva_lan_v1", true);
#endif
#if CONFIG_USE_SERVER_AEC
    cJSON_AddBoolToObject(features, "aec", true);
#endif
    cJSON_AddBoolToObject(features, "mcp", true);
    cJSON_AddItemToObject(root, "features", features);
    AddTextFontCapabilities(root);
    cJSON_AddStringToObject(root, "transport", "websocket");
    cJSON* audio_params = cJSON_CreateObject();
    cJSON_AddStringToObject(audio_params, "format", "opus");
    cJSON_AddNumberToObject(audio_params, "sample_rate", 16000);
    cJSON_AddNumberToObject(audio_params, "channels", 1);
    cJSON_AddNumberToObject(audio_params, "frame_duration", OPUS_FRAME_DURATION_MS);
    cJSON_AddItemToObject(root, "audio_params", audio_params);
    auto json_str = cJSON_PrintUnformatted(root);
    std::string message(json_str);
    cJSON_free(json_str);
    cJSON_Delete(root);
    return message;
}

void WebsocketProtocol::ParseServerHello(const cJSON* root) {
    auto transport = cJSON_GetObjectItem(root, "transport");
    if (!cJSON_IsString(transport) || strcmp(transport->valuestring, "websocket") != 0) {
        ESP_LOGE(TAG, "Unsupported transport");
        return;
    }

    auto session_id = cJSON_GetObjectItem(root, "session_id");
    if (cJSON_IsString(session_id)) {
        session_id_ = session_id->valuestring;
        ESP_LOGI(TAG, "Session ID: %s", session_id_.c_str());
    }

#if CONFIG_AIVA_DEV_VOICE
    auto features = cJSON_GetObjectItem(root, "features");
#if CONFIG_AIVA_LAN_BOOTSTRAP
    if (!cJSON_IsTrue(cJSON_GetObjectItem(features, "aiva_lan_v1")))
        return;
#endif
    half_duplex_ = cJSON_IsObject(features) &&
                   cJSON_IsTrue(cJSON_GetObjectItem(features, "aiva_half_duplex_v1"));
    if (!half_duplex_ || session_id_.empty())
        return;
#endif

    auto audio_params = cJSON_GetObjectItem(root, "audio_params");
#if CONFIG_AIVA_DEV_VOICE
    auto version = cJSON_GetObjectItem(root, "version");
    auto format = cJSON_GetObjectItem(audio_params, "format");
    auto rate = cJSON_GetObjectItem(audio_params, "sample_rate");
    auto channels = cJSON_GetObjectItem(audio_params, "channels");
    auto duration = cJSON_GetObjectItem(audio_params, "frame_duration");
    if (!cJSON_IsNumber(version) || version->valuedouble != version_ || !cJSON_IsString(format) ||
        strcmp(format->valuestring, "opus") != 0 || !cJSON_IsNumber(rate) ||
        rate->valuedouble != 16000 || !cJSON_IsNumber(channels) || channels->valuedouble != 1 ||
        !cJSON_IsNumber(duration) || duration->valuedouble != OPUS_FRAME_DURATION_MS)
        return;
#endif
    if (cJSON_IsObject(audio_params)) {
        auto sample_rate = cJSON_GetObjectItem(audio_params, "sample_rate");
        if (cJSON_IsNumber(sample_rate)) {
            server_sample_rate_ = sample_rate->valueint;
        }
        auto frame_duration = cJSON_GetObjectItem(audio_params, "frame_duration");
        if (cJSON_IsNumber(frame_duration)) {
            server_frame_duration_ = frame_duration->valueint;
        }
    }

    xEventGroupSetBits(event_group_handle_, WEBSOCKET_PROTOCOL_SERVER_HELLO_EVENT);
}
