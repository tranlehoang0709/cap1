"""Final theme rules for the actual Streamlit 1.65 form roots."""
import streamlit as st


def apply_fields_theme(light):
    bg, fg, border, muted, disabled = (
        ("#ffffff", "#17253d", "#bbc9df", "#586b87", "#edf1f7") if light else
        ("#142238", "#e7eeff", "#344969", "#a6b8d3", "#1c2a3e")
    )
    st.markdown(f'''<style>
    .stApp [data-testid="stChatInput"],
    .stApp [data-testid="stTextInputRootElement"] {{
        background:{bg}!important;color:{fg}!important;border:1px solid {border}!important;
        border-radius:10px!important;overflow:hidden;
    }}
    .stApp [data-testid="stChatInput"] div,
    .stApp [data-testid="stTextInputRootElement"] div {{background:transparent!important;color:{fg}!important;border-color:transparent!important;}}
    .stApp [data-testid="stChatInputTextArea"],
    .stApp [data-testid="stTextInputField"] {{
        background:transparent!important;color:{fg}!important;-webkit-text-fill-color:{fg}!important;
        caret-color:{fg}!important;opacity:1!important;border:0!important;box-shadow:none!important;
    }}
    .stApp [data-testid="stChatInputTextArea"]::placeholder,
    .stApp [data-testid="stTextInputField"]::placeholder {{color:{muted}!important;-webkit-text-fill-color:{muted}!important;opacity:1!important;}}
    .stApp [data-testid="stChatInputTextArea"]:disabled {{background:{disabled}!important;color:{muted}!important;-webkit-text-fill-color:{muted}!important;}}
    .stApp [data-testid="stChatInputSubmitButton"] {{background:#6655ff!important;color:#fff!important;border:0!important;border-radius:9px!important;}}
    .stApp [data-testid="stChatInputSubmitButton"] svg {{fill:#fff!important;color:#fff!important;}}
    .stApp [data-testid="stChatInputSubmitButton"]:disabled {{background:{disabled}!important;color:{muted}!important;opacity:1;}}
    .stApp [data-testid="stChatInputSubmitButton"]:disabled svg {{fill:{muted}!important;color:{muted}!important;}}
    .stApp [data-testid="stTextInputRootElement"] button {{background:transparent!important;color:{fg}!important;}}
    .stApp [data-testid="stTextInputRootElement"] button svg {{fill:currentColor!important;}}
    .stApp [data-testid="stChatInput"]:focus-within,
    .stApp [data-testid="stTextInputRootElement"]:focus-within {{border-color:#8172ff!important;box-shadow:0 0 0 2px #8172ff20!important;}}
    </style>''', unsafe_allow_html=True)
