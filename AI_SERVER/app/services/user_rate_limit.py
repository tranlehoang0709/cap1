"""Additional per-process user ceiling; never substitutes Backend admission."""

import time
from collections import deque

from app.clients.backend import BackendCode, BackendError


class UserRateLimit:
    def __init__(self, *, clock=time.monotonic, max_users=10000):
        self.clock = clock
        self.max_users = max_users
        self._windows = {}

    def claim(self, user_id):
        # No awaits: trim/check/append is atomic within the application event loop.
        now = self.clock()
        for key in list(self._windows):
            window = self._windows[key]
            while window and window[0] <= now - 60:
                window.popleft()
            if not window:
                del self._windows[key]
        if user_id not in self._windows and len(self._windows) >= self.max_users:
            raise BackendError(BackendCode.LIMIT)
        window = self._windows.setdefault(user_id, deque())
        if len(window) >= 12:
            raise BackendError(BackendCode.HTTP, status=429, reason="QUOTA_EXCEEDED")
        window.append(now)
