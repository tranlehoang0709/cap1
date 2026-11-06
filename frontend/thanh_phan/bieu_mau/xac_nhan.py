"""Điều khiển xác nhận, giữ nguyên nhãn và widget key."""
import streamlit as st


def confirm(key, label="Tôi xác nhận thao tác này", *, scope=None):
    if scope is not None:
        scope_key = f"confirmation_scope_{key}"
        if st.session_state.get(scope_key) != scope:
            if f"confirm_{key}" in st.session_state:
                st.session_state[f"confirm_{key}"] = False
            st.session_state[scope_key] = scope
    return st.checkbox(label, key=f"confirm_{key}")



@st.dialog("Xác nhận thao tác")
def _action_dialog(scope, message, action):
    st.warning(message)
    accepted = confirm("action_" + scope, scope=scope)
    left, right = st.columns(2)
    if left.button("Xác nhận", type="primary", disabled=not accepted, key="accept_" + scope):
        result = action()
        if result is not None:
            st.session_state.pop("pending_api_confirmation", None)
            st.session_state.ui_notice = "Backend đã xác nhận thao tác."
            st.rerun()
    if right.button("Hủy", key="cancel_" + scope):
        st.session_state.pop("pending_api_confirmation", None)
        st.rerun()


def confirm_action(scope, message, action):
    """A fresh, record-bound confirmation for an explicit user action."""
    st.session_state["confirm_action_" + scope] = False
    st.session_state.pending_api_confirmation = {
        "scope": scope, "message": message, "action": action,
        "owner": st.session_state.account["id"],
    }
    st.rerun()


def render_pending_confirmation():
    pending = st.session_state.get("pending_api_confirmation")
    if not pending:
        return
    account = st.session_state.get("account")
    if not account or pending["owner"] != account.get("id"):
        st.session_state.pop("pending_api_confirmation", None)
        return
    _action_dialog(pending["scope"], pending["message"], pending["action"])

