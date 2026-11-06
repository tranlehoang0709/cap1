"""Explicit live E2E host: real app + read-only role probes, no mocks or token export."""
import os
from pathlib import Path
import runpy
import sys
import streamlit as st
if os.environ.get('AIVA_LIVE_USER_E2E') != 'true':
    raise RuntimeError('Explicit live User E2E opt-in required')
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root))
runpy.run_path(str(root/'app.py'),run_name='__main__')
from nen_tang.backend import api, BackendError
account=st.session_state.get('account',{})
if account.get('role')=='USER':
    key='user_live_authorization_probe'
    if key not in st.session_state:
        result={}
        for route in ('/users','/admin/dashboard'):
            try:
                api(route)
                result[route]=200
            except BackendError as error:
                result[route]=error.status
        st.session_state[key]=result
    values=st.session_state[key]
    st.caption('LIVE USER ROLE PROBE: '+','.join(path+'='+str(status) for path,status in values.items()))
