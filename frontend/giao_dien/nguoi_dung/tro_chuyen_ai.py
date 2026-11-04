"""Legacy page names routed to Backend API pages."""
from giao_dien.ket_noi import render, unavailable


def render_page(*args, **kwargs):
    return render('chat_page', admin=False)


def web_chat(*args, **kwargs):
    return render('chat_page', admin=False)


def render_chat(*args, **kwargs):
    return render('chat_page', admin=False)
