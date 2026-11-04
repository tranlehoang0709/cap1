"""Legacy page names routed to Backend API pages."""
from giao_dien.ket_noi import render, unavailable


def personal_keys(*args, **kwargs):
    return render('personal_keys', admin=False)
