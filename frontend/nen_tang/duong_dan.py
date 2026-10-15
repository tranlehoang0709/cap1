"""Đường dẫn tuyệt đối của dự án, không phụ thuộc thư mục chạy lệnh.

Các bộ đọc tài nguyên hiện tại được giữ nguyên trong Giai đoạn 1.
"""
from pathlib import Path

FRONTEND_ROOT = Path(__file__).resolve().parents[1]
ASSETS_DIR = FRONTEND_ROOT / "ui" / "assets"
