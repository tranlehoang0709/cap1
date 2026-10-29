"""Dựng iframe khép kín từ bundle cục bộ, giữ nguyên srcdoc và cache."""
from functools import lru_cache
import json
import re

from nen_tang.duong_dan import ASSETS_DIR
from thanh_phan.robot.du_phong import ROBOT

ASSETS = ASSETS_DIR / "aiva3d"


@lru_cache(maxsize=8)
def _read_asset(name, modified_ns):
    return (ASSETS / name).read_text(encoding="utf-8")


def asset(name):
    path = ASSETS / name
    return _read_asset(name, path.stat().st_mtime_ns)


def build_document(*, hero=False, online=True, light=False, paused=False, show_expressions=False):
    config = {"hero": bool(hero), "online": bool(online), "paused": bool(paused)}
    values = {
        "STYLE": asset("style.css") + f"\nhtml,body{{height:{350 if hero else 200}px}}",
        # CSS trang cha là nguồn theme. Srcdoc ổn định giữ iframe,
        # WebGL và camera khi chỉ đổi giao diện sáng/tối qua rerun.
        "THEME": f"dark {'hero' if hero else 'card'}",
        "CONFIG": json.dumps(config, separators=(",", ":")),
        "FALLBACK": ROBOT,
        "DIAGNOSTICS": asset("diagnostics.js"),
        # Bảo vệ ranh giới thẻ script, kể cả chuỗi trong bundle.
        "BUNDLE": re.sub(r"</script", r"<\\/script", asset("robot.bundle.js"), flags=re.I),
    }
    document = re.sub(r"__(STYLE|THEME|CONFIG|FALLBACK|DIAGNOSTICS|BUNDLE)__",
                  lambda match: values[match.group(1)], asset("template.html"))
    # Chỉ trang Robot chủ động bật selector; mặc định giữ nguyên srcdoc cũ.
    if show_expressions:
        document = document.replace('class="expression-demo" hidden', 'class="expression-demo"', 1)
    return document
