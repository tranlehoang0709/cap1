"""Giữ tương thích bộ dựng tài liệu robot cũ; không nhân đôi implementation."""
from functools import lru_cache
import json
from pathlib import Path
import re
from thanh_phan.robot.du_phong import ROBOT
from thanh_phan.robot.tai_lieu_3d import ASSETS, _read_asset, asset, build_document
