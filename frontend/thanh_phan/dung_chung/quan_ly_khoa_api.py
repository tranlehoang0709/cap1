"""Personal credential editor backed by Backend."""
from giao_dien.ket_noi import render, unavailable

def key_manager(store, prefix):
    if prefix == "personal":
        return render("personal_keys")
    return unavailable("Quản lý khóa API theo kho session đã ngừng hỗ trợ")
