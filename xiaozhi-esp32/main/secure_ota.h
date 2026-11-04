#pragma once

#include <functional>
#include <string>

namespace aiva::security {
// The URL identifies a signed manifest, never a raw image. No network-supplied key is trusted.
bool UpgradeSignedManifest(const std::string& manifest_url,
                           std::function<void(int, size_t)> progress);
}
