"""Legacy page names routed to Backend API pages."""
from giao_dien.ket_noi import render, unavailable


def firmware(*args, **kwargs):
    return render('firmware_admin', admin=True)
