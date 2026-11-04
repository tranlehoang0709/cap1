# AIVA Wi-Fi provisioning override

This directory is a repository-managed override of `78/esp-wifi-connect` 3.2.2,
upstream commit `c24b97c194e6b4a1d7be0237b3c28980661cac1e`. The upstream source
was copied from `managed_components/78__esp-wifi-connect`; do not patch the
managed copy. Review upstream changes before refreshing this fork.

The override makes the configuration AP WPA2-PSK before starting Wi-Fi, uses a
random per-session AP password, exposes that password only on the device
display, and requires a one-time random HTTP session token on `/submit`. Request
buffers and credential copies are zeroized where practical. The portal remains
HTTP; its credential protection relies on the WPA2-protected local AP link and
the physical display password. This does not provide TLS or prove device
identity/enrollment.

For SD1 and SD2, `CONFIG_AIVA_SECURE_WIFI_PROVISIONING` refuses saving new
credentials unless NVS encryption is enabled. This option does not turn on NVS
encryption or provision keys. Do not enable NVS encryption until a per-device
key/eFuse provisioning and existing-device migration process is approved and
validated. Existing plaintext NVS credentials are not migrated by this fork.

SD1 currently has BOOT GPIO 0 but its button action is not a verified
reconfiguration gesture while the device is running. SD2 declares
`GPIO_NUM_NC`; this override does not add a physical gesture or change GPIOs.
