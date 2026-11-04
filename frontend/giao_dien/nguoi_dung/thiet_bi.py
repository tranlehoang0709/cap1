"""Legacy page names routed to Backend API pages."""
from giao_dien.ket_noi import render, unavailable


def pairing(*args, **kwargs):
    return render('user_devices', admin=False)


def robots(*args, **kwargs):
    return render('user_devices', admin=False)


def robot_cards(*args, **kwargs):
    return render('user_devices', admin=False)


def devices_user(*args, **kwargs):
    return render('user_devices', admin=False)
