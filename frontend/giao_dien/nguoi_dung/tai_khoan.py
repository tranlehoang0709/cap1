"""Legacy page names routed to Backend API pages."""
from giao_dien.ket_noi import render, unavailable


def render_page(*args, **kwargs):
    return render('account_page', admin=False)
