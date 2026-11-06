"""Run an explicitly isolated AIVA mock flow; only owned child processes are stopped.

Use the Frontend virtualenv interpreter. --ai-python selects the separate AI venv.
--smoke runs actual app.py through AppTest and real TCP HTTP; --serve opens no browser.
"""
import argparse
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen

ROOT=Path(__file__).resolve().parents[2]

def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1",0))
        return sock.getsockname()[1]

def wait_ready(child,url):
    deadline=time.monotonic()+25
    while time.monotonic()<deadline:
        if child.poll() is not None:raise RuntimeError("MOCK_CHILD_EXITED_BEFORE_READY")
        try:
            with urlopen(url,timeout=.5) as response:
                if response.status==200:return
        except OSError:pass
        time.sleep(.1)
    raise RuntimeError("MOCK_STARTUP_TIMEOUT")

def stop(child):
    if child.poll() is None:
        child.terminate()
        try:child.wait(timeout=5)
        except subprocess.TimeoutExpired:child.kill();child.wait(timeout=5)

def main():
    parser=argparse.ArgumentParser(description="AIVA isolated MOCK ONLY; no DB or provider")
    parser.add_argument("--enable",action="store_true")
    parser.add_argument("--ai-python",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    modes=parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--smoke",action="store_true")
    modes.add_argument("--serve",action="store_true")
    args=parser.parse_args()
    if not args.enable:parser.error("--enable is required; mock never activates implicitly")
    if not args.ai_python.is_file():parser.error("AI venv interpreter not found")
    if not shutil.which("node"):parser.error("Node.js is required")
    if not (ROOT/"BE/node_modules/ts-node/register/index.js").exists():parser.error("Install BE lockfile dependencies first")
    args.output.mkdir(parents=True,exist_ok=True)
    logdir=Path(tempfile.mkdtemp(prefix="mock-run-",dir=args.output))
    ai_port,be_port=free_port(),free_port()
    while be_port==ai_port:be_port=free_port()
    env=os.environ.copy()
    for key in list(env):
        if key.startswith(("AI_SERVER_","OPENAI_","GEMINI_","DB_","MYSQL_","AIVA_","JWT_","ADMIN_","DEVICE_","RESET_","RECOVERY_")) or key=="GOOGLE_API_KEY":env.pop(key)
    env.update(AIVA_MOCK_MODE="development-test",NODE_ENV="test",PYTHONUTF8="1",PYTHONDONTWRITEBYTECODE="1",
        AIVA_MOCK_SERVICE_TOKEN=secrets.token_urlsafe(32),AIVA_MOCK_BE_PORT=str(be_port),
        AIVA_MOCK_AI_URL=f"http://127.0.0.1:{ai_port}",AIVA_BACKEND_URL=f"http://127.0.0.1:{be_port}",
        STREAMLIT_BROWSER_GATHER_USAGE_STATS="false",TS_NODE_FILES="true",TEMP=str(logdir),TMP=str(logdir))
    children=[]
    result={"mode":"MOCK_ONLY","database":False,"cloud_provider":False,"browser_manual":"NOT_TESTED"}
    with contextlib.ExitStack() as stack:
        def spawn(name,cmd,cwd):
            log=stack.enter_context((logdir/(name+".log")).open("w",encoding="utf-8"))
            child=subprocess.Popen(cmd,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name=="nt" else 0)
            children.append(child);return child
        try:
            ai=spawn("ai",[str(args.ai_python),"-B","-m","scripts.mock_chat","--enable","--port",str(ai_port)],ROOT/"AI_SERVER")
            wait_ready(ai,f"http://127.0.0.1:{ai_port}/health")
            be=spawn("backend",["node","-r","ts-node/register","test/mock-chat/runtime.ts"],ROOT/"BE")
            wait_ready(be,f"http://127.0.0.1:{be_port}/health")
            if args.smoke:
                # The FE uses real clients. Only process environment selects the isolated Backend.
                spec=importlib.util.spec_from_file_location("mock_chat_smoke",ROOT/"frontend/checks/mock_chat_smoke.py")
                smoke=importlib.util.module_from_spec(spec);spec.loader.exec_module(smoke)
                old_url=os.environ.get("AIVA_BACKEND_URL")
                os.environ["AIVA_BACKEND_URL"]=env["AIVA_BACKEND_URL"]
                os.environ["STREAMLIT_BROWSER_GATHER_USAGE_STATS"]="false"
                try:
                    app=smoke.verify_success(env["AIVA_BACKEND_URL"])
                    with urlopen(f"http://127.0.0.1:{ai_port}/health",timeout=3) as response:health=json.load(response)
                    assert health["requests"]==1, "Expected exactly one generation across all negative controls"
                    result.update(cross_process="PASS",frontend_render="PASS",loading="PASS",no_duplicate_generation="PASS")
                    stop(ai);smoke.verify_ai_disconnected(app);result["ai_disconnect"]="PASS"
                    stop(be);smoke.verify_backend_disconnected(app);result["backend_disconnect"]="PASS"
                finally:
                    if old_url is None:os.environ.pop("AIVA_BACKEND_URL",None)
                    else:os.environ["AIVA_BACKEND_URL"]=old_url
            else:
                port=free_port()
                fe=spawn("frontend",[sys.executable,"-m","streamlit","run","app.py","--server.address","127.0.0.1", "--server.port",str(port),"--server.headless","true"],ROOT/"frontend")
                wait_ready(fe,f"http://127.0.0.1:{port}/_stcore/health")
                print(f"MOCK ONLY: http://127.0.0.1:{port} | Ctrl+C stops owned mock processes",flush=True)
                print("Fixture login: mock-user@example.test / MockOnly-Password-2026! (synthetic, RAM only)",flush=True)
                while all(child.poll() is None for child in children):time.sleep(.5)
        except KeyboardInterrupt:
            result["stopped"]="user"
        except Exception as error:
            result["failure_type"]=type(error).__name__
            raise
        finally:
            for child in reversed(children):stop(child)
            result["owned_processes_stopped"]=all(child.poll() is not None for child in children)
            (logdir/"result.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
            print(json.dumps(result),flush=True)
            print("Evidence: "+str(logdir),flush=True)

if __name__=="__main__":main()
