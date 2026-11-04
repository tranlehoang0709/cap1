"""Legacy page names routed to Backend API pages."""
from giao_dien.ket_noi import render, unavailable


def privacy_page(*args, **kwargs):
    return render('privacy_page', admin=False)
