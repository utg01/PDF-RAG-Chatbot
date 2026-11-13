import sys
from pathlib import Path

# Add project root to sys.path so app.py and sibling modules are discovered
root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from app import app as base_app


class VercelPathNormalizer:
    """
    Normalizes paths when Vercel rewrites requests to serverless functions.
    Ensures that routes like /api/index, /api/index.py, /api/index.py/api/chat
    are cleaned before Starlette resolves them.
    """
    def __init__(self, inner_app):
        self.inner_app = inner_app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            path = scope.get("path", "")
            # If path points directly to the serverless function file
            if path in ("/api/index.py", "/api/index", "/api", "/api/"):
                scope["path"] = "/"
            elif path.startswith("/api/index.py/"):
                scope["path"] = path[len("/api/index.py"):]
            elif path.startswith("/api/index/"):
                scope["path"] = path[len("/api/index"):]

        await self.inner_app(scope, receive, send)


app = VercelPathNormalizer(base_app)
