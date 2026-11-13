import os
import json
import uuid
import tempfile
import asyncio
from pathlib import Path
from dotenv import load_dotenv

from starlette.applications import Starlette
from starlette.routing import Route, Mount
from starlette.staticfiles import StaticFiles
from starlette.responses import JSONResponse, FileResponse, HTMLResponse, StreamingResponse
from starlette.requests import Request
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware

from langchain_core.messages import HumanMessage, AIMessage

# Core RAG pipeline imports (without checkpointer)
from advanced import agent
from ingestion import Create_embeddings, delete_index

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
PUBLIC_DIR = BASE_DIR / "public"

SAMPLE_PDF_NAME = "Cloud SRE Handbook Generation Plan.pdf"
SAMPLE_PDF_PATH = BASE_DIR / SAMPLE_PDF_NAME
SAMPLE_INDEX_NAME = "pdf-cloud-sre-handbook-generation-plan-pdf"

# In-memory mapping of active temporary sessions for ephemeral upload tracking & cleanup
# format: session_id -> {"temp_path": str, "index_name": str, "file_name": str}
active_sessions = {}


def load_index_html():
    """Robust index.html loader checking static and public locations."""
    candidate_paths = [
        STATIC_DIR / "index.html",
        PUBLIC_DIR / "index.html",
        BASE_DIR / "index.html",
        Path("/var/task/static/index.html"),
        Path("/var/task/public/index.html")
    ]
    for path in candidate_paths:
        if path.exists():
            try:
                return path.read_text(encoding="utf-8")
            except Exception:
                pass
    return None


async def serve_index(request: Request):
    html_content = load_index_html()
    if html_content:
        return HTMLResponse(html_content, status_code=200)
    return HTMLResponse("<h1>DocRAG Workbench: Index file not found</h1>", status_code=404)


async def serve_style(request: Request):
    for p in (STATIC_DIR / "style.css", PUBLIC_DIR / "style.css", Path("/var/task/static/style.css")):
        if p.exists():
            return FileResponse(p, media_type="text/css")
    return HTMLResponse("/* style */", media_type="text/css")


async def serve_app_js(request: Request):
    for p in (STATIC_DIR / "app.js", PUBLIC_DIR / "app.js", Path("/var/task/static/app.js")):
        if p.exists():
            return FileResponse(p, media_type="application/javascript")
    return HTMLResponse("// app.js", media_type="application/javascript")


async def sample_pdf_info(request: Request):
    """
    Returns the pre-embedded sample PDF metadata.
    0 ms wait time for recruiters - vectors already intact in Pinecone.
    """
    if not SAMPLE_PDF_PATH.exists():
        return JSONResponse({"status": "error", "message": "Sample PDF file not found on disk"}, status_code=404)

    session_id = str(uuid.uuid4())
    return JSONResponse({
        "status": "success",
        "file_name": SAMPLE_PDF_NAME,
        "title": "Cloud Infrastructure Incident Response & Reliability Handbook",
        "description": "OmniScale Systems engineering manual covering incident classification, SLOs, Tier-1 runbooks, and failover topologies.",
        "index_name": SAMPLE_INDEX_NAME,
        "session_id": session_id,
        "pre_embedded": True,
        "vector_count": 114,
        "pages": 23,
        "file_size": f"{SAMPLE_PDF_PATH.stat().st_size / 1024:.1f} KB",
        "sample_questions": [
            "What are the severity levels for incidents in this handbook?",
            "What is the SLO and error budget policy?",
            "Summarize the Tier-1 incident response procedure.",
            "Describe the automated failover architecture."
        ]
    })


async def download_sample_pdf(request: Request):
    """
    Serves the pre-embedded sample PDF directly for in-app viewing or download.
    """
    if not SAMPLE_PDF_PATH.exists():
        return JSONResponse({"error": "Sample PDF not found"}, status_code=404)

    return FileResponse(
        SAMPLE_PDF_PATH,
        media_type="application/pdf",
        filename=SAMPLE_PDF_NAME,
        headers={"Content-Disposition": f'inline; filename="{SAMPLE_PDF_NAME}"'}
    )


async def upload_pdf(request: Request):
    """
    Handles custom user PDF upload strictly as a temporary file.
    No permanent folder on disk: uses OS tempfile and schedules cleanup.
    """
    temp_path = None
    try:
        form = await request.form()
        uploaded_file = form.get("file")

        if not uploaded_file:
            return JSONResponse({"status": "error", "message": "No file uploaded"}, status_code=400)

        filename = uploaded_file.filename
        if not filename.lower().endswith(".pdf"):
            return JSONResponse({"status": "error", "message": "Only PDF files are supported"}, status_code=400)

        contents = await uploaded_file.read()
        if len(contents) == 0:
            return JSONResponse({"status": "error", "message": "Uploaded file is empty"}, status_code=400)

        # Write to OS temporary file (ephemeral, not in project repo)
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            tmp.write(contents)
            temp_path = tmp.name

        session_id = str(uuid.uuid4())

        # Run ingestion pipeline in background thread to avoid blocking event loop
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: Create_embeddings.invoke({
                "file_path": temp_path,
                "file_name": filename
            })
        )

        if isinstance(result, str):
            # Error returned from Create_embeddings
            if temp_path and os.path.exists(temp_path):
                os.remove(temp_path)
            return JSONResponse({"status": "error", "message": result}, status_code=500)

        # Track session temporarily for viewing and exit cleanup
        active_sessions[session_id] = {
            "temp_path": temp_path,
            "index_name": result["index_name"],
            "file_name": filename
        }

        return JSONResponse({
            "status": "success",
            "session_id": session_id,
            "file_name": filename,
            "index_name": result["index_name"],
            "pre_embedded": False
        })

    except Exception as e:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass
        return JSONResponse({"status": "error", "message": str(e)}, status_code=500)


async def view_uploaded_pdf(request: Request):
    """
    Serves the ephemeral temporary PDF for preview while the session is open.
    """
    session_id = request.path_params.get("session_id")
    session_info = active_sessions.get(session_id)

    if not session_info or not os.path.exists(session_info["temp_path"]):
        return JSONResponse({"error": "Temporary file not found or expired"}, status_code=404)

    return FileResponse(
        session_info["temp_path"],
        media_type="application/pdf",
        filename=session_info["file_name"],
        headers={"Content-Disposition": f'inline; filename="{session_info["file_name"]}"'}
    )


async def chat_stream(request: Request):
    """
    Streaming chat endpoint using Server-Sent Events (SSE).
    Stateless per-request execution without checkpointer.
    """
    try:
        body = await request.json()
        message = body.get("message", "").strip()
        session_id = body.get("session_id") or str(uuid.uuid4())
        index_name = body.get("index_name")

        if not message:
            return JSONResponse({"error": "Empty message"}, status_code=400)
        if not index_name:
            return JSONResponse({"error": "No index selected"}, status_code=400)

        config = {
            "configurable": {
                "thread_id": session_id,
                "index_name": index_name
            },
            "recursion_limit": 20
        }

        user_message = HumanMessage(content=message)

        async def event_generator():
            try:
                # Stream messages from LangGraph agent asynchronously (stateless execution)
                async for chunk in agent.astream(
                    {"messages": [user_message]},
                    config=config,
                    stream_mode="messages"
                ):
                    msg, metadata = chunk
                    if isinstance(msg, AIMessage) and msg.content:
                        payload = json.dumps({"text": msg.content})
                        yield f"data: {payload}\n\n"

                yield "data: [DONE]\n\n"
            except Exception as err:
                err_payload = json.dumps({"error": str(err)})
                yield f"data: {err_payload}\n\n"
                yield "data: [DONE]\n\n"

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"
            }
        )

    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


async def cleanup_session(request: Request):
    """
    Invoked when the user closes the website or ends their session:
    - Automatically deletes the temporary Pinecone index from Pinecone.
    - Removes the temporary PDF file from the OS temp directory.
    - Protects the pre-embedded sample handbook index from being deleted.
    """
    try:
        # Accepts standard JSON or navigator.sendBeacon raw text
        body_bytes = await request.body()
        index_name = None
        session_id = None

        if body_bytes:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
                index_name = data.get("index_name")
                session_id = data.get("session_id")
            except Exception:
                pass

        # Also check session dictionary if session_id passed
        if session_id and session_id in active_sessions:
            info = active_sessions.pop(session_id)
            if not index_name:
                index_name = info.get("index_name")
            temp_path = info.get("temp_path")
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass

        # Protect the sample index
        if index_name == SAMPLE_INDEX_NAME:
            return JSONResponse({
                "status": "preserved",
                "message": "Sample pre-embedded index is permanently preserved."
            })

        # Delete user custom index from Pinecone
        if index_name:
            loop = asyncio.get_event_loop()
            res = await loop.run_in_executor(
                None,
                lambda: delete_index.invoke({"index_name": index_name})
            )
            return JSONResponse({"status": "deleted", "result": res})

        return JSONResponse({"status": "ok", "message": "Session cleaned up"})

    except Exception as e:
        return JSONResponse({"status": "error", "message": str(e)}, status_code=500)


routes = [
    # Main UI entrypoints
    Route("/", endpoint=serve_index, methods=["GET"]),
    Route("/index", endpoint=serve_index, methods=["GET"]),
    Route("/api", endpoint=serve_index, methods=["GET"]),
    Route("/api/index", endpoint=serve_index, methods=["GET"]),
    Route("/api/index.py", endpoint=serve_index, methods=["GET"]),

    # Static CSS and JS fallbacks
    Route("/style.css", endpoint=serve_style, methods=["GET"]),
    Route("/app.js", endpoint=serve_app_js, methods=["GET"]),
    Route("/static/style.css", endpoint=serve_style, methods=["GET"]),
    Route("/static/app.js", endpoint=serve_app_js, methods=["GET"]),

    # API endpoints (both with and without /api/ prefix for proxy flexibility)
    Route("/api/sample", endpoint=sample_pdf_info, methods=["GET"]),
    Route("/sample", endpoint=sample_pdf_info, methods=["GET"]),

    Route("/api/pdf/sample", endpoint=download_sample_pdf, methods=["GET"]),
    Route("/pdf/sample", endpoint=download_sample_pdf, methods=["GET"]),

    Route("/api/upload", endpoint=upload_pdf, methods=["POST"]),
    Route("/upload", endpoint=upload_pdf, methods=["POST"]),

    Route("/api/pdf/session/{session_id}", endpoint=view_uploaded_pdf, methods=["GET"]),
    Route("/pdf/session/{session_id}", endpoint=view_uploaded_pdf, methods=["GET"]),

    Route("/api/chat", endpoint=chat_stream, methods=["POST"]),
    Route("/chat", endpoint=chat_stream, methods=["POST"]),

    Route("/api/session/cleanup", endpoint=cleanup_session, methods=["POST"]),
    Route("/session/cleanup", endpoint=cleanup_session, methods=["POST"]),

    # Mount static directories
    Mount("/static", app=StaticFiles(directory=str(STATIC_DIR)), name="static"),
]

middleware = [
    Middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"]
    )
]

app = Starlette(debug=False, routes=routes, middleware=middleware)

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    print(f"Starting PDF RAG Web Server on http://0.0.0.0:{port}")
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
