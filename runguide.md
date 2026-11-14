Run the backend and frontend in two terminals. Paths are from your repo root, c:/Users/prana/Desktop/ttkzHack/tta-hacks.

Terminal 1: backend


cd server
python -m venv .venv
source .venv/Scripts/activate        # PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
Terminal 2: frontend


cd client
npm install
npm run dev
Quick checks (Terminal 3, optional)

REST endpoint. It should return 4 ideas as JSON:


curl http://localhost:8000/api/ideas
Type-check the frontend. It should print nothing:


cd client
npx tsc --noEmit
Backend WebSocket test. This simulates two users and should print SWIPE_UPDATE twice, then MATCH_FOUND. Run it from server with the venv active:


cd server
python - <<'PY'
from starlette.testclient import TestClient
import main
c = TestClient(main.app)
with c.websocket_connect("/ws/swipe") as a, c.websocket_connect("/ws/swipe") as b:
    a.receive_json(); b.receive_json()
    a.send_json({"idea_id": "i1", "direction": "right"})
    print(a.receive_json(), b.receive_json())
    b.send_json({"idea_id": "i1", "direction": "right"})
    print(a.receive_json(), a.receive_json()["type"])
PY
Manual UI test

Open http://localhost:3000 in two browser tabs. Both should show "● Live".
Click Gather! on the first card in Tab 1. The 🔥 count on that card should go to 1 in Tab 2 as well.
Click Gather! on the same card in Tab 2. Both tabs should switch to the "Match Found!" screen.
If the server was already running, restart it first, because match state is held in memor
