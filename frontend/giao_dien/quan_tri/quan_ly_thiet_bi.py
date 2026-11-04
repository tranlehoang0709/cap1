"""Legacy page names routed to Backend API pages."""
from giao_dien.ket_noi import render, unavailable


def devices(*args, **kwargs):
    return render('devices_admin', admin=True)


def telemetry(*args, **kwargs):
    return render('devices_admin', admin=True)


def devices_admin(*args, **kwargs):
    return render('devices_admin', admin=True)
