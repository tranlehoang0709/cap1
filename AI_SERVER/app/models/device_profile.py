"""Read-only hardware profile schema; profiles describe a board, not a session."""

from typing import Literal

from pydantic import BaseModel, ConfigDict


class BoardProcessor(BaseModel):
    model_config = ConfigDict(frozen=True)

    chip: str
    module: str
    cpu: str


class MemoryChecks(BaseModel):
    model_config = ConfigDict(frozen=True)

    psram_found: Literal["reported_pass", "not_tested"]
    audio_buffer: Literal["reported_pass", "not_tested"]
    psram_read_write: Literal["reported_pass", "not_tested"]
    stress_test: Literal["reported_pass", "not_tested"]


class BoardMemory(BaseModel):
    model_config = ConfigDict(frozen=True)

    flash_mb: int
    psram_mb: int
    psram_mode: str
    memory_type: str | None = None
    board_has_psram: bool | None = None
    psram_size_bytes: int | None = None
    checks: MemoryChecks | None = None


class SerialSetup(BaseModel):
    model_config = ConfigDict(frozen=True)

    observed_port: str
    baud_rate: int | None
    scope: str


class BoardInterfaces(BaseModel):
    model_config = ConfigDict(frozen=True)

    usb_connector: str
    serial: SerialSetup
    firmware_platforms: tuple[str, ...]
    power_input: str
    power_rails: tuple[str, ...] = ()


class ProfileEvidence(BaseModel):
    model_config = ConfigDict(frozen=True)

    status: str
    source: str
    server_hardware_tested: bool = False


class DisplayChecks(BaseModel):
    model_config = ConfigDict(frozen=True)

    color_render: Literal["reported_pass", "not_tested"]
    image_render: Literal["reported_pass", "not_tested"]
    ai_sync: Literal["reported_pass", "not_tested"]


class DisplayProfile(BaseModel):
    model_config = ConfigDict(frozen=True)

    driver: str
    width_px: int
    height_px: int
    vcc_volts: float
    ground: str
    spi_pins: dict[str, str]
    chip_select_connected: bool
    spi_mode: int | None
    spi_mode_status: Literal["reported_value", "pending"] = "reported_value"
    spi_clock_mhz: int | None
    spi_clock_status: Literal["reported_value", "pending"] = "reported_value"
    invert_color: bool | None
    invert_color_status: Literal["reported_value", "pending"] = "reported_value"
    sdo_connected: bool = False
    touch_pins_connected: bool = False
    microsd_pins_connected: bool = False
    checks: DisplayChecks
    evidence: ProfileEvidence


class MicrophoneChecks(BaseModel):
    model_config = ConfigDict(frozen=True)

    rms_changes: Literal["reported_pass", "not_tested"]
    voice_capture: Literal["reported_pass", "not_tested"]
    five_second_capture: Literal["reported_pass", "not_tested"]
    playback: Literal["reported_pass", "not_tested"]
    noise_suppression: Literal["reported_pass", "not_tested"]


class MicrophoneProfile(BaseModel):
    model_config = ConfigDict(frozen=True)

    ws_gpio: int
    bclk_gpio: int
    data_in_gpio: int
    sample_rate_hz: int
    data_bits: int
    i2s_port: str
    model_name: str | None
    model_status: Literal["reported_value", "pending"]
    power_requirement: str | None
    power_status: Literal["reported_value", "pending"]
    channel_select: str | None = None
    checks: MicrophoneChecks
    evidence: ProfileEvidence


class SpeakerChecks(BaseModel):
    model_config = ConfigDict(frozen=True)

    beep_playback: Literal["reported_pass", "not_tested"]
    speech_playback: Literal["reported_pass", "not_tested"]
    anti_feedback: Literal["reported_pass", "not_tested"]


class SpeakerProfile(BaseModel):
    model_config = ConfigDict(frozen=True)

    amplifier_ic: str
    data_out_gpio: int
    bclk_gpio: int
    ws_gpio: int
    sample_rate_hz: int | None
    data_bits: int | None
    i2s_port: str | None
    audio_gain: str | None
    control_enable_gpio: int | None
    control_enable_status: Literal["reported_value", "pending"]
    amplifier_power: str | None
    amplifier_power_status: Literal["reported_value", "pending"]
    speaker_power: str | None
    speaker_power_status: Literal["reported_value", "pending"]
    sd_connection: str | None = None
    sd_connection_status: Literal["reported_value", "pending"] = "pending"
    gain_connection: str | None = None
    gain_connection_status: Literal["reported_value", "pending"] = "pending"
    output_load: str | None = None
    checks: SpeakerChecks
    evidence: ProfileEvidence


class AudioLoopbackChecks(BaseModel):
    model_config = ConfigDict(frozen=True)

    psram_storage: Literal["reported_pass", "not_tested"]
    playback: Literal["reported_pass", "not_tested"]
    audible_voice: Literal["reported_pass", "not_tested"]
    continuous_capture_playback: Literal["reported_pass", "not_tested"]
    full_duplex: Literal["reported_pass", "not_tested"]


class AudioLoopbackProfile(BaseModel):
    model_config = ConfigDict(frozen=True)

    microphone_gpios: tuple[int, int, int]
    capture_sample_rate_hz: int
    buffer_bytes: int
    capture_duration_seconds: int
    playback_sample_rate_hz: int
    speaker: str
    speaker_gpios: tuple[int, int, int]
    checks: AudioLoopbackChecks
    evidence: ProfileEvidence


class UsbSerialChecks(BaseModel):
    model_config = ConfigDict(frozen=True)

    usb_connector: Literal["reported_pass", "not_tested"]
    serial_print: Literal["reported_pass", "not_tested"]
    serial_input: Literal["reported_pass", "not_tested"]
    command_r: Literal["reported_pass", "not_tested"]
    firmware_build: Literal["reported_pass", "not_tested"]
    firmware_upload: Literal["reported_pass", "not_tested"]


class UsbSerialProfile(BaseModel):
    model_config = ConfigDict(frozen=True)

    connector: str
    observed_port: str
    baud_rate: int
    usb_cdc_enabled: bool
    usb_mode: int
    checks: UsbSerialChecks
    evidence: ProfileEvidence


class ButtonChecks(BaseModel):
    model_config = ConfigDict(frozen=True)

    pcb_verified: Literal["reported_pass", "not_tested"]
    input_test: Literal["reported_pass", "not_tested"]


class PhysicalButtonProfile(BaseModel):
    model_config = ConfigDict(frozen=True)

    present: bool
    gpio: int | None
    function: str | None
    checks: ButtonChecks


class ButtonsProfile(BaseModel):
    model_config = ConfigDict(frozen=True)

    boot: PhysicalButtonProfile
    power: PhysicalButtonProfile
    evidence: ProfileEvidence


class DeviceProfile(BaseModel):
    """One board diagram in the server's extensible profile catalog."""

    model_config = ConfigDict(frozen=True)

    profile_id: str
    diagram_id: str
    display_name: str
    processor: BoardProcessor
    memory: BoardMemory
    interfaces: BoardInterfaces
    evidence: ProfileEvidence
    display: DisplayProfile | None = None
    microphone: MicrophoneProfile | None = None
    speaker: SpeakerProfile | None = None
    audio_loopback: AudioLoopbackProfile | None = None
    usb_serial: UsbSerialProfile | None = None
    buttons: ButtonsProfile | None = None
