"""Read-only endpoints for board profile diagrams."""

from fastapi import APIRouter, HTTPException

from app.devices.catalog import get_device_profile, list_device_profiles
from app.models.device_profile import DeviceProfile

router = APIRouter(prefix="/device-profiles", tags=["device-profiles"])


@router.get("", response_model=list[DeviceProfile])
def list_profiles() -> list[DeviceProfile]:
    return list(list_device_profiles())


@router.get("/{profile_id}", response_model=DeviceProfile)
def read_profile(profile_id: str) -> DeviceProfile:
    profile = get_device_profile(profile_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Device profile not found")
    return profile
