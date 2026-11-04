"""Legacy page names routed to Backend API pages."""
from giao_dien.ket_noi import render, unavailable


def providers(*args, **kwargs):
    return render('ai_admin', admin=True)


def server(*args, **kwargs):
    return render('monitoring_admin', admin=True)


def ai(*args, **kwargs):
    return render('ai_admin', admin=True)
