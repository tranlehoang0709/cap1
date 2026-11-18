"""Personal calendar and reminder page backed by the PA-01/PA-02 APIs."""
from datetime import datetime, timezone

import streamlit as st

from nen_tang.backend import BackendError, api


def _error(error: BackendError) -> None:
    st.error(error.message)


def render_page(*_args, **_kwargs):
    st.subheader("Personal calendar")
    events = []
    try:
        result = api("/user/calendar/events")
        events = result.get("items", []) if isinstance(result, dict) else []
    except BackendError as error:
        _error(error)

    with st.form("calendar_event_create", clear_on_submit=True):
        title = st.text_input("Title")
        description = st.text_area("Description")
        left, right = st.columns(2)
        with left:
            starts = st.datetime_input("Starts at", value=datetime.now().replace(second=0, microsecond=0))
        with right:
            ends = st.datetime_input("Ends at", value=datetime.now().replace(second=0, microsecond=0))
        timezone_name = st.text_input("Timezone", value="UTC")
        recurrence = st.text_input("Recurrence rule (optional)", placeholder="FREQ=WEEKLY;BYDAY=MO")
        confirm = st.checkbox("Save even if this overlaps another event")
        create = st.form_submit_button("Create event", type="primary")
    if create:
        try:
            result = api("/user/calendar/events", "POST", {
                "title": title.strip(), "description": description.strip() or None,
                "starts_at": starts.astimezone(timezone.utc).isoformat(),
                "ends_at": ends.astimezone(timezone.utc).isoformat(),
                "timezone": timezone_name.strip() or "UTC",
                "recurrence_rule": recurrence.strip() or None,
                "confirm_conflict": confirm,
            })
            st.success("Event created")
            st.json(result)
        except BackendError as error:
            _error(error)

    st.subheader("Events")
    if events:
        st.dataframe(events, use_container_width=True, hide_index=True)
        with st.expander("Create a reminder"):
            with st.form("reminder_create", clear_on_submit=True):
                message = st.text_input("Reminder message")
                remind_at = st.datetime_input("Remind at", value=datetime.now().replace(second=0, microsecond=0))
                device_id = st.text_input("Xiaozhi device ID (optional)")
                save = st.form_submit_button("Schedule reminder")
            if save:
                try:
                    result = api("/user/reminders", "POST", {
                        "message": message.strip(), "remind_at": remind_at.astimezone(timezone.utc).isoformat(),
                        "device_id": device_id.strip() or None,
                    })
                    st.success("Reminder scheduled")
                    st.json(result)
                except BackendError as error:
                    _error(error)
    else:
        st.info("No calendar events yet.")

    try:
        reminders = api("/user/reminders")
        items = reminders.get("items", []) if isinstance(reminders, dict) else []
        if items:
            st.subheader("Reminders")
            st.dataframe(items, use_container_width=True, hide_index=True)
    except BackendError as error:
        _error(error)
