#include "custom_wake_word.h"
#include "audio_service.h"
#include "system_info.h"
#include "assets.h"

#include <esp_log.h>
#include <esp_mn_iface.h>
#include <esp_mn_models.h>
#include <esp_mn_speech_commands.h>
#include <cJSON.h>
#include <esp_timer.h>

#define TAG "CustomWakeWord"

CustomWakeWord::CustomWakeWord()
    : wake_word_opus_() {
}

CustomWakeWord::~CustomWakeWord() {
    if (multinet_model_data_ != nullptr && multinet_ != nullptr) {
        // The ESP-SR command registry holds pointers to this model instance.
        esp_mn_commands_free();
    }
    if (multinet_model_data_ != nullptr && multinet_ != nullptr) {
        multinet_->destroy(multinet_model_data_);
        multinet_model_data_ = nullptr;
    }

    if (wake_word_encode_task_stack_ != nullptr) {
        heap_caps_free(wake_word_encode_task_stack_);
    }

    if (wake_word_encode_task_buffer_ != nullptr) {
        heap_caps_free(wake_word_encode_task_buffer_);
    }

    if (owns_models_ && models_ != nullptr) {
        esp_srmodel_deinit(models_);
    }
}

void CustomWakeWord::ParseWakenetModelConfig() {
    // Read index.json
    auto& assets = Assets::GetInstance();
    void* ptr = nullptr;
    size_t size = 0;
    if (!assets.GetAssetData("index.json", ptr, size)) {
        ESP_LOGE(TAG, "Failed to read index.json");
        return;
    }
    cJSON* root = cJSON_ParseWithLength(static_cast<char*>(ptr), size);
    if (root == nullptr) {
        ESP_LOGE(TAG, "Failed to parse index.json");
        return;
    }
    cJSON* multinet_model = cJSON_GetObjectItem(root, "multinet_model");
    if (cJSON_IsObject(multinet_model)) {
        cJSON* language = cJSON_GetObjectItem(multinet_model, "language");
        cJSON* duration = cJSON_GetObjectItem(multinet_model, "duration");
        cJSON* threshold = cJSON_GetObjectItem(multinet_model, "threshold");
        cJSON* commands = cJSON_GetObjectItem(multinet_model, "commands");
        if (cJSON_IsString(language)) {
            language_ = language->valuestring;
        }
        if (cJSON_IsNumber(duration)) {
            duration_ = duration->valueint;
        }
        if (cJSON_IsNumber(threshold)) {
            threshold_ = threshold->valuedouble;
        }
        if (cJSON_IsArray(commands)) {
            for (int i = 0; i < cJSON_GetArraySize(commands); i++) {
                cJSON* command = cJSON_GetArrayItem(commands, i);
                if (cJSON_IsObject(command)) {
                    cJSON* command_name = cJSON_GetObjectItem(command, "command");
                    cJSON* text = cJSON_GetObjectItem(command, "text");
                    cJSON* action = cJSON_GetObjectItem(command, "action");
                    if (cJSON_IsString(command_name) && cJSON_IsString(text) && cJSON_IsString(action)) {
                        commands_.push_back({command_name->valuestring, text->valuestring, action->valuestring});
                        ESP_LOGI(TAG, "Command: %s, Text: %s, Action: %s", command_name->valuestring, text->valuestring, action->valuestring);
                    }
                }
            }
        }
    }
    cJSON_Delete(root);
}


bool CustomWakeWord::Initialize(AudioCodec* codec, srmodel_list_t* models_list) {
    codec_ = codec;
    commands_.clear();

    if (models_list == nullptr) {
        language_ = "cn";
        models_ = esp_srmodel_init("model");
        owns_models_ = models_ != nullptr;
#ifdef CONFIG_CUSTOM_WAKE_WORD
        threshold_ = CONFIG_CUSTOM_WAKE_WORD_THRESHOLD / 100.0f;
        commands_.push_back({CONFIG_CUSTOM_WAKE_WORD, CONFIG_CUSTOM_WAKE_WORD_DISPLAY, "wake"});
#endif
    } else {
        models_ = models_list;
        ParseWakenetModelConfig();
    }

    if (models_ == nullptr || models_->num == -1) {
        ESP_LOGE(TAG, "Failed to initialize wakenet model");
        return false;
    }

    // 初始化 multinet (命令词识别)
    mn_name_ = esp_srmodel_filter(models_, ESP_MN_PREFIX, language_.c_str());
    if (mn_name_ == nullptr) {
        ESP_LOGW(TAG, "Language '%s' multinet not found, falling back to any multinet model", language_.c_str());
        mn_name_ = esp_srmodel_filter(models_, ESP_MN_PREFIX, NULL);
    }
    if (mn_name_ == nullptr) {
        ESP_LOGE(TAG, "Failed to initialize multinet, mn_name is nullptr");
        ESP_LOGI(TAG, "Please refer to https://pcn7cs20v8cr.feishu.cn/wiki/CpQjwQsCJiQSWSkYEvrcxcbVnwh to add custom wake word");
        return false;
    }

    multinet_ = esp_mn_handle_from_name(mn_name_);
    if (multinet_ == nullptr) {
        ESP_LOGE(TAG, "MultiNet interface lookup failed for model=%s", mn_name_);
        return false;
    }
    multinet_model_data_ = multinet_->create(mn_name_, duration_);
    if (multinet_model_data_ == nullptr) {
        ESP_LOGE(TAG, "MultiNet model creation failed for model=%s", mn_name_);
        return false;
    }
    multinet_->set_det_threshold(multinet_model_data_, threshold_);
    const int sample_rate = multinet_->get_samp_rate(multinet_model_data_);
    const int chunk_samples = multinet_->get_samp_chunksize(multinet_model_data_);
    ESP_LOGI(TAG, "Wake detector ready: model=%s language=%s rate_hz=%d chunk_samples=%d threshold=%.2f duration_ms=%d",
        mn_name_, language_.c_str(), sample_rate, chunk_samples, threshold_, duration_);
    if (sample_rate != 16000 || chunk_samples <= 0) {
        ESP_LOGE(TAG, "Unsupported MultiNet input layout: expected 16000 Hz mono s16, got rate=%d chunk=%d",
            sample_rate, chunk_samples);
        return false;
    }
    input_buffer_.reserve(chunk_samples);
    const esp_err_t alloc_result = esp_mn_commands_alloc(multinet_, multinet_model_data_);
    if (alloc_result != ESP_OK) {
        ESP_LOGE(TAG, "Command registry allocation failed: %s", esp_err_to_name(alloc_result));
        return false;
    }
    for (int i = 0; i < commands_.size(); i++) {
#if CONFIG_SR_MN_EN_MULTINET5_SINGLE_RECOGNITION_QUANT8
        // ESP-SR 2.4.x MultiNet5 Q8 consumes phoneme tokens. These are the
        // official multinet_g2p.py mapping for "hello" (HH AH0 L OW1).
        if (commands_[i].command != "hello") {
            ESP_LOGE(TAG, "MultiNet5 Q8 needs a verified phoneme mapping; unsupported phrase=%s",
                commands_[i].command.c_str());
            return false;
        }
        constexpr char kHelloPhonemes[] = "hcLb";
        const esp_err_t add_result = esp_mn_commands_phoneme_add(
            i + 1, commands_[i].command.c_str(), kHelloPhonemes);
        const int tokenized = multinet_->check_speech_command(
            multinet_model_data_, kHelloPhonemes);
        ESP_LOGI(TAG, "Wake phrase registration: command_id=%d phrase=%s phonemes=%s add=%s supported=%s",
            i + 1, commands_[i].command.c_str(), kHelloPhonemes,
            esp_err_to_name(add_result), tokenized != 0 ? "yes" : "no");
#else
        const esp_err_t add_result = esp_mn_commands_add(i + 1, commands_[i].command.c_str());
        const int tokenized = multinet_->check_speech_command(
            multinet_model_data_, commands_[i].command.c_str());
        ESP_LOGI(TAG, "Wake phrase registration: command_id=%d phrase=%s add=%s supported=%s",
            i + 1, commands_[i].command.c_str(), esp_err_to_name(add_result),
            tokenized != 0 ? "yes" : "no");
#endif
        if (add_result != ESP_OK || tokenized == 0) {
            ESP_LOGE(TAG, "Wake phrase registration rejected: command_id=%d", i + 1);
            return false;
        }
    }
    esp_mn_error_t* update_error = esp_mn_commands_update();
    if (update_error != nullptr) {
        ESP_LOGE(TAG, "MultiNet command update rejected %d phrase(s)", update_error->num);
        for (int i = 0; i < update_error->num; ++i) {
            const esp_mn_phrase_t* phrase = update_error->phrases[i];
            ESP_LOGE(TAG, "Rejected command: id=%d phrase=%s", phrase ? phrase->command_id : -1,
                (phrase && phrase->string) ? phrase->string : "<unknown>");
        }
        return false;
    }
    ESP_LOGI(TAG, "MultiNet command list updated: commands=%u command_id=1 phrase=%s",
        static_cast<unsigned>(commands_.size()), commands_.empty() ? "<none>" : commands_[0].command.c_str());
    
    multinet_->print_active_speech_commands(multinet_model_data_);
#if CONFIG_SEND_WAKE_WORD_DATA
    if (!wake_word_audio_cache_.Initialize(16000 * 2)) {
        ESP_LOGW(TAG, "Wake-word audio upload disabled: PSRAM cache allocation failed");
    }
#endif
    return true;
}

void CustomWakeWord::OnWakeWordDetected(std::function<void(const std::string& wake_word)> callback) {
    wake_word_detected_callback_ = callback;
}

void CustomWakeWord::Start() {
    running_ = true;
}

void CustomWakeWord::Stop() {
    running_ = false;

    std::lock_guard<std::mutex> lock(input_buffer_mutex_);
    input_buffer_.clear();
}

void CustomWakeWord::Feed(const std::vector<int16_t>& data) {
    FeedSamples(data.data(), data.size(), false);
}

void CustomWakeWord::FeedMono(const int16_t* data, size_t samples) {
    FeedSamples(data, samples, true);
}

void CustomWakeWord::FeedSamples(const int16_t* data, size_t samples, bool mono) {
    if (multinet_model_data_ == nullptr || data == nullptr || samples == 0) {
        return;
    }

    std::lock_guard<std::mutex> lock(input_buffer_mutex_);
    // Check running state inside lock to avoid TOCTOU race with Stop()
    if (!running_) {
        return;
    }

    after_afe_stats_.RecordPcm16("pcm16_after_afe_before_multinet", data, samples, 16000);
    feed_frames_ += samples;

    // If input channels is 2, we need to fetch the left channel data
    if (!mono && codec_->input_channels() > 1) {
        for (size_t i = 0; i < samples; i += codec_->input_channels()) {
            input_buffer_.push_back(data[i]);
        }
    } else {
        input_buffer_.insert(input_buffer_.end(), data, data + samples);
    }
    
    const int chunksize = multinet_->get_samp_chunksize(multinet_model_data_);
    while (input_buffer_.size() >= chunksize) {
#if CONFIG_SEND_WAKE_WORD_DATA
        wake_word_audio_cache_.Store(input_buffer_.data(), chunksize);
#endif

        esp_mn_state_t mn_state = multinet_->detect(multinet_model_data_, input_buffer_.data());
        ++detect_calls_;
        switch (mn_state) {
            case ESP_MN_STATE_DETECTING: ++detecting_frames_; break;
            case ESP_MN_STATE_DETECTED: ++detected_frames_; break;
            case ESP_MN_STATE_TIMEOUT: ++timeout_frames_; break;
            default: break;
        }
        const int64_t now_us = esp_timer_get_time();
        if (last_detector_log_us_ == 0 || now_us - last_detector_log_us_ >= 5000000) {
            ESP_LOGI(TAG, "MultiNet feed stats: feed_samples=%llu detect_calls=%llu states{detecting=%llu detected=%llu timeout=%llu} frame_samples=%d rate_hz=%d buffered_samples=%u",
                static_cast<unsigned long long>(feed_frames_),
                static_cast<unsigned long long>(detect_calls_),
                static_cast<unsigned long long>(detecting_frames_),
                static_cast<unsigned long long>(detected_frames_),
                static_cast<unsigned long long>(timeout_frames_), chunksize,
                multinet_->get_samp_rate(multinet_model_data_),
                static_cast<unsigned>(input_buffer_.size()));
            last_detector_log_us_ = now_us;
        }
        
        if (mn_state == ESP_MN_STATE_DETECTED) {
            esp_mn_results_t *mn_result = multinet_->get_results(multinet_model_data_);
            for (int i = 0; i < mn_result->num && running_; i++) {
                ESP_LOGI(TAG, "Custom wake word detected: command_id=%d, string=%s, prob=%f", 
                        mn_result->command_id[i], mn_result->string, mn_result->prob[i]);
                const int command_index = mn_result->command_id[i] - 1;
                if (command_index < 0 || command_index >= static_cast<int>(commands_.size())) {
                    ESP_LOGE(TAG, "MultiNet returned invalid command_id=%d (commands=%u)",
                        mn_result->command_id[i], static_cast<unsigned>(commands_.size()));
                    continue;
                }
                auto& command = commands_[command_index];
                if (command.action == "wake") {
                    last_detected_wake_word_ = command.text;
                    running_ = false;
                    input_buffer_.clear();
                    
                    if (wake_word_detected_callback_) {
                        wake_word_detected_callback_(last_detected_wake_word_);
                    }
                }
            }
            multinet_->clean(multinet_model_data_);
        } else if (mn_state == ESP_MN_STATE_TIMEOUT) {
            ESP_LOGD(TAG, "Command word detection timeout, cleaning state");
            multinet_->clean(multinet_model_data_);
        }
        
        if (!running_) {
            break;
        }
        input_buffer_.erase(input_buffer_.begin(), input_buffer_.begin() + chunksize);
    }
}

size_t CustomWakeWord::GetFeedSize() {
    if (multinet_model_data_ == nullptr) {
        return 0;
    }
    return multinet_->get_samp_chunksize(multinet_model_data_);
}

void CustomWakeWord::EncodeWakeWordData() {
    const size_t stack_size = 4096 * 7;
    wake_word_opus_.clear();
    if (wake_word_encode_task_stack_ == nullptr) {
        wake_word_encode_task_stack_ = (StackType_t*)heap_caps_malloc(stack_size, MALLOC_CAP_SPIRAM);
        assert(wake_word_encode_task_stack_ != nullptr);
    }
    if (wake_word_encode_task_buffer_ == nullptr) {
        wake_word_encode_task_buffer_ = (StaticTask_t*)heap_caps_malloc(sizeof(StaticTask_t), MALLOC_CAP_INTERNAL);
        assert(wake_word_encode_task_buffer_ != nullptr);
    }

    wake_word_encode_task_ = xTaskCreateStatic([](void* arg) {
        auto this_ = (CustomWakeWord*)arg;
        {
            auto start_time = esp_timer_get_time();
            // Create encoder
            esp_opus_enc_config_t opus_enc_cfg = AS_OPUS_ENC_CONFIG();
            void* encoder_handle = nullptr;
            auto ret = esp_opus_enc_open(&opus_enc_cfg, sizeof(esp_opus_enc_config_t), &encoder_handle);
            if (encoder_handle == nullptr) {
                ESP_LOGE(TAG, "Failed to create audio encoder, error code: %d", ret);
                this_->wake_word_audio_cache_.Clear();
                std::lock_guard<std::mutex> lock(this_->wake_word_mutex_);
                this_->wake_word_opus_.push_back(std::vector<uint8_t>());
                this_->wake_word_cv_.notify_all();
                vTaskDelete(nullptr);
                return;
            }
            // Get frame size
            int frame_size = 0;
            int outbuf_size = 0;
            esp_opus_enc_get_frame_size(encoder_handle, &frame_size, &outbuf_size);
            frame_size = frame_size / sizeof(int16_t);
            // Encode all PCM data
            int packets = 0;
            std::vector<int16_t> in_buffer(frame_size);
            esp_audio_enc_in_frame_t in = {};
            esp_audio_enc_out_frame_t out = {};
            const size_t cached_samples = this_->wake_word_audio_cache_.Size();
            for (size_t offset = 0;
                 offset + static_cast<size_t>(frame_size) <= cached_samples;
                 offset += frame_size) {
                if (this_->wake_word_audio_cache_.Read(
                        offset, in_buffer.data(), frame_size) != static_cast<size_t>(frame_size)) {
                    break;
                }
                std::vector<uint8_t> opus_buf(outbuf_size);
                in.buffer = reinterpret_cast<uint8_t*>(in_buffer.data());
                in.len = frame_size * sizeof(int16_t);
                out.buffer = opus_buf.data();
                out.len = outbuf_size;
                out.encoded_bytes = 0;
                ret = esp_opus_enc_process(encoder_handle, &in, &out);
                if (ret == ESP_AUDIO_ERR_OK) {
                    std::lock_guard<std::mutex> lock(this_->wake_word_mutex_);
                    this_->wake_word_opus_.emplace_back(opus_buf.data(), opus_buf.data() + out.encoded_bytes);
                    this_->wake_word_cv_.notify_all();
                    packets++;
                } else {
                    ESP_LOGE(TAG, "Failed to encode audio, error code: %d", ret);
                }
            }
            this_->wake_word_audio_cache_.Clear();
            // Close encoder
            esp_opus_enc_close(encoder_handle);
            auto end_time = esp_timer_get_time();
            ESP_LOGI(TAG, "Encode wake word opus %d packets in %ld ms", packets, (long)((end_time - start_time) / 1000));

            std::lock_guard<std::mutex> lock(this_->wake_word_mutex_);
            this_->wake_word_opus_.push_back(std::vector<uint8_t>());
            this_->wake_word_cv_.notify_all();
        }
        vTaskDelete(NULL);
    }, "encode_wake_word", stack_size, this, 2, wake_word_encode_task_stack_, wake_word_encode_task_buffer_);
}

bool CustomWakeWord::GetWakeWordOpus(std::vector<uint8_t>& opus) {
    std::unique_lock<std::mutex> lock(wake_word_mutex_);
    wake_word_cv_.wait(lock, [this]() {
        return !wake_word_opus_.empty();
    });
    opus.swap(wake_word_opus_.front());
    wake_word_opus_.pop_front();
    return !opus.empty();
}
