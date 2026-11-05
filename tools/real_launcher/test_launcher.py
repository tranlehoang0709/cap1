"""Isolated launcher regressions, not live service evidence."""
import contextlib
import importlib.util
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('aiva_real_launcher', Path(__file__).with_name('launch.py'))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)
SERVICE = ('Backend', Path('.'), 3000, 'http://127.0.0.1:3000', ['node'], '/health')
class LauncherTests(unittest.TestCase):
    def test_unrelated_healthy_port_is_a_conflict(self):
        with patch.object(launcher,'occupied',return_value=True), patch.object(launcher,'http_ok',return_value=True), patch.object(launcher,'process_state',return_value='LISTENER PRESENT (service ownership unverified)'):
            self.assertEqual(launcher.service_status('BE',SERVICE)[0],'PORT_CONFLICT')
    def test_owned_unhealthy_process_does_not_pass(self):
        with patch.object(launcher,'occupied',return_value=True), patch.object(launcher,'http_ok',return_value=False), patch.object(launcher,'process_state',return_value='RUNNING (service listener PID 7)'):
            self.assertEqual(launcher.service_status('BE',SERVICE)[0],'UNHEALTHY')
    def test_check_separates_contract_blockers_from_running_services(self):
        with patch.object(sys,'argv',['run_all','--check']), patch.object(launcher,'prepare',return_value=({'BE':SERVICE},{'BE':[]},{},['FEATURE BLOCKED contract: AI_CONFIG_CONTRACT_APPROVED'])), patch.object(launcher,'service_status',return_value=('RUNNING',True,'RUNNING (service listener PID 7)')), patch.object(launcher.subprocess,'Popen') as spawn, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(launcher.main(),0)
            spawn.assert_not_called()
    def test_launcher_never_starts_over_a_foreign_listener(self):
        with patch.object(sys,'argv',['run_all']), patch.object(launcher,'prepare',return_value=({'BE':SERVICE},{'BE':[]},{},[])), patch.object(launcher,'service_status',return_value=('PORT_CONFLICT',True,'unverified')), patch.object(launcher.subprocess,'Popen') as spawn, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(launcher.main(),1)
            spawn.assert_not_called()
if __name__=='__main__': unittest.main()
