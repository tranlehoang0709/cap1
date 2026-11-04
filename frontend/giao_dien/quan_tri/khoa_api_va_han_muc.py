"""Legacy page names routed to Backend API pages."""
from giao_dien.ket_noi import render, unavailable


def system_keys(*args, **kwargs):
    return unavailable('Quản lý system API key')


def quotas(*args, **kwargs):
    return render('quota_admin', admin=True)


def keys(*args, **kwargs):
    return render('quota_admin', admin=True)
