"""Explicit development/test loopback mock; not imported by app.main.

Same BE-only URL/shape as the production Web Chat transport. No provider, robot,
Backend client, database, dotenv or persistent state is initialized here.
"""
import argparse
import hmac
import os
import re
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

MOCK_REPLY = "[MOCK] AIVA fixture response from FastAPI."

class MockWebRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    userId: str
    content: str = Field(min_length=1, max_length=16000, repr=False)


def create_mock_app(*, enabled: bool, environment: str, service_token: str) -> FastAPI:
    if not enabled or environment not in ("development", "test"):
        raise ValueError("MOCK_REQUIRES_EXPLICIT_DEVELOPMENT_TEST_MODE")
    if not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", service_token):
        raise ValueError("MOCK_SERVICE_TOKEN_REQUIRED")
    app = FastAPI(title="AIVA MOCK ONLY", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.requests = 0

    @app.get("/health")
    async def health():
        return {"status": "ok", "mode": "MOCK_ONLY", "requests": app.state.requests}

    @app.post("/internal/web-chat")
    async def chat(request: Request):
        headers = request.headers.getlist("authorization")
        if len(headers) != 1 or not hmac.compare_digest(headers[0].encode(), ("Bearer " + service_token).encode()):
            raise HTTPException(401, "MOCK_SERVICE_UNAUTHORIZED")
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 70000:
                raise HTTPException(413, "MOCK_REQUEST_TOO_LARGE")
        try:
            data = MockWebRequest.model_validate_json(body)
        except ValueError:
            raise HTTPException(400, "MOCK_INVALID_REQUEST") from None
        if data.userId != "7":
            raise HTTPException(403, "MOCK_FIXTURE_OWNER_REQUIRED")
        if not data.content.strip():
            raise HTTPException(400, "MOCK_EMPTY_MESSAGE")
        app.state.requests += 1
        # Never reflect or save input in the fixture. A predictable labelled answer.
        return JSONResponse({"content": MOCK_REPLY, "conversation_id": "11",
                             "usage": {"input_tokens": 0, "output_tokens": 0}},
                            headers={"Cache-Control": "no-store", "X-AIVA-Mode": "MOCK_ONLY"})
    return app


def main():
    parser = argparse.ArgumentParser(description="AIVA development/test MOCK ONLY")
    parser.add_argument("--enable", action="store_true")
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("port must be 1024..65535")
    app = create_mock_app(enabled=args.enable and os.environ.get("AIVA_MOCK_MODE") == "development-test",
                          environment=os.environ.get("NODE_ENV", ""),
                          service_token=os.environ.get("AIVA_MOCK_SERVICE_TOKEN", ""))
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=args.port, access_log=False, log_level="warning")


if __name__ == "__main__":
    main()
