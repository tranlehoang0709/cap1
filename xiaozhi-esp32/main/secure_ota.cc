#include "secure_ota.h"
#include "secure_url.h"

#include <cJSON.h>
#include <esp_app_desc.h>
#include <esp_crt_bundle.h>
#include <esp_http_client.h>
#include <esp_log.h>
#include <esp_ota_ops.h>
#include <mbedtls/base64.h>
#include <mbedtls/pk.h>
#include <psa/crypto.h>
#include <array>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <memory>
#include <mutex>

#ifdef AIVA_OTA_TRUST_ANCHOR
extern const unsigned char ota_key_start[] asm("_binary_aiva_ota_trust_anchor_pem_start");
extern const unsigned char ota_key_end[] asm("_binary_aiva_ota_trust_anchor_pem_end");
#endif

namespace aiva::security {
namespace {
constexpr char TAG[] = "SecureOta";
constexpr size_t kManifestLimit = 8192;
std::mutex ota_mutex;
struct Http {
    esp_http_client_handle_t handle = nullptr;
    explicit Http(const std::string& url) {
#if CONFIG_MBEDTLS_CERTIFICATE_BUNDLE
        esp_http_client_config_t config = {};
        config.url = url.c_str();
        config.crt_bundle_attach = esp_crt_bundle_attach;
        config.disable_auto_redirect = true;
        config.timeout_ms = 15000;
        handle = esp_http_client_init(&config);
#endif
    }
    ~Http() { if (handle) esp_http_client_cleanup(handle); }
    int64_t Open() {
        if (!handle || esp_http_client_open(handle, 0) != ESP_OK) return -1;
        const auto length = esp_http_client_fetch_headers(handle);
        return esp_http_client_get_status_code(handle) == 200 ? length : -1;
    }
};
using Json = std::unique_ptr<cJSON, decltype(&cJSON_Delete)>;
const char* String(cJSON* object, const char* key) {
    auto item = cJSON_GetObjectItemCaseSensitive(object, key);
    return cJSON_IsString(item) ? item->valuestring : nullptr;
}
bool Version(const std::string& text, std::array<unsigned, 3>& parts) {
    // Release contract is exactly three decimal components, each <= 65535.
    size_t offset = 0;
    for (size_t i = 0; i < parts.size(); ++i) {
        const auto start = offset;
        unsigned value = 0;
        while (offset < text.size() && text[offset] >= '0' && text[offset] <= '9') {
            value = value * 10 + text[offset++] - '0';
            if (value > 65535) return false;
        }
        if (offset == start || (offset - start > 1 && text[start] == '0')) return false;
        parts[i] = value;
        if (i < 2 && (offset == text.size() || text[offset++] != '.')) return false;
    }
    return offset == text.size();
}
bool Verify(const std::string& payload, const char* encoded) {
#ifndef AIVA_OTA_TRUST_ANCHOR
    return false;
#else
    if (!encoded || strlen(encoded) > 1024 || psa_crypto_init() != PSA_SUCCESS) return false;
    unsigned char signature[768], digest[32];
    size_t signature_size = 0, digest_size = 0;
    if (mbedtls_base64_decode(signature, sizeof(signature), &signature_size,
                              reinterpret_cast<const unsigned char*>(encoded), strlen(encoded)) != 0 ||
        psa_hash_compute(PSA_ALG_SHA_256, reinterpret_cast<const unsigned char*>(payload.data()),
                         payload.size(), digest, sizeof(digest), &digest_size) != PSA_SUCCESS) return false;
    mbedtls_pk_context key;
    mbedtls_pk_init(&key);
    bool ok = mbedtls_pk_parse_public_key(&key, ota_key_start, ota_key_end - ota_key_start) == 0 &&
              mbedtls_pk_get_type(&key) == MBEDTLS_PK_ECKEY &&
              mbedtls_pk_get_bitlen(&key) == 256 &&
              mbedtls_pk_verify(&key, MBEDTLS_MD_SHA256, digest, digest_size,
                                 signature, signature_size) == 0;
    mbedtls_pk_free(&key);
    return ok;
#endif
}
struct Update {
    esp_ota_handle_t handle = 0;
    bool active = false;
    psa_hash_operation_t hash = PSA_HASH_OPERATION_INIT;
    ~Update() {
        if (active) esp_ota_abort(handle);
        psa_hash_abort(&hash);
    }
};
}  // namespace

bool UpgradeSignedManifest(const std::string& manifest_url,
                           std::function<void(int, size_t)> progress) {
    std::unique_lock<std::mutex> lock(ota_mutex, std::try_to_lock);
    if (!lock.owns_lock() || !HasSecureUrl(manifest_url, "https")) return false;
#if !defined(AIVA_OTA_TRUST_ANCHOR) || !CONFIG_MBEDTLS_CERTIFICATE_BUNDLE || \
    !CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE
    ESP_LOGE(TAG, "OTA blocked: provisioned signing anchor, TLS bundle and rollback required");
    return false;
#endif
    // Bounded manifest read. Redirects and unknown/chunked lengths are refused.
    Http manifest(manifest_url);
    auto length = manifest.Open();
    if (length <= 0 || length > kManifestLimit) return false;
    std::string envelope(static_cast<size_t>(length), '\0');
    size_t received = 0;
    while (received < envelope.size()) {
        int count = esp_http_client_read(manifest.handle, envelope.data() + received,
                                         envelope.size() - received);
        if (count <= 0) return false;
        received += count;
    }
    if (!esp_http_client_is_complete_data_received(manifest.handle) ||
        envelope.find('\0') != std::string::npos) return false;
    Json root(cJSON_Parse(envelope.c_str()), cJSON_Delete);
    const char* payload = String(root.get(), "payload");
    if (!payload || !Verify(payload, String(root.get(), "signature"))) return false;
    Json claims(cJSON_Parse(payload), cJSON_Delete);
    const char* model = String(claims.get(), "model");
    const char* version = String(claims.get(), "version");
    const char* url = String(claims.get(), "url");
    const char* sha256 = String(claims.get(), "sha256");
    auto size = cJSON_GetObjectItemCaseSensitive(claims.get(), "size");
    auto partition = esp_ota_get_next_update_partition(nullptr);
    std::array<unsigned, 3> current{}, newer{};
    if (!partition || !model || strcmp(model, BOARD_NAME) != 0 ||
        !version || !Version(version, newer) ||
        !Version(esp_app_get_description()->version, current) || newer <= current ||
        !url || !HasSecureUrl(url, "https") || !sha256 || strlen(sha256) != 64 ||
        !cJSON_IsNumber(size) || !std::isfinite(size->valuedouble) ||
        size->valuedouble < 288 || size->valuedouble > partition->size ||
        std::floor(size->valuedouble) != size->valuedouble) return false;
    for (size_t i = 0; i < 64; ++i) {
        if (!((sha256[i] >= '0' && sha256[i] <= '9') || (sha256[i] >= 'a' && sha256[i] <= 'f'))) return false;
    }
    const size_t expected = static_cast<size_t>(size->valuedouble);
    Http image(url);
    if (image.Open() != static_cast<int64_t>(expected)) return false;
    Update update;
    if (psa_crypto_init() != PSA_SUCCESS ||
        psa_hash_setup(&update.hash, PSA_ALG_SHA_256) != PSA_SUCCESS ||
        esp_ota_begin(partition, expected, &update.handle) != ESP_OK) return false;
    update.active = true;
    std::array<unsigned char, 4096> buffer;
    received = 0;
    while (received < expected) {
        const size_t wanted = std::min(buffer.size(), expected - received);
        const int count = esp_http_client_read(image.handle, reinterpret_cast<char*>(buffer.data()), wanted);
        if (count <= 0 || psa_hash_update(&update.hash, buffer.data(), count) != PSA_SUCCESS ||
            esp_ota_write(update.handle, buffer.data(), count) != ESP_OK) return false;
        received += count;
        if (progress) progress(received * 100 / expected, 0);
    }
    unsigned char digest[32];
    size_t digest_size = 0;
    if (!esp_http_client_is_complete_data_received(image.handle) ||
        psa_hash_finish(&update.hash, digest, sizeof(digest), &digest_size) != PSA_SUCCESS ||
        digest_size != sizeof(digest)) return false;
    char actual[65];
    for (size_t i = 0; i < sizeof(digest); ++i) snprintf(actual + i * 2, 3, "%02x", digest[i]);
    if (strcmp(actual, sha256) != 0) return false;
    // Bind the image descriptor to the signed release, not merely its download URL.
    esp_app_desc_t description{};
    if (esp_ota_get_partition_description(partition, &description) != ESP_OK ||
        strncmp(description.version, version, sizeof(description.version)) != 0 ||
        strncmp(description.project_name, esp_app_get_description()->project_name,
                 sizeof(description.project_name)) != 0) return false;
    const auto result = esp_ota_end(update.handle);
    update.active = false;  // esp_ota_end releases its handle even on failure.
    if (result != ESP_OK) return false;
    return esp_ota_set_boot_partition(partition) == ESP_OK;
}
}  // namespace aiva::security
