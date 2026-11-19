"""PA availability and acknowledgement contracts; no endpoint configuration."""
from typing import Literal

from pydantic import Field

from app.personal_assistant.schema import StrictModel

AvailabilityStatus = Literal['AVAILABLE', 'NOT_IMPLEMENTED', 'DISABLED', 'UNAVAILABLE']
ExecutionOutcome = Literal['NOT_EXECUTED', 'CONFIRMED', 'REJECTED', 'UNKNOWN']
ReconciliationState = Literal['NOT_REQUIRED', 'PENDING_RECONCILIATION']


class ToolAvailability(StrictModel):
    status: AvailabilityStatus = 'NOT_IMPLEMENTED'
    endpoint_verified: bool = False
    contract_verified: bool = False
    auth_verified: bool = False
    idempotency_verified: bool = False
    revision_verified: bool = False

    @property
    def verified(self):
        return self.endpoint_verified and self.contract_verified and self.auth_verified


class BackendReceipt(StrictModel):
    """Trusted adapter normalizes a real authenticated Backend acknowledgement."""
    execution_id: str = Field(min_length=1, max_length=128)
    tool_id: str = Field(min_length=1, max_length=100)
    operation_id: str = Field(pattern=r'^op[1-9][0-9]*$')
    user_id: str = Field(min_length=1, max_length=128, exclude=True, repr=False)
    session_id: str = Field(min_length=1, max_length=128, exclude=True, repr=False)
    correlation_id: str = Field(min_length=1, max_length=128, exclude=True, repr=False)
    idempotency_key: str | None = Field(default=None, exclude=True, repr=False)

    def matches(self, tool_id, operation_id, context, idempotency_key):
        return (self.tool_id, self.operation_id, self.user_id, self.session_id,
                self.correlation_id, self.idempotency_key) == (
                    tool_id, operation_id, context.user_id, context.session_id,
                    context.correlation_id, idempotency_key)
