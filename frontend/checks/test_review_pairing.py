"""Targeted pairing pagination/error fixtures. No live account, API or DB writes."""
import sys
from pathlib import Path
import unittest
from unittest.mock import patch
from streamlit.testing.v1 import AppTest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from giao_dien import live
from nen_tang.backend import BackendError
APP="""import streamlit as st
from giao_dien.live import user_devices
st.session_state.account={'id':'fixture-user'}
st.session_state.api_table_index=0
st.session_state.ui_active_page='Robot của tôi'
user_devices()
"""

class PairingReviewTests(unittest.TestCase):
    def make_api(self,total,fail_page=None):
        pages=[]
        def api(path,*args,query=None,**kwargs):
            if args and args[0] != 'GET':
                self.fail('Unexpected mutation in read-only fixture')
            if path=='/devices':
                return {'items':[],'total':0,'page':1,'limit':100,'total_pages':0}
            self.assertEqual(path,'/devices/pairing-requests/mine')
            page=query['page'];pages.append(page)
            if page==fail_page:raise BackendError(503,'Pairing list temporarily unavailable')
            start=(page-1)*100
            return {'items':[{'id':str(i),'status':'pending'} for i in range(start+1,min(start+100,total)+1)],
                    'total':total,'page':page,'limit':100,'total_pages':(total+99)//100}
        return api,pages
    def test_all_requests_are_accessible_after_backend_page_one(self):
        api,pages=self.make_api(101)
        with patch.object(live,'api',side_effect=api):
            app=AppTest.from_string(APP).run()
            self.assertFalse(app.exception)
            self.assertEqual(pages,[1,2])
            self.assertTrue(any('101 / 101' in item.value for item in app.caption))
            next(item for item in app.number_input if item.label=='Trang').set_value(11).run()
            self.assertFalse(app.exception)
            self.assertEqual(str(app.dataframe[0].value.iloc[0]['id']),'101')
    def test_later_page_error_does_not_present_partial_list_as_complete(self):
        api,pages=self.make_api(101,fail_page=2)
        with patch.object(live,'api',side_effect=api):
            app=AppTest.from_string(APP).run()
        self.assertFalse(app.exception)
        self.assertEqual(pages,[1,2])
        self.assertTrue(any('temporarily unavailable' in item.value for item in app.error))
        self.assertEqual(len(app.dataframe),0)
    def test_empty_api_result_keeps_the_empty_state_without_fake_rows(self):
        api,pages=self.make_api(0)
        with patch.object(live,'api',side_effect=api):
            app=AppTest.from_string(APP).run()
        self.assertFalse(app.exception)
        self.assertEqual(pages,[1])
        self.assertEqual(len(app.dataframe),0)
        self.assertTrue(any('Chưa có dữ liệu' in item.value for item in app.info))
if __name__=='__main__':unittest.main()
