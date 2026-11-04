"""Legacy page names routed to Backend API pages."""
from giao_dien.ket_noi import render, unavailable


def usage(*args, **kwargs):
    return render('quota_admin', admin=False)


def dashboard_user(*args, **kwargs):
    return render('dashboard_user', admin=False)
