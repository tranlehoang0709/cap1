"""Regression checks for shared table filtering and selection transitions."""
from smoke import ROOT, clean
from streamlit.testing.v1 import AppTest

source = f'''
import sys
sys.path.insert(0, {str(ROOT)!r})
import streamlit as st
from ui.common import table, select_record
if "rows" not in st.session_state:
    st.session_state.rows = [
        dict(id=f"row-{{i:02}}", group="A" if i < 30 else "B")
        for i in range(65)
    ]
records = table(st.session_state.rows, "test", ["group"])
selected = select_record(records, "selected")
if selected:
    st.caption(selected["id"])
'''
app = clean(AppTest.from_string(source).run())
assert len(app.dataframe[0].value) == 10
app.number_input(key="page_test").set_value(3)
clean(app.run())
assert app.dataframe[0].value.iloc[0]["id"] == "row-20"

# Literal search must work even when it removes the currently selected record.
app.text_input(key="search_test").set_value(" row-64 ")
clean(app.run())
assert app.number_input(key="page_test").value == 1
assert app.selectbox(key="selected").value == "row-64"
assert app.selectbox(key="filter_test_group").options == ["Tất cả", "A", "B"]
app.text_input(key="search_test").set_value("[")
clean(app.run())
assert any("Không có kết quả" in element.value for element in app.info)
assert not app.dataframe
assert all(element.key != "selected" for element in app.selectbox)

app.button(key="reset_test").click()
clean(app.run())
assert app.text_input(key="search_test").value == ""
assert len(app.dataframe[0].value) == 10
app.selectbox(key="filter_test_group").set_value("B")
clean(app.run())
assert set(app.dataframe[0].value["group"]) == {"B"}

# A removed filter value and deleted selection must recover on the next rerun.
app.session_state["rows"] = [dict(id="remaining", group="A")]
clean(app.run())
assert app.selectbox(key="filter_test_group").value == "Tất cả"
assert app.selectbox(key="selected").value == "remaining"
assert app.number_input(key="page_test").disabled
app.session_state["appearance"] = "☀️ Sáng"
clean(app.run())
assert len(app.table[0].value) == 1
app.session_state["rows"] = []
clean(app.run())
assert any("Chưa có dữ liệu" in element.value for element in app.info)
print("PASS: pagination, literal search, empty results, reset, stale filters and selections, both themes")
