# AIVA-IoT Frontend

Streamlit client for the live AIVA-IoT Backend. The application no longer creates demo users, devices, provider state, conversations, quota figures, or chat replies. If an API is not implemented or available, the page reports that state instead of substituting sample data.

## Run on Windows

```bat
cd /d E:\learn\AI_Project\cap1\frontend
set AIVA_BACKEND_URL=http://127.0.0.1:3000
.venv\Scripts\python.exe -m streamlit run app.py
```

`AIVA_BACKEND_URL` is optional and defaults to `http://127.0.0.1:3000`. Start the Backend and configure its database before signing in. Users authenticate through `/auth/login`; access and refresh tokens are held in Streamlit session state and never written to disk. Logout revokes the refresh session through the Backend.

## Live API coverage

- Sign-in, registration, refresh, logout, profile and password changes.
- User devices and pairing requests; admin device registration and pairing review.
- Assistant profile and user API-key metadata/secret submission to Backend storage.
- Conversation history, privacy preference, quota policies and admin dashboards/logs.
- Provider administration, system settings and firmware metadata/release.

AI Chat intentionally remains disabled because Backend returns HTTP 503 from `/web-chat/messages` until real provider execution and approved quota/usage settlement are ready. The frontend does not show a fabricated response. Quota admission/usage remains a Backend schema blocker, and unsupported admin key flows are not simulated.

The older `giao_dien/` and `ui/` modules are retained for compatibility with existing UI checks, but `app.py` does not import or route to their session-local demo state.
