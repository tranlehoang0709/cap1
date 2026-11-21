import asyncio
import time

from app.clients.backend import BackendCode, BackendError
from app.models import backend as dto
from app.services.audio_context import AudioContext
from app.services.voice_memory import VoiceMemoryContext, asks_for_personal_memory, extract_consented_facts, handle_voice_memory


def context():
    return AudioContext(deadline=time.monotonic() + 2)


def test_extracts_only_explicitly_consented_name_and_residence():
    facts = extract_consented_facts("Hãy nhớ tên tôi là Minh và tôi sống ở Đà Nẵng.")
    assert [(item.key, item.value) for item in facts] == [
        ("profile.name", "Minh"), ("profile.residence", "Đà Nẵng")]
    assert extract_consented_facts("Tên tôi là Minh và tôi sống ở Đà Nẵng.") == ()
    assert asks_for_personal_memory("Tôi tên là gì?")
    assert asks_for_personal_memory("Tôi sống ở đâu?")


class MemoryBackend:
    def __init__(self):
        self.values = {}
        self.writes = []
        self.fail = False

    async def upsert_memories(self, user_id, device_id, memories, _context):
        if self.fail:
            raise BackendError(BackendCode.NETWORK)
        self.writes.append((user_id, device_id, tuple(memories)))
        self.values.setdefault(user_id, {}).update({item.key: item.value for item in memories})

    async def memory_context(self, user_id, _device_id, _context):
        if self.fail:
            raise BackendError(BackendCode.NETWORK)
        items = [dto.MemoryContextItem(key=key, value=value, category="personal_information",
            updatedAt="2026-11-20T01:00:00.000Z") for key, value in self.values.get(user_id, {}).items()]
        return dto.MemoryContextResult(userId=user_id, items=items)


def test_save_then_new_session_reads_persisted_backend_value_and_updates_latest():
    async def scenario():
        backend = MemoryBackend()
        first = VoiceMemoryContext(backend, "7", "42")
        saved = await first.enrich("Hãy nhớ tên tôi là Minh và tôi sống ở Đà Nẵng.", "base", context())
        assert "backend_state=saved" in saved and '"profile.name": "Minh"' in saved
        restarted = VoiceMemoryContext(backend, "7", "42")
        recalled = await restarted.enrich("Tôi sống ở đâu?", "base", context())
        assert '"profile.residence": "Đà Nẵng"' in recalled
        await restarted.enrich("Hãy nhớ tên tôi là An.", "base", context())
        latest = await VoiceMemoryContext(backend, "7", "42").enrich("Tôi tên là gì?", "base", context())
        assert '"profile.name": "An"' in latest and '"profile.name": "Minh"' not in latest
    asyncio.run(scenario())


def test_users_are_isolated_and_backend_failure_is_fail_closed():
    async def scenario():
        backend = MemoryBackend()
        await VoiceMemoryContext(backend, "7", "42").enrich("Hãy nhớ tên tôi là Minh.", "base", context())
        other = await VoiceMemoryContext(backend, "8", "43").enrich("Tôi tên là gì?", "base", context())
        assert "Minh" not in other
        backend.fail = True
        failed = await VoiceMemoryContext(backend, "7", "42").enrich("Hãy nhớ tên tôi là An.", "base", context())
        assert "backend_state=save_failed" in failed
        assert "never guess" in failed and "Say that a memory was saved only" in failed
    asyncio.run(scenario())
def test_accepts_observed_stt_name_variant_and_keeps_multiple_facts():
    text = "Tô Trinh là Hoàng, và sống ở Đà Nẵng, bạn nhớ điều đó."
    facts = extract_consented_facts(text)
    assert [(item.key, item.value) for item in facts] == [
        ("profile.name", "Hoàng"), ("profile.residence", "Đà Nẵng")]


def test_live_voice_requires_consent_and_an_acknowledged_backend_write():
    class Session:
        values = {}
        fail = False

        async def personal_memory(self, _context, *, write):
            if self.fail:
                raise BackendError(BackendCode.NETWORK)
            self.values.update(write or {})
            return dto.DevicePersonalMemoryResult(saved=bool(write), name=self.values.get('name'),
                                                  residence=self.values.get('residence'))

    async def scenario():
        session = Session()
        await handle_voice_memory(session, 'Đừng ghi nhớ tên tôi là Minh.', context())
        assert session.values == {}
        assert 'chưa biết tên' in await handle_voice_memory(session, 'Tôi tên là gì?', context())
        session.fail = True
        assert 'chưa thể xác nhận' in await handle_voice_memory(session, 'Hãy nhớ tên tôi là Minh.', context())
        session.fail = False
        assert 'đã ghi nhớ' in await handle_voice_memory(session, 'Hãy nhớ tên tôi là Minh.', context())
        assert 'Minh' in await handle_voice_memory(Session(), 'Tôi tên là gì?', context())

    asyncio.run(scenario())
