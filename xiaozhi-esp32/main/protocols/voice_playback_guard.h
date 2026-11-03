#pragma once

#include <cstdint>
#include <mutex>
#include <string>

// Negotiated aiva_half_duplex_v1 only. No ESP-IDF dependency: host-testable.
class VoicePlaybackGuard {
public:
    enum class State { None, Ready, Complete, Failed };
    struct Event {
        State state = State::None;
        std::string turn;
        std::string playback;
        uint32_t chunks = 0;
    };

    bool Begin(const std::string& turn, const std::string& playback) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (active_ || serial_ == UINT32_MAX || !ValidId(turn) || !ValidId(playback)) return false;
        ++serial_;
        turn_ = turn;
        playback_ = playback;
        received_ = played_ = 0;
        active_ = true;
        ready_ = stopped_ = failed_ = false;
        return true;
    }

    uint32_t Receive() {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!active_ || !ready_ || stopped_ || received_ >= 100000) return 0;
        ++received_;
        return serial_;
    }

    void Played(uint32_t serial, bool success) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!active_ || serial != serial_) return;
        if (!success) failed_ = true;
        else ++played_;
    }

    bool Stop(const std::string& turn, const std::string& playback, uint32_t expected) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!active_ || turn != turn_ || playback != playback_ || stopped_) return false;
        stopped_ = true;
        failed_ = failed_ || !ready_ || expected == 0 || expected != received_;
        return true;
    }

    Event Poll(bool playback_idle, bool output_drained = false) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!active_) return {};
        if (failed_ || (stopped_ && playback_idle && played_ != received_)) {
            active_ = false;
            return {State::Failed, turn_, playback_, received_};
        }
        if (!ready_ && playback_idle) {
            ready_ = true;
            return {State::Ready, turn_, playback_, 0};
        }
        if (stopped_ && playback_idle && output_drained && played_ == received_) {
            active_ = false;
            return {State::Complete, turn_, playback_, received_};
        }
        return {};
    }

    bool Matches(const std::string& turn, const std::string& playback) {
        std::lock_guard<std::mutex> lock(mutex_);
        return active_ && turn == turn_ && playback == playback_;
    }

    void Cancel() {
        std::lock_guard<std::mutex> lock(mutex_);
        active_ = false;
        ready_ = stopped_ = false;
    }

private:
    static bool ValidId(const std::string& value) {
        if (value.empty() || value.size() > 64) return false;
        for (char ch : value) {
            if (!((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
                  (ch >= '0' && ch <= '9') || ch == '-' || ch == '_')) return false;
        }
        return true;
    }
    std::mutex mutex_;
    std::string turn_, playback_;
    uint32_t serial_ = 0x80000000;
    uint32_t received_ = 0, played_ = 0;
    bool active_ = false, ready_ = false, stopped_ = false, failed_ = false;
};
