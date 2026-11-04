"""Legacy page names routed to Backend API pages."""
from giao_dien.ket_noi import render, unavailable


def history(*args, **kwargs):
    return render('history_page', admin=False)


def render_page(*args, **kwargs):
    return render('history_page', admin=False)


def memory(*args, **kwargs):
    return unavailable('Bộ nhớ dài hạn')


def knowledge(*args, **kwargs):
    return unavailable('Tài liệu cá nhân')
