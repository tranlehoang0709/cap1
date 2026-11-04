"""In-process sliding-window ceiling for the explicitly local robot gateway."""

from collections import deque
import time


class GatewayRateLimit:
    """Limit one authenticated gateway credential to 12 accepted turns/minute.

    This is not a substitute for Backend per-user admission. The development
    gateway has no authenticated user identity, so it deliberately does not
    key limits by caller-supplied device/client metadata.
    """

    def __init__(self, *, clock=time.monotonic, limit=12, window_seconds=60, max_principals=10000):
        self.clock, self.limit, self.window_seconds = clock, limit, window_seconds
        self.max_principals = max_principals
        self._windows = {}

    def claim(self, principal: str) -> bool:
        now = self.clock()
        for key in tuple(self._windows):
            queue = self._windows[key]
            while queue and queue[0] <= now - self.window_seconds:
                queue.popleft()
            if not queue:
                del self._windows[key]
        if principal not in self._windows and len(self._windows) >= self.max_principals:
            return False
        window = self._windows.setdefault(principal, deque())
        if len(window) >= self.limit:
            return False
        window.append(now)
        return True
