#ifndef AUDIO_SIGNAL_STATS_H
#define AUDIO_SIGNAL_STATS_H

#include <cmath>
#include <cstddef>
#include <cstdint>

#include <esp_log.h>
#include <esp_timer.h>

class AudioSignalStats {
public:
    void RecordPcm16(const char* stage, const int16_t* samples, size_t count,
                     uint32_t sample_rate_hz) {
        if (samples == nullptr || count == 0) return;
        for (size_t i = 0; i < count; ++i) {
            const int32_t value = samples[i];
            const uint64_t magnitude = static_cast<uint64_t>(value * value);
            square_sum_ += magnitude;
            const uint32_t absolute = static_cast<uint32_t>(value < 0 ? -value : value);
            if (absolute > peak_) peak_ = absolute;
            if (value == INT16_MAX || value == INT16_MIN) ++clipping_count_;
        }
        EmitWhenReady(stage, count, sample_rate_hz, false, 0, 0);
    }

    void RecordI2s32(const char* stage, const int32_t* samples, size_t count,
                     int pcm_shift, int comparison_pcm_shift, uint32_t sample_rate_hz) {
        if (samples == nullptr || count == 0) return;
        for (size_t i = 0; i < count; ++i) {
            const int64_t raw = samples[i];
            const int64_t scaled = raw >> 16;
            square_sum_ += static_cast<uint64_t>(scaled * scaled);
            const uint64_t absolute = static_cast<uint64_t>(raw < 0 ? -raw : raw);
            if (absolute > peak_) peak_ = absolute;
            const int64_t converted = raw >> pcm_shift;
            if (converted > INT16_MAX || converted < -INT16_MAX) ++clipping_count_;
            const int64_t comparison = raw >> comparison_pcm_shift;
            if (comparison > INT16_MAX || comparison < -INT16_MAX)
                ++comparison_clipping_count_;
            if ((static_cast<uint32_t>(raw) & 0xffU) == 0) ++lsb8_zero_count_;
        }
        EmitWhenReady(stage, count, sample_rate_hz, true, pcm_shift, comparison_pcm_shift);
    }

private:
    uint64_t sample_count_ = 0;
    uint64_t frame_count_ = 0;
    uint64_t square_sum_ = 0;
    uint64_t peak_ = 0;
    uint64_t clipping_count_ = 0;
    uint64_t comparison_clipping_count_ = 0;
    uint64_t lsb8_zero_count_ = 0;
    int64_t last_log_us_ = 0;

    void EmitWhenReady(const char* stage, size_t count, uint32_t sample_rate_hz,
                       bool raw_i2s, int pcm_shift, int comparison_pcm_shift) {
        sample_count_ += count;
        ++frame_count_;
        const int64_t now_us = esp_timer_get_time();
        // This helper can be called from three audio stages; keep diagnostics
        // readable and avoid adding unnecessary serial traffic during capture.
        if (sample_count_ < 16000 || now_us - last_log_us_ < 5000000) return;

        const double rms = std::sqrt(static_cast<double>(square_sum_) /
                                      static_cast<double>(sample_count_));
        if (raw_i2s) {
            const double lsb8_zero_pct = 100.0 * static_cast<double>(lsb8_zero_count_) /
                static_cast<double>(sample_count_);
            ESP_LOGI("AudioSignal", "stage=%s rate_hz=%u samples=%llu frames=%llu rms_s16_equiv=%0.f peak_raw=%llu clip_if_shift%d=%llu clip_if_shift%d=%llu lsb8_zero_pct=%.1f",
                stage, static_cast<unsigned>(sample_rate_hz),
                static_cast<unsigned long long>(sample_count_),
                static_cast<unsigned long long>(frame_count_), rms,
                static_cast<unsigned long long>(peak_),
                pcm_shift,
                static_cast<unsigned long long>(clipping_count_),
                comparison_pcm_shift,
                static_cast<unsigned long long>(comparison_clipping_count_),
                lsb8_zero_pct);
        } else {
            ESP_LOGI("AudioSignal", "stage=%s rate_hz=%u samples=%llu frames=%llu rms=%0.f peak=%llu clips=%llu",
                stage, static_cast<unsigned>(sample_rate_hz),
                static_cast<unsigned long long>(sample_count_),
                static_cast<unsigned long long>(frame_count_), rms,
                static_cast<unsigned long long>(peak_),
                static_cast<unsigned long long>(clipping_count_));
        }
        sample_count_ = 0;
        frame_count_ = 0;
        square_sum_ = 0;
        peak_ = 0;
        clipping_count_ = 0;
        comparison_clipping_count_ = 0;
        lsb8_zero_count_ = 0;
        last_log_us_ = now_us;
    }
};

#endif
