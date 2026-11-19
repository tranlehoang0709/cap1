"""Receive a verification fragment in RAM; never query parameters or automatic verification."""
import re
import streamlit as st
import streamlit.components.v2 as components

_FRAGMENT_JS = r"""
export default function(component) {
  const consume = () => {
    if (!location.hash.startsWith('#verify-email=')) return;
    const raw = location.hash.slice('#verify-email='.length);
    history.replaceState(history.state, '', location.pathname + location.search);
    let code;
    try { code = decodeURIComponent(raw); } catch { component.setTriggerValue('received', {invalid:true}); return; }
    if (!/^[0-9]{6}$/.test(code)) {
      component.setTriggerValue('received', {invalid:true}); return;
    }
    component.setTriggerValue('received', {code});
  };
  consume();
  window.addEventListener('hashchange', consume);
  return () => window.removeEventListener('hashchange', consume);
}
"""
_fragment = components.component('aiva_verification_fragment', js=_FRAGMENT_JS)


def receive_verification_link():
    result = _fragment(key='verification_fragment_receiver', on_received_change=lambda: None, height=0)
    received = result.received
    if isinstance(received, dict):
        code = received.get('code')
        if isinstance(code, str) and re.fullmatch(r'[0-9]{6}', code):
            st.session_state.email_verification_code = code
            st.session_state.verification_link_received = True
            st.session_state.backend_auth_tabs = "Xác minh email"
        else:
            st.warning('Liên kết xác minh không hợp lệ. Hãy yêu cầu gửi lại.')
