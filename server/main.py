"""GATHER in-memory MVP backend. Run: uvicorn main:app --reload --port 8000"""
import json
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

MATCH_THRESHOLD = 2

app = FastAPI(title="GATHER MVP")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------- In-memory "database" ----------------
DB: dict[str, Any] = {
    "group": {"id": "g1", "name": "Weekend Crew", "member_ids": ["u1", "u2", "u3"]},
    "users": {
        "u1": {"id": "u1", "name": "Alex"},
        "u2": {"id": "u2", "name": "Sam"},
        "u3": {"id": "u3", "name": "Jordan"},
    },
    "ideas": {
        "i1": {"id": "i1", "title": "Sunset Hike", "category": "Outdoors",
               "image_url": "https://images.unsplash.com/photo-1551632811-561732d1e306?w=800"},
        "i2": {"id": "i2", "title": "Board Game Night", "category": "Indoor",
               "image_url": "https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=800"},
        "i3": {"id": "i3", "title": "Taco Crawl", "category": "Food",
               "image_url": "https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=800"},
        "i4": {"id": "i4", "title": "Karaoke Night", "category": "Nightlife",
               "image_url": "https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=800"},
    },
}
# idea_id -> connection ids that swiped right (each client counts once per idea)
RIGHT_SWIPES: dict[str, set[str]] = {i: set() for i in DB["ideas"]}
MATCHED: set[str] = set()


# ---------------- WebSocket manager ----------------
class ConnectionManager:
    def __init__(self) -> None:
        self.active: dict[str, WebSocket] = {}

    async def connect(self, client_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self.active[client_id] = ws

    def disconnect(self, client_id: str) -> None:
        self.active.pop(client_id, None)

    async def send(self, ws: WebSocket, message: dict) -> None:
        await ws.send_text(json.dumps(message))

    async def broadcast(self, message: dict) -> None:
        data = json.dumps(message)
        for cid, ws in list(self.active.items()):
            try:
                await ws.send_text(data)
            except Exception:
                self.disconnect(cid)


manager = ConnectionManager()


# ---------------- REST ----------------
@app.get("/api/ideas")
def list_ideas() -> list[dict]:
    return list(DB["ideas"].values())


# ---------------- WebSocket ----------------
@app.websocket("/ws/swipe")
async def swipe_ws(ws: WebSocket) -> None:
    client_id = str(id(ws))
    await manager.connect(client_id, ws)
    # Catch the new client up on current counts
    await manager.send(ws, {
        "type": "SNAPSHOT",
        "swipes": {i: len(s) for i, s in RIGHT_SWIPES.items()},
    })
    try:
        while True:
            try:
                msg = json.loads(await ws.receive_text())
            except json.JSONDecodeError:
                continue
            idea_id = msg.get("idea_id")
            direction = str(msg.get("direction", "")).lower()
            if idea_id not in DB["ideas"] or direction != "right":
                continue  # left swipes are private; nothing to broadcast
            RIGHT_SWIPES[idea_id].add(client_id)
            count = len(RIGHT_SWIPES[idea_id])
            await manager.broadcast({"type": "SWIPE_UPDATE", "idea_id": idea_id, "swipes": count})
            if count >= MATCH_THRESHOLD and idea_id not in MATCHED:
                MATCHED.add(idea_id)
                await manager.broadcast({"type": "MATCH_FOUND", "idea": DB["ideas"][idea_id]})
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(client_id)
