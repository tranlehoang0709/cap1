"""Authorize explicit provisioned proof. No MAC mapping or firmware token guessing."""

from datetime import datetime, timezone
from uuid import uuid4

from app.clients.backend import BackendClient, BackendCode, BackendError
from app.models import backend as dto
from app.models.llm import ConversationKey
from app.services.orchestrator import Control


class AuthorizedSession:
    def __init__(self, client: BackendClient, proof: dto.DeviceProof, authorization: dto.Authorization):
        self.client, self._proof, self.authorization = client, proof, authorization
        self.key = ConversationKey(authorization.ownerUserId, uuid4().hex, authorization.deviceId)
        self.config = None
        self.orchestrator = None
        self.valid = True

    def bind(self, orchestrator):
        if not self.valid or orchestrator.key != self.key or self.orchestrator is not None:
            raise BackendError(BackendCode.BINDING)
        self.orchestrator = orchestrator

    def start_turn(self, turn_id: str):
        if not self.valid or self.config is None or self.orchestrator is None:
            raise BackendError(BackendCode.BINDING)
        return self.orchestrator.start_turn(turn_id)

    def microphone(self, turn_id, frame):
        if not self.valid or self.config is None or self.orchestrator is None:
            return False
        return self.orchestrator.microphone(turn_id, frame)

    async def invalidate(self, command=Control.REVOKE):
        self.valid = False
        if self.orchestrator is not None and self.orchestrator.turn is not None:
            await self.orchestrator.control(command, key=self.key, turn_id=self.orchestrator.turn.turn_id)

    async def resolve(self, context):
        if not self.valid:
            raise BackendError(BackendCode.BINDING)
        try:
            self.config = await self.client.resolve_config(dto.ConfigRequest(userId=self.key.user_id, deviceId=self.key.device_id), context)
            return self.config
        except BackendError:
            await self.invalidate()
            raise

    async def heartbeat_received(self, context, *, telemetry: dto.Telemetry | None = None, received_at: datetime | None = None):
        """Call only for an approved direct robot heartbeat, NEVER WS Ping/Pong.

        Timestamp is server receipt time; callers retrying must preserve it. No
        timer/telemetry source is invented. No automatic retries are performed.
        """
        if not self.valid:
            raise BackendError(BackendCode.BINDING)
        received_at = datetime.now(timezone.utc) if received_at is None else received_at
        if received_at.tzinfo is None or received_at.utcoffset().total_seconds() != 0:
            raise ValueError("UTC server receipt timestamp required")
        request = dto.Heartbeat(deviceUid=self._proof.deviceUid, credential=self._proof.credential,
            observedAt=received_at.replace(microsecond=0).isoformat().replace("+00:00", "Z"), telemetry=telemetry)
        try:
            result = await self.client.heartbeat(request, context)
            if result.deviceId != self.key.device_id:
                raise BackendError(BackendCode.BINDING)
            return result
        except BackendError:
            await self.invalidate()
            raise


async def authorize_device(client: BackendClient, proof: dto.DeviceProof, context, *, expected_device_id: str | None = None):
    """Proof/optional ID must come from approved provisioning, not self-declared MAC."""
    authorization = await client.authorize(proof, context)
    if expected_device_id is not None and authorization.deviceId != expected_device_id:
        raise BackendError(BackendCode.BINDING)
    return AuthorizedSession(client, proof, authorization)
