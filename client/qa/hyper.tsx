// Development-only synthetic snapshots. This exercises the actual GameRoom,
// animation queue and CSS; Rust tests cover the authoritative transitions.
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import GameRoom from "../src/components/GameRoom";
import { CardSkinProvider } from "../src/lib/cardSkin";
import type { RoomView, HyperContract } from "../src/lib/types";
import { previewNextMusicTrack } from "../src/lib/music";
import "../src/styles.css";

const storm: HyperContract = { id: "storm", name: "修羅場", source: "光役", points: 5,
  description: "双方HP18の殴り合い！取得枚数で攻撃、3連鎖から＋1。HP0でK.O.、役あがりも可能" };
const before: RoomView = {
  id: "qa-hyper", name: "修羅場と再配布の表示検証", hostId: "self", mode: "pvp", hyperEnabled: true,
  rounds: 3, round: 1, status: "playing", phase: "decision", myIndex: 0, turn: 0, dealer: 0,
  players: [
    { id: "self", name: "あなた", score: 12, handCount: 1, captured: [0, 8, 28, 20, 24, 36], connected: true, isCpu: false },
    { id: "rival", name: "花影", score: 18, handCount: 1, captured: [1, 5, 9], connected: true, isCpu: false },
  ],
  hand: [12], field: [13, 17, 21], deckCount: 34, drawnCard: null,
  yaku: [[{ name: "三光", points: 5 }, { name: "猪鹿蝶", points: 5 }], [{ name: "赤短", points: 5 }]],
  koikoi: [0, 0], winner: null, matchWinner: null, roundPoints: 0, messages: [], log: [], spectators: 0,
  boardRevision: 1, events: [], hyper: { contracts: [[], []], stake: [0, 0], bloom: [0, 0], chain: [0, 0], sealed: [[], []],
    options: [{ role: "三光", points: 5, contract: storm }], hp: null, hpMax: 18, boosts: [0, 0], multiplier: [100, 100], projected: [10, 5] },
};
const reset: RoomView = { ...before, phase: "play", boardRevision: 2, turn: 1,
  players: before.players.map(p => ({ ...p, handCount: 8, captured: [] })),
  hand: [0, 4, 8, 12, 16, 20, 24, 28], field: [1, 5, 9, 13, 17, 21, 25, 29], deckCount: 24, yaku: [[], []],
  hyper: { ...before.hyper!, contracts: [[storm], []], stake: [5, 0], multiplier: [175, 100], projected: [9, 0], hp: [18, 18], options: [] },
};
const captured = [0, 1, 4, 5, 8, 9];
const combo: RoomView = { ...reset, turn: 0, hand: [12, 16, 20, 24, 28], field: [13, 17, 21, 25, 29],
  players: reset.players.map((p, i) => i === 0 ? { ...p, captured, handCount: 5 } : p),
  hyper: { ...reset.hyper!, chain: [3, 0], multiplier: [225, 100], boosts: [1, 0], hp: [18, 11] },
  events: [0, 4, 8].map((cardId, i) => ({
    id: i + 1, player: 0, source: "hand", cardId, targetIds: [cardId + 1], captured: true,
    field: reset.field.slice(i + 1), capturedCards: [captured.slice(0, (i + 1) * 2), []], deckCount: 24,
    requiresChoice: false, hyper: { chain: [i + 1, 0], bloom: [0, 0], multiplier: [i === 2 ? 225 : i === 1 ? 200 : 175, 100], hp: [18, 18 - (i + 1) * 2 - (i === 2 ? 1 : 0)] },
  })),
};
const koReplay: RoomView = {
  ...combo, phase: "round_end", winner: 0, roundPoints: 30,
  hyper: { ...combo.hyper!, hp: [18, 0] },
  events: combo.events!.map(e => ({ ...e, hyper: { ...e.hyper!, hp: [18, Math.max(0, e.hyper!.hp![1] - 11)] } })),
};

function Fixture() {
  const [room, setRoom] = useState(before);
  const [key, setKey] = useState(0);
  const [autoKo, setAutoKo] = useState(false);
  useEffect(() => {
    if (!autoKo) return;
    const timer = window.setTimeout(() => { setRoom(koReplay); setAutoKo(false); }, 100);
    return () => window.clearTimeout(timer);
  }, [autoKo, key]);
  return <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}><details style={{ flexShrink: 0, position: "relative", zIndex: 250, padding: "5px 8px", background: "#15251a", fontSize: 11 }} onClick={event => {
    if ((event.target as HTMLElement).closest("button")) event.currentTarget.open = false;
  }}>
    <summary style={{ cursor: "pointer" }}>補助UI試験（合成局面）</summary>
    <div style={{ position: "absolute", top: "100%", left: 0, right: 0, padding: 8, display: "flex", gap: 8, flexWrap: "wrap", background: "#15251afa", borderBottom: "1px solid #9b8857" }}>
    <button className="button secondary compact" onClick={() => { setKey(k => k + 1); setRoom(before); }}>初期状態</button>
    <button className="button secondary compact" onClick={previewNextMusicTrack}>BGMを次の曲へ</button>
    {[8, 9, 10, 11, 12].map(count => <button key={count} className="button secondary compact" onClick={() => {
      setKey(k => k + 1);
      setRoom({ ...reset, field: Array.from({ length: count }, (_, i) => i * 4 + 1), deckCount: 32 - count });
    }}>場{count}枚</button>)}
    <button className="button secondary compact" onClick={() => setRoom(r => ({ ...r, phase: "play", turn: 0, koikoi: [r.koikoi[0] ? 0 : 3, 0], hyper: r.hyper ? { ...r.hyper, hp: r.hyper.hp ? null : [6, 12], chain: [12, 0], multiplier: [800, 100] } : r.hyper }))}>状態切替</button>
    <button className="button secondary compact" onClick={() => { setKey(k => k + 1); setRoom({ ...reset, turn: 0, hyperEnabled: false, hyper: undefined }); }}>通常部屋</button>
    <button className="button secondary compact" onClick={() => { setKey(k => k + 1); setRoom({ ...before, phase: "waiting", status: "waiting", hyperEnabled: false, hyper: undefined, hand: [], field: [], deckCount: 0 }); }}>待機画面</button>
    <button className="button secondary compact" onClick={() => {
      setKey(k => k + 1);
      setRoom({ ...reset, hyper: { ...reset.hyper!, hp: [18, 7] } });
      setAutoKo(true);
    }}>K.O.演出を再生</button>
    <button className="button secondary compact" onClick={() => setRoom(combo)}>3連鎖・HP減少を再生</button>
    <button className="button secondary compact" onClick={() => setRoom({
      ...combo, hand: reset.hand,
      players: reset.players.map((p, i) => i === 1 ? { ...p, captured, handCount: 5 } : p),
      hyper: { ...reset.hyper!, chain: [0, 3], hp: [11, 18] },
      events: combo.events!.map(e => ({ ...e, player: 1, capturedCards: [[], e.capturedCards[0]],
        hyper: { ...e.hyper!, chain: [0, e.hyper!.chain[0]], multiplier: [175, 100], hp: [e.hyper!.hp![1], 18] },
      })),
    })}>相手の反撃</button>
  </div></details><div className="workspace" style={{ margin: 0, flex: 1, minHeight: 0, height: "auto" }}><main>
    <GameRoom key={key} room={room} connected busy={false}
      send={command => {
        if ((command as { type: string }).type === "hyper") setRoom(reset);
        if ((command as { type: string }).type === "start") setRoom({ ...reset, turn: 0, hyperEnabled: false, hyper: undefined });
      }}
      leave={() => setRoom(before)} copyInvite={() => {}} />
  </main></div></div>;
}
const root = createRoot(document.getElementById("root")!);
root.render(<React.StrictMode><CardSkinProvider><Fixture /></CardSkinProvider></React.StrictMode>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
