import asyncio

import httpx


def test_device_profile_routes_are_additive_and_report_source_status():
    from app.main import create_app

    async def exercise():
        application = create_app()
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            profiles = await client.get("/device-profiles")
            assert profiles.status_code == 200
            assert [item["profile_id"] for item in profiles.json()] == [
                "esp32-s3-n16r8-tft-240x320",
                "esp32-s3-wroom-1",
            ]

            response = await client.get("/device-profiles/esp32-s3-wroom-1")
            assert response.status_code == 200
            profile = response.json()
            assert profile["diagram_id"] == "D1S1-01"
            assert profile["processor"] == {
                "chip": "ESP32-S3",
                "module": "ESP32-S3-WROOM-1",
                "cpu": "Xtensa LX7, Dual-Core",
            }
            assert profile["memory"] == {
                "flash_mb": 16,
                "psram_mb": 8,
                "psram_mode": "OPI",
                "memory_type": "qio_opi",
                "board_has_psram": True,
                "psram_size_bytes": 8388608,
                "checks": {
                    "psram_found": "reported_pass",
                    "audio_buffer": "reported_pass",
                    "psram_read_write": "reported_pass",
                    "stress_test": "not_tested",
                },
            }
            assert profile["interfaces"]["serial"] == {
                "observed_port": "COM3",
                "baud_rate": 115200,
                "scope": "Development host observation; not a fixed board port",
            }
            assert profile["evidence"] == {
                "status": "reported_pass",
                "source": "User-provided D1S1-01 diagram",
                "server_hardware_tested": False,
            }
            assert profile["display"] == {
                "driver": "ST7789",
                "width_px": 240,
                "height_px": 240,
                "vcc_volts": 5.0,
                "ground": "GND",
                "spi_pins": {
                    "sck": "GPIO42",
                    "mosi": "GPIO41",
                    "reset": "GPIO2",
                    "data_command": "GPIO1",
                    "backlight": "GPIO17",
                    "chip_select": "not_connected",
                },
                "chip_select_connected": False,
                "spi_mode": 3,
                "spi_mode_status": "reported_value",
                "spi_clock_mhz": 10,
                "spi_clock_status": "reported_value",
                "invert_color": True,
                "invert_color_status": "reported_value",
                "sdo_connected": False,
                "touch_pins_connected": False,
                "microsd_pins_connected": False,
                "checks": {
                    "color_render": "reported_pass",
                    "image_render": "reported_pass",
                    "ai_sync": "not_tested",
                },
                "evidence": {
                    "status": "reported_pass",
                    "source": "User-provided D1S1-02 diagram",
                    "server_hardware_tested": False,
                },
            }
            assert profile["microphone"] == {
                "ws_gpio": 4,
                "bclk_gpio": 5,
                "data_in_gpio": 6,
                "sample_rate_hz": 16000,
                "data_bits": 32,
                "i2s_port": "I2S_NUM_1",
                "model_name": None,
                "model_status": "pending",
                "power_requirement": None,
                "power_status": "pending",
                "channel_select": None,
                "checks": {
                    "rms_changes": "reported_pass",
                    "voice_capture": "reported_pass",
                    "five_second_capture": "reported_pass",
                    "playback": "reported_pass",
                    "noise_suppression": "not_tested",
                },
                "evidence": {
                    "status": "reported_pass",
                    "source": "User-provided D1S1-03 diagram",
                    "server_hardware_tested": False,
                },
            }
            assert profile["speaker"] == {
                "amplifier_ic": "NS4168",
                "data_out_gpio": 7,
                "bclk_gpio": 15,
                "ws_gpio": 16,
                "sample_rate_hz": 24000,
                "data_bits": 32,
                "i2s_port": "I2S_NUM_0",
                "audio_gain": "x4",
                "control_enable_gpio": None,
                "control_enable_status": "pending",
                "amplifier_power": None,
                "amplifier_power_status": "pending",
                "speaker_power": None,
                "speaker_power_status": "pending",
                "sd_connection": None,
                "sd_connection_status": "pending",
                "gain_connection": None,
                "gain_connection_status": "pending",
                "output_load": None,
                "checks": {
                    "beep_playback": "reported_pass",
                    "speech_playback": "reported_pass",
                    "anti_feedback": "not_tested",
                },
                "evidence": {
                    "status": "reported_pass",
                    "source": "User-provided D1S1-04 diagram",
                    "server_hardware_tested": False,
                },
            }
            assert profile["audio_loopback"] == {
                "microphone_gpios": [4, 5, 6],
                "capture_sample_rate_hz": 16000,
                "buffer_bytes": 160000,
                "capture_duration_seconds": 5,
                "playback_sample_rate_hz": 24000,
                "speaker": "NS4168",
                "speaker_gpios": [7, 15, 16],
                "checks": {
                    "psram_storage": "reported_pass",
                    "playback": "reported_pass",
                    "audible_voice": "reported_pass",
                    "continuous_capture_playback": "not_tested",
                    "full_duplex": "not_tested",
                },
                "evidence": {
                    "status": "reported_pass",
                    "source": "User-provided D1S1-05 diagram",
                    "server_hardware_tested": False,
                },
            }
            assert profile["usb_serial"] == {
                "connector": "USB-C",
                "observed_port": "COM3",
                "baud_rate": 115200,
                "usb_cdc_enabled": True,
                "usb_mode": 1,
                "checks": {
                    "usb_connector": "reported_pass",
                    "serial_print": "reported_pass",
                    "serial_input": "reported_pass",
                    "command_r": "reported_pass",
                    "firmware_build": "reported_pass",
                    "firmware_upload": "reported_pass",
                },
                "evidence": {
                    "status": "reported_pass",
                    "source": "User-provided D1S1-07 diagram",
                    "server_hardware_tested": False,
                },
            }
            assert profile["buttons"] == {
                "boot": {
                    "present": True,
                    "gpio": 0,
                    "function": "BOOT",
                    "checks": {"pcb_verified": "not_tested", "input_test": "not_tested"},
                },
                "power": {
                    "present": True,
                    "gpio": None,
                    "function": None,
                    "checks": {"pcb_verified": "not_tested", "input_test": "not_tested"},
                },
                "evidence": {
                    "status": "reported_value",
                    "source": "User-provided D1S1-08 diagram",
                    "server_hardware_tested": False,
                },
            }

            response = await client.get("/device-profiles/esp32-s3-n16r8-tft-240x320")
            assert response.status_code == 200
            new_profile = response.json()
            assert new_profile["diagram_id"] == "SD2"
            assert new_profile["display_name"] == "SD2 — ESP32-S3 N16R8 with ST7789 240×320"
            assert new_profile["processor"]["module"] == "ESP32-S3 N16R8"
            assert new_profile["memory"] == {
                "flash_mb": 16,
                "psram_mb": 8,
                "psram_mode": "not_reported",
                "memory_type": None,
                "board_has_psram": None,
                "psram_size_bytes": None,
                "checks": None,
            }
            assert new_profile["interfaces"]["power_rails"] == ["3V3", "5V", "GND"]
            assert new_profile["display"]["spi_pins"] == {
                "sck": "GPIO21",
                "mosi": "GPIO47",
                "chip_select": "GPIO41",
                "data_command": "GPIO40",
                "reset": "GPIO45",
                "backlight": "GPIO42",
            }
            assert new_profile["display"]["spi_mode_status"] == "pending"
            assert new_profile["display"]["spi_clock_status"] == "pending"
            assert new_profile["display"]["invert_color_status"] == "pending"
            assert new_profile["display"]["touch_pins_connected"] is False
            assert new_profile["display"]["microsd_pins_connected"] is False
            assert new_profile["microphone"]["model_name"] == "INMP441"
            assert new_profile["microphone"]["channel_select"] == "L/R tied to GND (left channel)"
            assert new_profile["microphone"]["checks"]["voice_capture"] == "reported_pass"
            assert new_profile["speaker"] == {
                "amplifier_ic": "MAX98357A",
                "data_out_gpio": 7,
                "bclk_gpio": 15,
                "ws_gpio": 16,
                "sample_rate_hz": None,
                "data_bits": None,
                "i2s_port": None,
                "audio_gain": None,
                "control_enable_gpio": None,
                "control_enable_status": "reported_value",
                "amplifier_power": "3V3",
                "amplifier_power_status": "reported_value",
                "speaker_power": None,
                "speaker_power_status": "pending",
                "sd_connection": "3V3",
                "sd_connection_status": "reported_value",
                "gain_connection": "GND",
                "gain_connection_status": "reported_value",
                "output_load": "4 ohm, 2 W speaker",
                "checks": {
                    "beep_playback": "not_tested",
                    "speech_playback": "not_tested",
                    "anti_feedback": "not_tested",
                },
                "evidence": {
                    "status": "reported_fail",
                    "source": "User-reported SD2 bring-up: no display or speaker output",
                    "server_hardware_tested": False,
                },
            }

            assert (await client.get("/device-profiles/not-registered")).status_code == 404
            # Existing routes remain available without changing their contracts.
            health = await client.get("/health")
            assert health.status_code == 200
            assert health.json() == {"status": "ok"}

    asyncio.run(exercise())
