"""Các phép kiểm tra dữ liệu đầu vào dùng chung."""


def email_valid(value):
    import re
    return bool(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value))
