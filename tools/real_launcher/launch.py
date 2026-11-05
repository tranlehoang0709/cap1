"""Real services only. No installations, migrations, login or AI generation probes."""
from pathlib import Path
import importlib
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
AI = ROOT / 'AI_SERVER'
BE = ROOT / 'BE'
FE = ROOT / 'frontend'
AI_PY = AI / '.venv/Scripts/python.exe'
FE_PY = FE / '.venv/Scripts/python.exe'


def capture(command, cwd, env=None, timeout=30):
    return subprocess.run([str(x) for x in command], cwd=cwd, env=env,
                          capture_output=True, text=True, timeout=timeout)


def occupied(port):
    # Check all listening interfaces, including IPv6; never stop another process.
    result = capture(['netstat.exe', '-an', '-p', 'tcp'], ROOT)
    if result.returncode:
        raise RuntimeError('Cannot inspect listening ports')
    return any(len(parts := line.split()) >= 4 and parts[0] == 'TCP'
               and parts[1].rsplit(':', 1)[-1] == str(port) and parts[3] == 'LISTENING'
               for line in result.stdout.splitlines())


def http_ok(url, is_health=False):
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(url, timeout=2) as response:
            data = response.read(65536)
            return response.status == 200 and (not is_health or json.loads(data).get('status') == 'ok')
    except Exception:
        return False


def prepare():
    os.chdir(ROOT)
    from dotenv import dotenv_values
    ai_env = {**dotenv_values(AI / '.env'), **os.environ}
    env = dict(os.environ)
    # Runtime safety switches only. The actual .env files are never modified.
    env['AI_SERVER_BACKEND_MODE'] = 'integrated'
    for key in ai_env:
        if key.startswith('AI_SERVER_') and ('DEMO' in key or 'BENCHMARK' in key or key.endswith('_TEST_ENABLE')):
            env[key] = 'false'
    env['HEARTBEAT_SWEEPER_ENABLED'] = 'false'
    env['AI_USAGE_REPORT_SWEEPER_ENABLED'] = 'false'
    errors = {'AI': [], 'BE': [], 'FE': []}
    sys.path.insert(0, str(AI))
    from app.core.config import get_settings
    settings = get_settings()
    # Use only the declared wheel's DLL in this project's venv; never rewrite .env.
    opus_available = False
    if settings.opus_library is not None:
        opus_candidates = [settings.opus_library]
    elif os.name == 'nt':
        opus_candidates = [AI / '.venv/Lib/site-packages/pyogg' / name
                           for name in ('opus.dll', 'libopus.dll', 'libopus-0.dll')]
    else:
        opus_candidates = []
    import ctypes
    for candidate in opus_candidates:
        if not candidate.is_file():
            continue
        if settings.opus_library is None and not candidate.resolve().is_relative_to((AI / '.venv').resolve()):
            continue
        try:
            library = ctypes.CDLL(str(candidate))
            library.opus_get_version_string.restype = ctypes.c_char_p
            if not library.opus_get_version_string():
                continue
            env['AI_SERVER_OPUS_LIBRARY'] = str(candidate.resolve())
            opus_available = True
            break
        except (OSError, AttributeError):
            continue
    if settings.tls_certfile or settings.tls_keyfile:
        scheme = 'https'
    else:
        scheme = 'http'
    host = settings.host
    if host != '127.0.0.1':
        errors['AI'].append('Real local launcher requires AI_SERVER_HOST=127.0.0.1')
    probe_host = '127.0.0.1' if host == '0.0.0.0' else '::1' if host == '::' else host
    ai_url = f'{scheme}://{("[" + probe_host + "]") if ":" in probe_host else probe_host}:{settings.port}'
    if ai_env.get('AI_SERVER_BACKEND_MODE', 'integrated') != 'integrated':
        errors['AI'].append('configured mock mode rejected; integrated mode is mandatory')
    for key in ['DEVICE', 'CONFIG', 'QUOTA']:
        if not ai_env.get(f'AI_SERVER_BACKEND_{key}_TOKEN'):
            errors['AI'].append(f'missing AI_SERVER_BACKEND_{key}_TOKEN')
    for module in ['fastapi', 'uvicorn', 'pydantic_settings', 'websockets', 'httpx', 'openai', 'google.genai']:
        try:
            importlib.import_module(module)
        except Exception:
            errors['AI'].append(f'missing or broken import: {module}')
    if not errors['AI']:
        result = capture([AI_PY, '-B', '-c', 'import app.main'], AI, env)
        if result.returncode:
            errors['AI'].append('app.main import/configuration failed (secret-bearing errors suppressed)')
    node = shutil.which('node.exe')
    npm = shutil.which('npm.cmd')
    backend = {'port': 3000, 'url': '', 'errors': [], 'links': []}
    if not node or not npm:
        errors['BE'].append('Node.js/npm missing from PATH')
    else:
        result = capture([node, ROOT / 'tools/real_launcher/check_backend.cjs'], BE, env)
        try:
            backend = json.loads(result.stdout)
            errors['BE'].extend(backend['errors'])
        except Exception:
            errors['BE'].append('Backend dependency/configuration preflight failed')
    be_url = f'http://127.0.0.1:{backend["port"]}'
    # Current app.py uses AIVA_BACKEND_URL; older integration helpers use BASE_URL.
    for key in ['AIVA_BACKEND_URL', 'AIVA_BACKEND_BASE_URL']:
        if os.environ.get(key, be_url).rstrip('/') != be_url:
            errors['FE'].append(f'{key} conflicts with local Backend URL')
        env[key] = be_url
    if os.environ.get('AIVA_DATA_MODE', 'API').upper() != 'API':
        errors['FE'].append('AIVA_DATA_MODE demo rejected')
    env['AIVA_DATA_MODE'] = 'API'
    fe_port = int(os.environ.get('STREAMLIT_SERVER_PORT', '8501'))
    if not 1 <= fe_port <= 65535:
        raise ValueError('Invalid Streamlit port')
    if not FE_PY.exists():
        errors['FE'].append('frontend/.venv Python missing')
    else:
        result = capture([FE_PY, '-B', '-c', 'import streamlit,pandas,plotly'], FE)
        if result.returncode:
            errors['FE'].append('Streamlit/pandas/plotly imports failed')
    links = ['Native Opus: available for launcher children' if opus_available else 'FEATURE BLOCKED native Opus: no compatible configured/wheel library']
    links.append('FE -> BE configured: ' + be_url + ' (AIVA_BACKEND_URL and AIVA_BACKEND_BASE_URL)')
    if backend.get('url', '').rstrip('/') != ai_url:
        links.append('BLOCKED BE -> AI: missing/mismatched AI_SERVER_URL')
    else:
        links.append('BE -> AI URL configured: ' + ai_url)
    if ai_env.get('AI_SERVER_BACKEND_URL', '').rstrip('/') != be_url:
        links.append('BLOCKED AI -> BE: missing/mismatched AI_SERVER_BACKEND_URL')
    # Match secrets in memory only. Never print their values.
    be_values = {**dotenv_values(BE / '.env'), **env}
    for left, right in [('AI_SERVER_WEB_TOKEN', 'AI_SERVER_LIVE_WEB_TOKEN'),
                        ('AI_DEVICE_SERVICE_TOKEN', 'AI_SERVER_BACKEND_DEVICE_TOKEN'),
                        ('AI_CONFIG_SERVICE_TOKEN', 'AI_SERVER_BACKEND_CONFIG_TOKEN'),
                        ('AI_QUOTA_SERVICE_TOKEN', 'AI_SERVER_BACKEND_QUOTA_TOKEN')]:
        if not be_values.get(left) or be_values.get(left) != ai_env.get(right):
            links.append(f'BLOCKED credentials: {left} / {right} missing or mismatched')
    for flag in ['DEVICE_AUTH_CONTRACT_APPROVED', 'AI_CONFIG_CONTRACT_APPROVED', 'AI_QUOTA_CONTRACT_APPROVED']:
        if be_values.get(flag) != 'true':
            links.append('FEATURE BLOCKED contract: ' + flag)
    if backend.get('quotaStorage') == 'v15-settings':
        if not backend.get('v15QuotaApproved'):
            links.append('FEATURE BLOCKED V1.5 quota/history adapter: separate contract approval is OFF')
        else:
            links.append('Quota storage: V1.5 JSON ledger selected; execution still requires all existing contracts')
    elif backend.get('quotaExtensionColumns', 0) < 7:
        links.append('FEATURE BLOCKED extended quota/history: extension absent; V1.5 adapter is available but not selected/approved')
    links.append('Email verification: local API/token-entry flow; outbound delivery is not configured')
    if not backend.get('localModelCount', 0):
        links.append('FEATURE BLOCKED Local AI: no enabled LOCAL LLM model provisioned in MySQL')
    services = {
        'AI': ('AI Server', AI, settings.port, ai_url, [str(AI_PY), '-B', 'scripts/run_dev.py'], '/health'),
        'BE': ('Backend', BE, backend['port'], be_url, [npm or 'npm.cmd', 'run', 'start:dev'], '/health'),
        'FE': ('Frontend', FE, fe_port, f'http://127.0.0.1:{fe_port}',
               [str(FE_PY), '-B', '-m', 'streamlit', 'run', 'app.py', '--server.address', '127.0.0.1', '--server.port', str(fe_port)], '/'),
    }
    ports = [s[2] for s in services.values()]
    if len(set(ports)) != 3:
        for key in errors:
            errors[key].append('service ports collide')
    return services, errors, env, links


def process_state(port, key, child):
    result = capture(['netstat.exe', '-ano', '-p', 'tcp'], ROOT)
    owners = {int(parts[4]) for line in result.stdout.splitlines()
              if len(parts := line.split()) >= 5 and parts[0] == 'TCP'
              and parts[1].rsplit(':', 1)[-1] == str(port) and parts[3] == 'LISTENING'}
    ps = str(Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe')
    result = capture([ps, '-NoProfile', '-Command',
                      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'], ROOT)
    try:
        processes = {p['ProcessId']: p for p in json.loads(result.stdout)}
        for owner in owners:
            pid = owner
            visited = set()
            while pid in processes and pid not in visited:
                visited.add(pid)
                process = processes[pid]
                command = process.get('CommandLine') or ''
                if child and pid == child.pid or ('--service ' + key) in command and 'run_all.bat' in command:
                    return f'RUNNING (service listener PID {owner})'
                pid = process['ParentProcessId']
    except Exception:
        pass
    return 'LISTENER PRESENT (service ownership unverified)'

def service_status(key, service, child=None):
    """A healthy response alone never identifies an unrelated port owner."""
    _, _, port, url, _, endpoint = service
    if not occupied(port):
        return 'STOPPED', False, 'NOT RUNNING'
    identity = process_state(port, key, child)
    healthy = http_ok(url + endpoint, key != 'FE')
    if not identity.startswith('RUNNING (service listener PID '):
        return 'PORT_CONFLICT', healthy, identity
    return ('RUNNING' if healthy else 'UNHEALTHY'), healthy, identity


def main():
    services, errors, env, links = prepare()
    if len(sys.argv) == 3 and sys.argv[1] == '--service':
        key = sys.argv[2]
        if key not in services:
            print('Unknown service; expected AI, BE or FE.')
            return 2
        name, cwd, _, _, command, _ = services[key]
        import ctypes
        ctypes.windll.kernel32.SetConsoleTitleW('AIVA-IoT REAL SERVICES - ' + name)
        print('AIVA-IoT REAL SERVICES - ' + name, flush=True)
        if errors[key]:
            print('BLOCKED: ' + '; '.join(errors[key]), flush=True)
            return 1
        state, _, identity = service_status(key, services[key])
        if state == 'RUNNING':
            print('Already running and healthy: ' + identity, flush=True)
            return 0
        if state != 'STOPPED':
            print('BLOCKED: ' + state + '; ' + identity, flush=True)
            return 1
        print('Command: ' + subprocess.list2cmdline(command), flush=True)
        try:
            return subprocess.call(command, cwd=cwd, env=env)
        except KeyboardInterrupt:
            print('Ctrl+C received; service is stopping.', flush=True)
            return 130
    mode = sys.argv[1:]
    if mode not in ([], ['--check'], ['--status']):
        print('Usage: run_all.bat [--check | --status]')
        return 2
    print('AIVA-IoT REAL SERVICES', flush=True)
    print('Runtime safety: sweepers OFF; no installs, migrations, seed, login or provider probes.')
    children = {}
    blocked = False
    for key, service in services.items():
        name, _, _, url, command, _ = service
        print(f'\n{name}: {url}')
        print('Command: ' + subprocess.list2cmdline(command))
        for error in errors[key]:
            print('BLOCKED dependency/config: ' + error)
            blocked = True
        state, _, identity = service_status(key, service)
        if state == 'RUNNING':
            print('REUSE: verified existing service; ' + identity)
        elif state in ('PORT_CONFLICT', 'UNHEALTHY'):
            print('BLOCKED: ' + state + '; ' + identity + '; no process was stopped.')
            blocked = True
        elif not errors[key] and not mode:
            command_line = 'call "' + str(ROOT / 'run_all.bat') + '" --service ' + key
            children[key] = subprocess.Popen('"' + os.environ.get('COMSPEC', 'cmd.exe') + '" /d /k ' + command_line,
                                             cwd=ROOT, env=env, creationflags=subprocess.CREATE_NEW_CONSOLE)
        elif mode == ['--check']:
            print('READY TO START: port is free; HTTP health is not yet verified.')
    if children:
        deadline = time.monotonic() + 30
        pending = set(children)
        while pending and time.monotonic() < deadline:
            for key in list(pending):
                service = services[key]
                if http_ok(service[3] + service[5], key != 'FE'):
                    pending.remove(key)
            if pending:
                time.sleep(1)
        time.sleep(2)
    for key, service in services.items():
        name, _, _, url, _, endpoint = service
        state, healthy, identity = service_status(key, service, children.get(key))
        print(f'{name}: {state}; process={identity}; HTTP {url + endpoint}={"PASS" if healthy else "NOT PASS"}')
        if state != 'RUNNING' and not (mode == ['--check'] and state == 'STOPPED'):
            blocked = True
    print('\n' + '\n'.join(links))
    # Contract approval is feature readiness, not a process/port failure.
    if any(link.startswith('BLOCKED ') for link in links):
        blocked = True
    print('Live Chat: NOT VERIFIED. HTTP health and process identity are reported separately.')
    print('Feature blockers above do not grant contract approval or trigger paid API calls.')
    print('Stop safely: Ctrl+C in each service CMD; no process is killed by this launcher.')
    print('Launcher prerequisites/runtime check: ' + ('BLOCKED' if blocked else 'PASS'))
    return 1 if blocked else 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print('BLOCKED launcher preflight: ' + type(error).__name__ + ' (details suppressed to protect secrets)')
        raise SystemExit(1)