"""DTO chỉ lấy các field đã thấy trong controller/service/type Backend hiện tại."""
from dataclasses import dataclass
import re

LIFECYCLES = {"available", "pending_approval", "assigned", "reset_pending", "maintenance"}
CONNECTIONS = {"online", "offline"}
PAIRING_STATUSES = {"pending", "approved", "rejected", "cancelled"}

def object_value(value):
    if not isinstance(value, dict): raise ValueError("Invalid response object")
    return value

def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]{0,18}", value) or int(value)>9223372036854775807:
        raise ValueError("Invalid Backend identifier")
    return value

def text(value, nullable=False):
    if value is None and nullable: return None
    if not isinstance(value, str) or not value.strip(): raise ValueError("Invalid response text")
    return value

def enum(value, values):
    if not isinstance(value, str) or value not in values: raise ValueError("Unknown response status")
    return value

@dataclass(frozen=True)
class DeviceDTO:
    id: str
    device_uid: str
    display_name: str | None
    lifecycle_status: str
    connection_status: str
    last_seen_at: str | None

    @classmethod
    def parse(cls, value):
        value=object_value(value)
        if not {"id","device_uid","display_name","lifecycle_status","connection_status","last_seen_at"} <= value.keys(): raise ValueError("Missing device fields")
        return cls(identifier(value.get("id")),text(value.get("device_uid")),text(value.get("display_name"),True),
                   enum(value.get("lifecycle_status"),LIFECYCLES),enum(value.get("connection_status"),CONNECTIONS),
                   text(value.get("last_seen_at"),True))

@dataclass(frozen=True)
class PairingRequestDTO:
    id: str
    device_id: str
    user_id: str
    status: str
    created_at: str
    review_note: str | None

    @classmethod
    def parse(cls,value):
        value=object_value(value)
        if not {"id","device_id","user_id","status","created_at","review_note"} <= value.keys(): raise ValueError("Missing pairing fields")
        return cls(identifier(value.get("id")),identifier(value.get("device_id")),identifier(value.get("user_id")),
                   enum(value.get("status"),PAIRING_STATUSES),text(value.get("created_at")),text(value.get("review_note"),True))

@dataclass(frozen=True)
class PageDTO:
    items: tuple
    total: int
    page: int
    limit: int
    total_pages: int

    @classmethod
    def parse(cls,value,item_parser):
        value=object_value(value)
        if not isinstance(value.get("items"),list): raise ValueError("Missing items")
        for key in ("total","page","limit","total_pages"):
            if type(value.get(key))is not int: raise ValueError("Invalid pagination")
        total,page,limit,pages=(value[k]for k in ("total","page","limit","total_pages"))
        if total<0 or page<1 or not 1<=limit<=100 or pages!=(total+limit-1)//limit or len(value["items"])>min(limit,max(0,total-(page-1)*limit)):
            raise ValueError("Inconsistent pagination")
        items=tuple(item_parser(item)for item in value["items"])
        if len({item.id for item in items})!=len(items): raise ValueError("Duplicate identifiers")
        return cls(items,total,page,limit,pages)

@dataclass(frozen=True)
class DeviceDetailDTO:
    """Shape camelCase từ OwnershipService, GET /user/devices/:id."""
    id: str
    deviceUid: str
    displayName: str | None
    connectionStatus: str

    @classmethod
    def parse(cls,value):
        value=object_value(value)
        if not {"id","deviceUid","displayName","connectionStatus"} <= value.keys(): raise ValueError("Missing detail fields")
        return cls(identifier(value.get("id")),text(value.get("deviceUid")),text(value.get("displayName"),True),enum(value.get("connectionStatus"),CONNECTIONS))

@dataclass(frozen=True)
class DashboardAccessDTO:
    """GET /user/dashboard/access; không suy quyền từ DEMO hoặc số robot."""
    allowed: bool
    reason: str | None

    @classmethod
    def parse(cls,value):
        value=object_value(value)
        if set(value)!={"allowed","reason"}or type(value["allowed"])is not bool: raise ValueError("Invalid access response")
        if value["allowed"] and value["reason"]is not None or not value["allowed"] and value["reason"]!="NO_APPROVED_DEVICE":
            raise ValueError("Inconsistent access response")
        return cls(value["allowed"],value["reason"])
