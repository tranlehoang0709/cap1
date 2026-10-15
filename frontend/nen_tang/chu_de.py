"""Một bảng màu ngữ nghĩa và stylesheet chung cho các giao diện AIVA."""
from nen_tang.duong_dan import FRONTEND_ROOT
import streamlit as st


def apply_theme():
    st.session_state.aiva_panel_index = 0
    light = st.session_state.get("appearance") == "☀️ Sáng"
    palette = {
        "bg": "#f4f5f8" if light else "#10131c",
        "surface": "#fdfdfe" if light else "#191e2a",
        "raised": "#eef0f6" if light else "#222939",
        "text": "#202638" if light else "#eef0f7",
        "muted": "#5d687d" if light else "#a4aec3",
        "border": "#d7dce7" if light else "#343d50",
        "control-border": "#8792a7" if light else "#68758f",
        "accent": "#6250cb" if light else "#b1a1ff",
        "button": "#6250cb" if light else "#7663d8",
        "tint": "#ebe7fb" if light else "#302a49",
        "good": "#17684b" if light else "#81d6b0",
        "good-bg": "#e5f3ec" if light else "#1c352d",
        "bad": "#a13344" if light else "#f3a0ab",
        "bad-bg": "#fae9ed" if light else "#402831",
    }
    tokens = ";".join(f"--aiva-{key}:{value}" for key, value in palette.items())
    css = (FRONTEND_ROOT / "kieu_dang" / "portal.css").read_text(encoding="utf-8")
    components = (FRONTEND_ROOT / "kieu_dang" / "components.css").read_text(encoding="utf-8")
    # Tokens và hai stylesheet được cập nhật cùng một phần tử HTML.
    # Giữ tokens trên :root để dropdown portal và robot cùng đọc một bảng màu.
    st.html(
        f"<style id=\"aiva-application-theme\">"
        f":root{{color-scheme:{'light' if light else 'dark'};{tokens}}}"
        f"{css}\n{components}</style>"
    )
