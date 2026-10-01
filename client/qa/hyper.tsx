// Development-only synthetic snapshots. This exercises the actual GameRoom,
// animation queue and CSS; Rust tests cover the authoritative transitions.
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import GameRoom from "../src/components/GameRoom";
import { CardSkinProvider } from "../src/lib/cardSkin";
import type { RoomView, HyperContract, HyperDamage } from "../src/lib/types";
import { previewNextMusicTrack } from "../src/lib/music";
import "../src/styles.css";

const storm: HyperContract = { id: "storm", name: "修羅場", source: "三光", points: 5,
  description: "双方HP32で役撃戦。札・新成立や増点の役・CHAIN・初撃威力で攻撃" };
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
    options: [{ role: "三光", points: 5, contract: storm }], hp: null, hpMax: 32, boosts: [0, 0], multiplier: [100, 100], projected: [10, 5] },
};
const reset: RoomView = { ...before, phase: "play", boardRevision: 2, turn: 1,
  players: before.players.map(p => ({ ...p, handCount: 8, captured: [] })),
  hand: [0, 4, 8, 12, 16, 20, 24, 28], field: [1, 5, 9, 13, 17, 21, 25, 29], deckCount: 24, yaku: [[], []],
  hyper: { ...before.hyper!, contracts: [[storm], []], stake: [5, 0], multiplier: [175, 100], projected: [9, 0], hp: [32, 32], options: [] },
};
const captured = [0, 1, 4, 5, 8, 9];
const combo: RoomView = { ...reset, turn: 0, hand: [12, 16, 20, 24, 28], field: [13, 17, 21, 25, 29],
  players: reset.players.map((p, i) => i === 0 ? { ...p, captured, handCount: 5 } : p),
  hyper: { ...reset.hyper!, chain: [3, 0], multiplier: [225, 100], boosts: [1, 0], hp: [32, 11] },
  events: [0, 4, 8].map((cardId, i) => ({
    id: i + 1, player: 0, source: "hand", cardId, targetIds: [cardId + 1], captured: true,
    field: reset.field.slice(i + 1), capturedCards: [captured.slice(0, (i + 1) * 2), []], deckCount: 24,
    requiresChoice: false, hyper: { chain: [i + 1, 0], bloom: [0, 0], multiplier: [i === 2 ? 225 : i === 1 ? 200 : 175, 100], hp: [32, 32 - (i + 1) * 2 - (i === 2 ? 1 : 0)] },
  })),
};
const koReplay: RoomView = {
  ...combo, phase: "round_end", winner: 0, roundPoints: 30,
  hyper: { ...combo.hyper!, hp: [32, 0] },
  events: combo.events!.map(e => ({ ...e, hyper: { ...e.hyper!, hp: [32, Math.max(0, e.hyper!.hp![1] - 11)] } })),
};

const snare: HyperContract = { id: "snare", name: "伏兵", source: "雨四光", points: 7,
  description: "1局3回の秘密の罠。取得されるまで持続、ルーレットで2候補を表示" };
const captureHit: HyperDamage = { attacker: 0, defender: 1, kind: "capture", cards: 2, roles: 0,
  roleGains: [], chain: 0, contract: 2, exposure: 0, blocked: 0, power: 4, damage: 4, hpBefore: 32, hpAfter: 28 };
const trapBoard: RoomView = { ...reset, turn: 0, hand: [0, 8], field: [1, 9], deckCount: 24,
  players: reset.players.map(p => ({ ...p, handCount: 2 })),
  hyper: { ...reset.hyper!, contracts: [[storm, snare], []], trapChoices: ["levy", "reveal"], stake: [7, 0], hp: [32, 32], traps: [null, null], trapReady: [true, false], trapRemaining: [3,0],
    damagePreviews: [{ cardId: 0, targetId: 1, uncertain: true, damage: [captureHit] }, { cardId: 8, targetId: 9, damage: [captureHit] }] },
};
const mutualKo: RoomView = { ...trapBoard, phase: "round_end", turn: 1, winner: null, roundPoints: 0,
  field: [9], hyper: { ...trapBoard.hyper!, hp: [0, 0], traps: [null, null], trapReady: [false, false] },
  events: [{ id: 100, player: 1, source: "hand", cardId: 0, targetIds: [1], captured: true,
    field: [9], capturedCards: [[], [0, 1]], deckCount: 24, requiresChoice: false,
    hyper: { chain: [0, 0], bloom: [0, 0], multiplier: [175, 100], hp: [0, 0], traps: [null, null], damage: [
      { ...captureHit, attacker: 1, defender: 0, contract: 0, power: 2, damage: 2, hpBefore: 2, hpAfter: 0 },
      { ...captureHit, attacker: 0, defender: 1, kind: "trap", cards: 0, contract: 4, damage: 3, hpBefore: 3, hpAfter: 0 },
    ] } }],
};

function Fixture() {
  const [room, setRoom] = useState(before);
  const [key, setKey] = useState(0);
  const [autoMutualKo, setAutoMutualKo] = useState(false);
  const [autoKo, setAutoKo] = useState(false);
  useEffect(() => {
    if (!autoMutualKo) return;
    const timer = window.setTimeout(() => { setRoom(mutualKo); setAutoMutualKo(false); }, 250);
    return () => window.clearTimeout(timer);
  }, [autoMutualKo]);
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
    <button className="button secondary compact" onClick={() => { setKey(k => k + 1); setRoom({
      ...before,
      // The combined 10 base points clear the 5-point cost, but koi is still required.
      hyper: { ...before.hyper!, contracts: [[storm], []], stake: [5, 0], multiplier: [175, 100], projected: [27, 5], cashoutKoiReady: [false, true], options: [] },
    }); }}>あがり条件</button>
    <button className="button secondary compact" onClick={() => { setKey(k => k + 1); setRoom({
      ...before, koikoi: [1, 0], hyper: { ...before.hyper!, contracts: [[storm], []], stake: [5, 0], multiplier: [225, 100], projected: [34, 5], cashoutKoiReady: [true, true], options: [] },
    }); }}>こいこい後のあがり</button>
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
      setRoom({ ...reset, hyper: { ...reset.hyper!, hp: [32, 7] } });
      setAutoKo(true);
    }}>K.O.演出を再生</button>
    <button className="button secondary compact" onClick={() => { setKey(k => k + 1); setRoom(trapBoard); }}>伏兵・ダメージ予告</button>
    <button className="button secondary compact" onClick={() => { setKey(k => k + 1); setRoom({ ...trapBoard,
      log: ["1番手→2番手 攻撃：札2＋役0＋CHAIN0＋契約2＋被ダメ増0、上限16・防御0 → 威力4 / HP減少4（32→28）。"],
      hyper: { ...trapBoard.hyper!, hp: [32, 28] },
    }); }}>攻撃履歴を見る</button>
    <button className="button secondary compact" onClick={() => { setKey(k => k + 1); setRoom({ ...trapBoard,
      phase: "draw_choice", drawnCard: 0, field: [1, 2], legalTargets: [1, 2],
      hyper: { ...trapBoard.hyper!, contracts: [[storm, snare], [snare]], traps: [null, null], trapReady: [false, false],
        damagePreviews: [{ cardId: 0, targetId: 1, uncertain: true, damage: [captureHit] },
          { cardId: 0, targetId: 2, uncertain: true, damage: [captureHit] }] },
    }); }}>めくり・ダメージ予告</button>
    <button className="button secondary compact" onClick={() => {
      setKey(k => k + 1); setRoom({ ...trapBoard, turn: 1, hyper: { ...trapBoard.hyper!, hp: [2, 3], traps: [1, null], trapReady: [false, false] } }); setAutoMutualKo(true);
    }}>双方HP演出（旧イベント互換）</button>
    <button className="button secondary compact" onClick={() => setRoom(combo)}>3連鎖・HP減少を再生</button>
    <button className="button secondary compact" onClick={() => {
      const base = { ...reset, turn: 1, hyper: { ...reset.hyper!, chain: [3, 0] } };
      setKey(k => k + 1);
      setRoom(base);
      window.setTimeout(() => setRoom({ ...base,
        events: [{ id: 1, player: 1, source: "draw", cardId: 4, targetIds: [5], captured: true,
          field: reset.field.filter(id => id !== 5), capturedCards: [[], [4, 5]], deckCount: 23,
          requiresChoice: false, hyper: { chain: [3, 0], bloom: [0, 0], multiplier: [175, 100], hp: [32, 32], counterDraw: true } }],
      }), 100);
    }}>反撃めくりを再生</button>
    <button className="button secondary compact" onClick={() => setRoom({
      ...combo, hand: reset.hand,
      players: reset.players.map((p, i) => i === 1 ? { ...p, captured, handCount: 5 } : p),
      hyper: { ...reset.hyper!, chain: [0, 3], hp: [11, 32] },
      events: combo.events!.map(e => ({ ...e, player: 1, capturedCards: [[], e.capturedCards[0]],
        hyper: { ...e.hyper!, chain: [0, e.hyper!.chain[0]], multiplier: [175, 100], hp: [e.hyper!.hp![1], 32] },
      })),
    })}>相手の反撃</button>
  </div></details><div className="workspace" style={{ margin: 0, flex: 1, minHeight: 0, height: "auto" }}><main>
    <GameRoom key={key} room={room} connected busy={false}
      send={command => {
        const cmd = command as { type: string; targetId?: number };
        if (cmd.type === "trap") setRoom(r => ({ ...r, hyper: { ...r.hyper!, traps: [cmd.targetId!, null], trapReady: [false, false], trapRemaining: [2,0] } }));
        if ((command as { type: string }).type === "hyper") setRoom(reset);
        if ((command as { type: string }).type === "start") setRoom({ ...reset, turn: 0, hyperEnabled: false, hyper: undefined });
      }}
      leave={() => setRoom(before)} copyInvite={() => {}} />
  </main></div></div>;
}
const root = createRoot(document.getElementById("root")!);
root.render(<React.StrictMode><CardSkinProvider><Fixture /></CardSkinProvider></React.StrictMode>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
