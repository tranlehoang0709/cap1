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
    let token;
    try { token = decodeURIComponent(raw); } catch { component.setTriggerValue('received', {invalid:true}); return; }
    if (token.length < 20 || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
      component.setTriggerValue('received', {invalid:true}); return;
    }
    component.setTriggerValue('received', {token});
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
        token = received.get('token')
        if isinstance(token, str) and 20 <= len(token) <= 2048 and re.fullmatch(r'[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', token):
            st.session_state.email_verification_token = token
            st.session_state.verification_link_received = True
            st.session_state.backend_auth_tabs = "Xác minh email"
        else:
            st.warning('Liên kết xác minh không hợp lệ. Hãy yêu cầu gửi lại.')
