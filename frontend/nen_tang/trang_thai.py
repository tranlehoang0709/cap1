"""Retired session store. Application data must come from Backend APIs."""
from nen_tang.backend import BackendError, api


def init_demo():
    raise RuntimeError("Demo data has been removed. Use Backend authentication and APIs.")


def data():
    raise RuntimeError("Session data has been removed. Use nen_tang.backend.api().")


def current_user():
    return api("/auth/me")


def approved_devices(user_id):
    return api("/devices", query={"page": 1, "limit": 100})


def preferences(user_id):
    return api("/ai/profile")


def privacy(user_id):
    return api("/users/me/privacy")
