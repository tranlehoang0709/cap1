"""Legacy page names routed to Backend API pages."""
from giao_dien.ket_noi import render, unavailable


def dashboard(*args, **kwargs):
    return render('dashboard_admin', admin=True)


def dashboard_admin(*args, **kwargs):
    return render('dashboard_admin', admin=True)
