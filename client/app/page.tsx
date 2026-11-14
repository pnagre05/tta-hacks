"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const API_URL = "http://localhost:8000";
const WS_URL = "ws://localhost:8000/ws/swipe";

interface Idea {
  id: string;
  title: string;
  category: string;
  image_url: string;
}

type ServerMessage =
  | { type: "SNAPSHOT"; swipes: Record<string, number> }
  | { type: "SWIPE_UPDATE"; idea_id: string; swipes: number }
  | { type: "MATCH_FOUND"; idea: Idea };

type Direction = "left" | "right";

export default function Dashboard() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [index, setIndex] = useState(0);
  const [swipes, setSwipes] = useState<Record<string, number>>({});
  const [match, setMatch] = useState<Idea | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/ideas`)
      .then((r) => r.json() as Promise<Idea[]>)
      .then(setIdeas)
      .catch(() => setError("Could not load ideas. Is the backend running on :8000?"));
  }, []);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e: MessageEvent<string>) => {
      const msg = JSON.parse(e.data) as ServerMessage;
      if (msg.type === "SNAPSHOT") setSwipes(msg.swipes);
      else if (msg.type === "SWIPE_UPDATE")
        setSwipes((s) => ({ ...s, [msg.idea_id]: msg.swipes }));
      else if (msg.type === "MATCH_FOUND") setMatch(msg.idea);
    };
    return () => ws.close();
  }, []);

  const swipe = (direction: Direction) => {
    const idea = ideas[index];
    if (!idea) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "SWIPE", idea_id: idea.id, direction }));
    }
    setIndex((i) => i + 1);
  };

  if (match) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
        <div className="text-6xl">🎉</div>
        <h1 className="text-4xl font-extrabold text-emerald-600">Match Found!</h1>
        <Card className="w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={match.image_url} alt={match.title} className="h-56 w-full object-cover" />
          <CardContent>
            <p className="text-sm uppercase tracking-wide text-slate-500">{match.category}</p>
            <h2 className="text-2xl font-bold">{match.title}</h2>
          </CardContent>
        </Card>
        <Button variant="outline" onClick={() => setMatch(null)}>
          Keep swiping
        </Button>
      </main>
    );
  }

  const idea: Idea | undefined = ideas[index];
  const count = idea ? swipes[idea.id] ?? 0 : 0;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center gap-6 p-6">
      <header className="flex w-full items-center justify-between">
        <h1 className="text-2xl font-extrabold">GATHER</h1>
        <span className={connected ? "text-sm text-emerald-600" : "text-sm text-red-500"}>
          ● {connected ? "Live" : "Offline"}
        </span>
      </header>

      {error && <p className="text-red-600">{error}</p>}

      {idea ? (
        <div className="relative w-full">
          {ideas[index + 1] && (
            <Card className="absolute inset-0 translate-y-3 scale-95 opacity-60" aria-hidden />
          )}
          <Card className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={idea.image_url} alt={idea.title} className="h-64 w-full object-cover" />
            <CardContent>
              <p className="text-sm uppercase tracking-wide text-slate-500">{idea.category}</p>
              <h2 className="text-2xl font-bold">{idea.title}</h2>
              <p className="mt-2 text-sm text-slate-600">
                🔥 {count} {count === 1 ? "person is" : "people are"} interested
              </p>
            </CardContent>
          </Card>
        </div>
      ) : (
        !error && (
          <p className="mt-20 text-slate-500">
            {ideas.length ? "No more ideas. Waiting for a match…" : "Loading ideas…"}
          </p>
        )
      )}

      {idea && (
        <div className="flex w-full gap-4">
          <Button variant="outline" size="lg" className="flex-1" onClick={() => swipe("left")}>
            Pass
          </Button>
          <Button variant="success" size="lg" className="flex-1" onClick={() => swipe("right")}>
            Gather!
          </Button>
        </div>
      )}
    </main>
  );
}
