#ifndef AIVA_SECURE_URL_H
#define AIVA_SECURE_URL_H

#include <string>

namespace aiva::security {

// Validate an absolute transport URL before any credential headers are set.
// Query strings are denied for gateway endpoints; opaque OTA asset URLs may
// opt in because a release service can use a short-lived signed URL.
inline bool HasSecureUrl(const std::string& url, const char* scheme, bool allow_query = false) {
    if (scheme == nullptr || *scheme == '\0') {
        return false;
    }

    const std::string prefix = std::string(scheme) + "://";
    if (url.compare(0, prefix.size(), prefix) != 0) {
        return false;
    }

    const size_t authority_start = prefix.size();
    const size_t authority_end = url.find_first_of("/?#", authority_start);
    const size_t end = authority_end == std::string::npos ? url.size() : authority_end;
    if (end == authority_start) {
        return false;
    }

    const std::string authority = url.substr(authority_start, end - authority_start);
    if (authority.find('@') != std::string::npos || authority.find('\\') != std::string::npos) {
        return false;
    }
    for (unsigned char character : authority) {
        if (character <= 0x20 || character == 0x7f) {
            return false;
        }
    }

    if (!allow_query && url.find_first_of("?#", end) != std::string::npos) {
        return false;
    }
    return true;
}

}  // namespace aiva::security

#endif  // AIVA_SECURE_URL_H
