#pragma once

#include <cstddef>
#include <cstdint>

// Caller serializes task/ISR access. No allocation, clocks, queue-drain guesses
// or sample-rate estimates. Bound to NoAudioCodec's auto-clearing DMA ring.
class I2sTxDrainFence {
public:
    static constexpr size_t kDescriptors = 6;

    void BeginWrite() {
        armed_ = drained_ = false;
        count_ = second_cycle_ = 0;
        for (size_t i = 0; i < kDescriptors; ++i)
            buffers_[i] = 0;
    }

    void EndWrite(bool complete) { armed_ = complete; }
    void Invalidate() { BeginWrite(); }
    bool Drained() const { return drained_; }

    // Kept inline for an IRAM callback; caller owns the ISR-safe lock.
    __attribute__((always_inline)) inline void OnSent(uintptr_t buffer) {
        if (!armed_ || buffer == 0)
            return;
        size_t index = 0;
        while (index < count_ && buffers_[index] != buffer)
            ++index;
        if (count_ < kDescriptors) {
            if (index == count_)
                buffers_[count_++] = buffer;
            return;
        }
        if (index == kDescriptors) {
            armed_ = false;  // Changed/unknown DMA ring cannot prove completion.
            return;
        }
        second_cycle_ |= uint32_t{1} << index;
        if (second_cycle_ == (uint32_t{1} << kDescriptors) - 1) {
            // Every buffer crossed TX EOF after the first, auto-cleared pass.
            drained_ = true;
            armed_ = false;
        }
    }

private:
    uintptr_t buffers_[kDescriptors] = {};
    size_t count_ = 0;
    uint32_t second_cycle_ = 0;
    bool armed_ = false;
    bool drained_ = false;
};
