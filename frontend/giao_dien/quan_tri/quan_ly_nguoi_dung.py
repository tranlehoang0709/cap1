"""Legacy page names routed to Backend API pages."""
from giao_dien.ket_noi import render, unavailable


def users(*args, **kwargs):
    return render('users_admin', admin=True)


def roles(*args, **kwargs):
    return render('users_admin', admin=True)


def render_page(*args, **kwargs):
    return render('users_admin', admin=True)
