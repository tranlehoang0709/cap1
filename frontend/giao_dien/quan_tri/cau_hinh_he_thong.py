"""Legacy page names routed to Backend API pages."""
from giao_dien.ket_noi import render, unavailable


def settings(*args, **kwargs):
    return render('system_settings', admin=True)


def render_page(*args, **kwargs):
    return render('system_settings', admin=True)
