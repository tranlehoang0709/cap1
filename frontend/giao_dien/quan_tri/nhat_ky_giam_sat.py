"""Legacy page names routed to Backend API pages."""
from giao_dien.ket_noi import render, unavailable


def logs(*args, **kwargs):
    return render('monitoring_admin', admin=True)


def resources(*args, **kwargs):
    return render('monitoring_admin', admin=True)


def monitoring(*args, **kwargs):
    return render('monitoring_admin', admin=True)
