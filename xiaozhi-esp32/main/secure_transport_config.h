#pragma once

#include "sdkconfig.h"

// Device proof must only travel over a CA- and hostname-verified transport.
// EspSsl uses esp_crt_bundle_attach and esp_tls_conn_new_sync(host, ...).
#if CONFIG_AIVA_LAN_BOOTSTRAP
#if !CONFIG_MBEDTLS_CERTIFICATE_BUNDLE
#error "AIVA bootstrap requires the TLS CA certificate bundle"
#endif
#if CONFIG_ESP_TLS_INSECURE || CONFIG_ESP_TLS_SKIP_SERVER_CERT_VERIFY
#error "AIVA bootstrap forbids insecure TLS verification"
#endif
#endif
