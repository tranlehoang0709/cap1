"""Legacy page names routed to Backend API pages."""
from giao_dien.ket_noi import render, unavailable


def assistant(*args, **kwargs):
    return render('assistant_settings', admin=False)


def provider(*args, **kwargs):
    return render('assistant_settings', admin=False)


def render_page(*args, **kwargs):
    return render('assistant_settings', admin=False)
