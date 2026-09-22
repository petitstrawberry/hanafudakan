import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Cpu,
  Eye,
  Flower2,
  Layers3,
  MessageCircle,
  Plus,
  ShieldCheck,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";
import Card from "./Card";
import { cards, cardImage, MONTHS } from "../lib/cards";
import { playSound } from "../lib/audio";
import type { PublicGameEvent, RoomView } from "../lib/types";
import "../game-enhancements.css";

type Props = {
  room: RoomView;
  connected: boolean;
  busy: boolean;
  send: (command: object) => void;
  leave: () => void;
  copyInvite: () => void;
};
// Every card in these events has already been played or revealed by the server.
// Neither the opponent's remaining hand nor the stock is part of this protocol.
type PublicMove = PublicGameEvent;
type AnimatedRoom = RoomView & { events?: PublicMove[] };
type Position = { x: number; y: number; width: number; height: number };
type Flight = {
  event: PublicMove;
  source: Position;
  target: Position;
  destination: Position;
  targets: { id: number; position: Position }[];
  stage: "reveal" | "travel" | "stack" | "settle" | "collect";
  duration: number;
};
type YakuCandidate = {
  name: string;
  points: number;
  ids: number[];
  need: number;
  have: number;
  missing: number[];
};
const nameOf = (id: number) => cards[id]?.name || "花札";
const sameMonth = (left: number, right: number) =>
  Math.floor(left / 4) === Math.floor(right / 4);
const motionEnabled = () =>
  localStorage.getItem("hana-motion") !== "false" &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const signature = (room: RoomView) =>
  JSON.stringify([
    room.round,
    room.phase,
    room.turn,
    room.hand,
    room.field,
    room.drawnCard,
    room.deckCount,
    room.players.map((p) => [p.handCount, p.captured, p.score]),
    room.koikoi,
  ]);
const sleep = (duration: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, duration));
const paint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

function candidatesFor(
  captured: number[],
  earned: RoomView["yaku"][number] = [],
): YakuCandidate[] {
  const held = new Set(captured);
  const definitions = [
    { name: "猪鹿蝶", points: 5, ids: [20, 24, 36], need: 3 },
    { name: "花見で一杯", points: 5, ids: [8, 32], need: 2 },
    { name: "月見で一杯", points: 5, ids: [28, 32], need: 2 },
    { name: "赤短", points: 5, ids: [1, 5, 9], need: 3 },
    { name: "青短", points: 5, ids: [21, 33, 37], need: 3 },
    { name: "三光", points: 5, ids: [0, 8, 28, 44], need: 3 },
    { name: "四光", points: 8, ids: [0, 8, 28, 44], need: 4 },
    { name: "雨四光", points: 7, ids: [0, 8, 28, 40, 44], need: 4 },
    { name: "五光", points: 10, ids: [0, 8, 28, 40, 44], need: 5 },
    {
      name: "たね",
      points: 1,
      ids: cards.filter((c) => c.kind === "animal").map((c) => c.id),
      need: 5,
    },
    {
      name: "たん",
      points: 1,
      ids: cards.filter((c) => c.kind === "ribbon").map((c) => c.id),
      need: 5,
    },
    {
      name: "かす",
      points: 1,
      ids: cards
        .filter((c) => c.kind === "chaff" || c.id === 32)
        .map((c) => c.id),
      need: 10,
    },
  ];
  return definitions
    .filter((y) => !held.has(40) || (y.name !== "三光" && y.name !== "四光"))
    .map((y) => {
      const nonRainCount = [0, 8, 28, 44].filter((id) => held.has(id)).length;
      const have =
        y.name === "雨四光"
          ? Math.min(3, nonRainCount) + (held.has(40) ? 1 : 0)
          : y.ids.filter((id) => held.has(id)).length;
      const missing =
        y.name === "雨四光" && !held.has(40) && nonRainCount >= 3
          ? [40]
          : y.ids.filter((id) => !held.has(id));
      return { ...y, have, missing };
    })
    .filter((y) => y.have < y.need && !earned.some((e) => e.name === y.name))
    .sort(
      (a, b) =>
        b.have / b.need - a.have / a.need ||
        a.need - a.have - (b.need - b.have) ||
        b.points - a.points,
    )
    .slice(0, 4);
}

function positionOf(element: Element | null, fallback: Position): Position {
  if (!element) return fallback;
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

export default function GameRoom({
  room: incoming,
  connected,
  busy,
  send,
  leave,
  copyInvite,
}: Props) {
  const [room, setRoom] = useState<RoomView>(incoming);
  const displayed = useRef<RoomView>(incoming);
  const latest = useRef<RoomView>(incoming);
  latest.current = incoming;
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [assist, setAssist] = useState(
    () => localStorage.getItem("hana-assist") !== "false",
  );
  const [chat, setChat] = useState("");
  const [panel, setPanel] = useState<"yaku" | "chat">("yaku");
  const [animating, setAnimating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [landingCard, setLandingCard] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [celebration, setCelebration] = useState("");
  const table = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const chatBottom = useRef<HTMLDivElement>(null);
  const queue = useRef<AnimatedRoom[]>([]);
  const processing = useRef(false);
  const alive = useRef(true);
  const lastEvent = useRef(
    Math.max(0, ...((incoming as AnimatedRoom).events || []).map((e) => e.id)),
  );
  const receivedSignature = useRef(signature(incoming));
  const me = room.myIndex;
  const own = me ?? 0;
  const opponent = own === 0 ? 1 : 0;
  const myTurn = me !== null && room.turn === me;
  const playing = room.phase === "play";
  const drawnChoice = room.phase === "draw_choice";
  const deciding = room.phase === "decision";
  const ended = room.phase === "round_end" || room.phase === "finished";
  const locked = !connected || busy || animating || submitting;
  const canPlay = myTurn && playing && !locked;
  const activeCard = drawnChoice ? room.drawnCard : selected;
  const targets =
    activeCard === null
      ? []
      : room.field.filter((id) => sameMonth(id, activeCard));
  const hoverCard = selected ?? hovered;
  const assistTargets =
    assist && hoverCard !== null
      ? room.field.filter((id) => sameMonth(id, hoverCard))
      : [];
  const yakuCandidates = useMemo(
    () => candidatesFor(room.players[own]?.captured || [], room.yaku[own]),
    [room.players, room.yaku, own],
  );
  const resultWinner =
    room.phase === "finished" ? room.matchWinner : room.winner;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      queue.current = [];
    };
  }, []);
  useEffect(() => {
    localStorage.setItem("hana-assist", String(assist));
  }, [assist]);
  useEffect(() => {
    setSelected(null);
    setHovered(null);
  }, [room.round, room.turn, room.phase, room.hand.join(",")]);
  useEffect(() => {
    chatBottom.current?.scrollIntoView({
      block: "nearest",
      behavior: motionEnabled() ? "smooth" : "instant",
    });
  }, [incoming.messages.length, panel]);
  useEffect(() => {
    if (!submitting) return;
    // A rejected action keeps the same game snapshot. Release the lock so the
    // player can retry after the application's server error message is shown.
    const timer = window.setTimeout(() => {
      submitLock.current = false;
      setSubmitting(false);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [submitting]);
  useEffect(() => {
    if (!celebration) return;
    const timer = window.setTimeout(() => setCelebration(""), 1900);
    return () => window.clearTimeout(timer);
  }, [celebration]);

  useEffect(() => {
    const next = incoming as AnimatedRoom;
    const nextSignature = signature(next);
    const hasUnseen = (next.events || []).some(
      (event) => event.id > lastEvent.current,
    );
    if (nextSignature === receivedSignature.current && !hasUnseen) {
      if (!processing.current) {
        displayed.current = next;
        setRoom(next);
      }
      return;
    }
    receivedSignature.current = nextSignature;
    queue.current.push(next);
    if (processing.current) return;
    processing.current = true;
    setAnimating(true);

    const updateView = (value: RoomView) => {
      if (!alive.current) return;
      displayed.current = value;
      setRoom(value);
    };
    const runEvent = async (event: PublicMove) => {
      const before = displayed.current;
      const placing = !event.captured && !event.requiresChoice;
      // Reserve exactly the appended field slot before measuring. This also
      // gives wrapping rows room to settle before the card starts travelling.
      setLandingCard(placing ? event.cardId : null);
      await paint();
      if (!alive.current) return;
      const cardWidth =
        table.current
          ?.querySelector(".field-cards .hana-card")
          ?.getBoundingClientRect().width || 55;
      const bounds = table.current?.getBoundingClientRect();
      const center: Position = {
        x: (bounds?.left || 0) + (bounds?.width || 500) * 0.55,
        y: (bounds?.top || 0) + (bounds?.height || 600) * 0.41,
        width: cardWidth,
        height: cardWidth * 1.58,
      };
      const isOwn = before.myIndex === event.player;
      const source = positionOf(
        table.current?.querySelector(
          event.source === "hand"
            ? isOwn
              ? `.your-hand [data-card-id="${event.cardId}"]`
              : event.player === (before.myIndex ?? 0)
                ? ".spectator-hand .hana-card:last-of-type"
                : ".opponent-hand .hana-card:last-child"
            : event.source === "choice"
              ? ".drawn-card .hana-card"
              : ".deck-pile > .hana-card",
        ) || null,
        center,
      );
      const targetPositions = event.targetIds.map((id) => ({
        id,
        position: positionOf(
          table.current?.querySelector(`.field-cards [data-card-id="${id}"]`) ||
            null,
          center,
        ),
      }));
      const target = placing
        ? positionOf(
            table.current?.querySelector(".field-landing-slot .hana-card") ||
              null,
            center,
          )
        : targetPositions[0]?.position || center;
      const destination = positionOf(
        root.current?.querySelector(
          `[data-capture-player="${event.player}"]`,
        ) || null,
        { ...center, y: center.y + (isOwn ? 200 : -130) },
      );
      const animate = motionEnabled();
      const timing = animate
        ? { reveal: 350, travel: 430, stack: 450, collect: 450 }
        : { reveal: 120, travel: 0, stack: 100, collect: 0 };
      const base = {
        event,
        source,
        target,
        destination,
        targets: targetPositions,
        duration: timing.travel,
      };
      setAnnouncement(
        `${before.players[event.player]?.name || "プレイヤー"} · ${event.source === "hand" ? "手札から" : "山札から"} ${nameOf(event.cardId)}${event.requiresChoice ? " · 合わせる札を選択" : event.captured ? ` · ${event.targetIds.length + 1}枚獲得` : " · 場へ"}`,
      );
      if (event.source === "draw") {
        setFlight(
          animate
            ? { ...base, stage: "reveal", duration: timing.reveal }
            : null,
        );
        playSound("deal");
        await sleep(timing.reveal);
        if (!alive.current) return;
      }
      if (!event.requiresChoice) {
        setFlight(animate ? { ...base, stage: "travel" } : null);
        await sleep(timing.travel);
        if (!alive.current) return;
        const settleDuration = event.captured
          ? timing.stack
          : animate
            ? 180
            : 0;
        setFlight(
          animate
            ? {
                ...base,
                stage: event.captured ? "stack" : "settle",
                duration: settleDuration,
              }
            : null,
        );
        await sleep(settleDuration);
        if (!alive.current) return;
        if (event.captured) {
          playSound("capture");
          setFlight(
            animate
              ? { ...base, stage: "collect", duration: timing.collect }
              : null,
          );
          await sleep(timing.collect);
          if (!alive.current) return;
        }
      } else await sleep(180);
      const hand =
        event.source === "hand" && isOwn
          ? before.hand.filter((id) => id !== event.cardId)
          : before.hand;
      updateView({
        ...before,
        hand,
        field: event.field,
        deckCount: event.deckCount,
        drawnCard: event.requiresChoice ? event.cardId : null,
        players: before.players.map((player, index) => ({
          ...player,
          captured: event.capturedCards[index] || player.captured,
          handCount:
            event.source === "hand" && event.player === index
              ? Math.max(0, player.handCount - 1)
              : player.handCount,
        })),
      });
      setFlight(null);
      setLandingCard(null);
      await paint();
    };
    void (async () => {
      try {
        while (queue.current.length && alive.current) {
          const nextRoom = queue.current.shift()!;
          const previous = displayed.current;
          const events = (nextRoom.events || []).filter(
            (event) => event.id > lastEvent.current,
          );
          const roundChanged =
            nextRoom.round !== previous.round ||
            previous.phase === "waiting" ||
            (previous.phase === "finished" && nextRoom.phase !== "finished");
          // Resynchronise rather than reconstructing an incomplete history after
          // a long disconnection or while starting a fresh round.
          const continuous =
            !events.length || events[0].id === lastEvent.current + 1;
          if (!roundChanged && continuous) {
            for (const event of events) {
              await runEvent(event);
              lastEvent.current = event.id;
            }
          } else {
            setSelected(null);
            setCelebration("");
          }
          if (!alive.current) return;
          lastEvent.current = Math.max(
            lastEvent.current,
            ...events.map((event) => event.id),
          );
          const gainedYaku = nextRoom.yaku.some(
            (set, i) =>
              set.reduce((sum, y) => sum + y.points, 0) >
              (previous.yaku[i] || []).reduce((sum, y) => sum + y.points, 0),
          );
          const calledKoikoi = nextRoom.koikoi.some(
            (count, index) => count > (previous.koikoi[index] || 0),
          );
          updateView(nextRoom);
          setFlight(null);
          setSelected(null);
          submitLock.current = false;
          setSubmitting(false);
          if (calledKoikoi) {
            setCelebration("こいこい！");
            playSound("koikoi");
          } else if (gainedYaku && !roundChanged) {
            setCelebration("役、成立。");
            playSound("win");
          } else if (
            nextRoom.phase === "round_end" ||
            nextRoom.phase === "finished"
          )
            playSound("win");
          await paint();
          if (
            calledKoikoi ||
            (gainedYaku && nextRoom.turn !== nextRoom.myIndex)
          )
            await sleep(motionEnabled() ? 650 : 150);
        }
      } finally {
        processing.current = false;
        if (alive.current) {
          if (signature(latest.current) === signature(displayed.current))
            updateView(latest.current);
          setAnimating(false);
          setFlight(null);
          setLandingCard(null);
          setAnnouncement("");
        }
      }
    })();
  }, [incoming]);

  const submit = (command: object) => {
    if (
      locked ||
      submitLock.current ||
      signature(displayed.current) !== signature(latest.current)
    )
      return;
    submitLock.current = true;
    setSubmitting(true);
    setHovered(null);
    send(command);
  };
  const selectCard = (id: number) => {
    if (!canPlay) return;
    playSound("click");
    const matches = room.field.filter((fieldId) => sameMonth(id, fieldId));
    if (matches.length === 2) {
      setSelected((current) => (current === id ? null : id));
    } else {
      setSelected(null);
      submit({
        type: "play",
        cardId: id,
        ...(matches.length ? { targetId: matches[0] } : {}),
      });
    }
  };
  const selectField = (id: number) => {
    if (!myTurn || locked || !targets.includes(id)) return;
    if (drawnChoice) submit({ type: "choose", targetId: id });
    else if (selected !== null)
      submit({ type: "play", cardId: selected, targetId: id });
  };
  const status = animating
    ? announcement || "札を並べています…"
    : submitting
      ? "札を合わせています…"
      : room.phase === "waiting"
        ? "対戦の準備をしましょう"
        : ended
          ? "一局の余韻を、もう少し。"
          : deciding
            ? myTurn
              ? "あがるか、もう一勝負か。"
              : `${room.players[room.turn]?.name}が考えています`
            : myTurn
              ? drawnChoice
                ? "めくり札です。取る場札を1枚選んでください。"
                : selected !== null
                  ? "同じ月が2枚。取る方を選んでください。"
                  : "あなたの番です。手札を1枚選んでください。"
              : `${room.players[room.turn]?.name || "対戦相手"}の番です`;
  const sendChat = (event: FormEvent) => {
    event.preventDefault();
    if (chat.trim() && connected) {
      send({ type: "chat", text: chat.trim() });
      setChat("");
    }
  };
  const showSelection =
    myTurn &&
    activeCard !== null &&
    targets.length === 2 &&
    (playing || drawnChoice) &&
    !animating;
  const points = (room.yaku[own] || []).reduce((sum, y) => sum + y.points, 0);
  const multiplier =
    (points >= 7 ? 2 : 1) * (room.koikoi[opponent] > 0 ? 2 : 1);
  const exhausted = room.players.every((player) => player.handCount === 0);

  return (
    <section
      ref={root}
      className="game-page enhanced-game"
      data-animating={animating || submitting}
    >
      <div className="game-heading">
        <button className="text-button" onClick={leave}>
          <ArrowLeft size={16} />
          ロビーへ
        </button>
        <div>
          <h1>{room.name}</h1>
          <span>
            {room.mode === "cpu" ? "CPU 対戦" : "オンライン対戦"} · 第{" "}
            {room.round || 1} 局 / {room.rounds} 回戦
          </span>
        </div>
        <div className="game-heading-actions">
          <button
            className={`assist-toggle ${assist ? "on" : ""}`}
            role="switch"
            aria-checked={assist}
            aria-label="対局アシスト"
            onClick={() => setAssist((value) => !value)}
          >
            <Sparkles size={14} />
            アシスト <b>{assist ? "ON" : "OFF"}</b>
          </button>
          <button className="button secondary compact" onClick={copyInvite}>
            <Copy size={14} />
            招待リンク
          </button>
        </div>
      </div>
      <div className="game-layout">
        <div className="game-primary">
          <div
            ref={table}
            className={`game-table ${animating ? "table-in-motion" : ""}`}
          >
            <div className="table-corner corner-one" />
            <div className="table-corner corner-two" />
            <div className="table-corner corner-three" />
            <div className="table-corner corner-four" />
            {room.phase === "waiting" ? (
              <div className="waiting-table">
                <span className="flower-mark">
                  <Flower2 strokeWidth={1.25} />
                </span>
                <div className="eyebrow">A MOMENT BEFORE THE GAME</div>
                <h2>一期一会の、一局を。</h2>
                <p>
                  {room.players.length < 2
                    ? "対戦相手の到着を待っています。"
                    : "おふたり、揃いました。いざ勝負。"}
                </p>
                <div className="waiting-players">
                  {[0, 1].map((i) => (
                    <div key={i}>
                      <span
                        className={`waiting-avatar ${!room.players[i] ? "vacant" : ""}`}
                      >
                        {room.players[i]?.isCpu ? (
                          <Cpu />
                        ) : (
                          room.players[i]?.name.slice(0, 1) || <Plus />
                        )}
                      </span>
                      <strong>
                        {room.players[i]?.name || "お相手を待っています"}
                      </strong>
                      <small>{room.players[i] ? "準備完了" : "WAITING"}</small>
                    </div>
                  ))}
                </div>
                {me !== null && room.players[me]?.id === room.hostId ? (
                  <button
                    className="button primary"
                    disabled={room.players.length < 2 || locked}
                    onClick={() => submit({ type: "start" })}
                  >
                    対戦をはじめる
                    <ArrowRight size={17} />
                  </button>
                ) : (
                  <p className="form-note">
                    主催者が対戦をはじめるまでお待ちください。
                  </p>
                )}
                <button className="text-button" onClick={copyInvite}>
                  <Copy size={14} />
                  友人を招待する
                </button>
              </div>
            ) : (
              <>
                <PlayerBar
                  player={room.players[opponent]}
                  active={room.turn === opponent && !ended}
                  koikoi={room.koikoi[opponent]}
                  dealer={room.dealer === opponent}
                />
                <div className="opponent-hand">
                  {Array.from(
                    { length: room.players[opponent]?.handCount || 0 },
                    (_, index) => (
                      <Card
                        key={index}
                        id={0}
                        back
                        small
                        className={
                          flight?.event.source === "hand" &&
                          flight.event.player === opponent &&
                          index === room.players[opponent].handCount - 1
                            ? "card-in-flight"
                            : ""
                        }
                      />
                    ),
                  )}
                </div>
                <div className="table-middle">
                  <div className="deck-pile">
                    <Card id={0} back />
                    <span>
                      山札 <b>{room.deckCount}</b>
                    </span>
                    {room.drawnCard !== null && (
                      <div
                        className={`drawn-card ${flight?.event.source === "choice" ? "card-in-flight" : ""}`}
                      >
                        <Card id={room.drawnCard} small />
                        <small>めくり札</small>
                      </div>
                    )}
                  </div>
                  <div className="field-area">
                    <span className="table-watermark">花札館</span>
                    <div className="field-cards">
                      {room.field.map((id) => (
                        <div
                          className={`field-slot ${targets.includes(id) && myTurn && !animating ? "match-target" : assistTargets.includes(id) && canPlay ? "assist-target" : ""} ${flight?.event.targetIds.includes(id) && (flight.stage === "stack" || flight.stage === "collect") ? "card-in-flight" : ""}`}
                          key={id}
                        >
                          <Card
                            id={id}
                            onClick={
                              targets.includes(id) && myTurn
                                ? () => selectField(id)
                                : undefined
                            }
                            disabled={locked}
                          />
                          {targets.includes(id) && myTurn && !animating && (
                            <span className="field-target-label">
                              {targets.length === 3 ? "まとめ取り" : "取る"}
                            </span>
                          )}
                        </div>
                      ))}
                      {landingCard !== null &&
                        !room.field.includes(landingCard) && (
                          <div
                            className="field-slot field-landing-slot"
                            aria-hidden="true"
                            data-landing-card={landingCard}
                          >
                            <Card id={landingCard} />
                          </div>
                        )}
                    </div>
                  </div>
                </div>
                <div
                  className={`turn-banner ${myTurn ? "your-turn" : ""}`}
                  role="status"
                  aria-live="polite"
                >
                  <span
                    className={`connection-dot ${connected ? "online" : ""}`}
                  />
                  {status}
                  {selected !== null && !locked && (
                    <button onClick={() => setSelected(null)}>取消</button>
                  )}
                </div>
                {showSelection && (
                  <div
                    className={`selection-tray ${drawnChoice ? "draw-selection" : ""}`}
                    aria-label={
                      drawnChoice ? "めくり札の選択" : "合わせる場札の選択"
                    }
                  >
                    <div className="selected-card-summary">
                      <Card id={activeCard} small />
                      <div>
                        <span className="eyebrow">
                          {drawnChoice ? "めくった札" : "選んだ手札"}
                        </span>
                        <strong>{nameOf(activeCard)}</strong>
                        <small>
                          {Math.floor(activeCard / 4) + 1}月 ·{" "}
                          {MONTHS[Math.floor(activeCard / 4)]}
                        </small>
                      </div>
                    </div>
                    <div className="selection-options">
                      <>
                        <strong className="selection-instruction">
                          どちらの札を取りますか？
                        </strong>
                        <div className="target-options">
                          {targets.map((id) => (
                            <button
                              className="target-option"
                              data-target-id={id}
                              key={id}
                              disabled={locked}
                              onClick={() => selectField(id)}
                              aria-label={`${nameOf(id)}を取る`}
                            >
                              <img src={cardImage(id)} alt="" />
                              <span>
                                {nameOf(id)}
                                <small>
                                  {
                                    {
                                      bright: "光札",
                                      animal: "たね札",
                                      ribbon: "短冊札",
                                      chaff: "かす札",
                                    }[cards[id].kind]
                                  }
                                </small>
                              </span>
                              <ArrowRight size={14} />
                            </button>
                          ))}
                        </div>
                      </>
                    </div>
                    {!drawnChoice && (
                      <button
                        className="selection-cancel icon-button"
                        aria-label="札の選択を取り消す"
                        disabled={locked}
                        onClick={() => setSelected(null)}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                )}
                <div
                  className={`your-hand ${showSelection ? "with-selection" : ""}`}
                >
                  {me === null ? (
                    <div className="spectator-hand">
                      {Array.from(
                        { length: room.players[own]?.handCount || 0 },
                        (_, index) => (
                          <Card
                            id={0}
                            back
                            small
                            key={index}
                            className={
                              flight?.event.source === "hand" &&
                              flight.event.player === own &&
                              index === room.players[own].handCount - 1
                                ? "card-in-flight"
                                : ""
                            }
                          />
                        ),
                      )}
                      <span className="spectator-note">
                        <Eye size={13} />
                        観戦中 · 手札は非公開
                      </span>
                    </div>
                  ) : (
                    room.hand.map((id) => {
                      const canCapture = room.field.some((fieldId) =>
                        sameMonth(id, fieldId),
                      );
                      return (
                        <div
                          className={`hand-slot ${assist && canCapture && myTurn ? "can-capture" : ""} ${selected === id ? "is-selected" : ""} ${flight?.event.source === "hand" && flight.event.cardId === id ? "card-in-flight" : ""}`}
                          key={id}
                          onMouseEnter={() => setHovered(id)}
                          onMouseLeave={() => setHovered(null)}
                          onFocus={() => setHovered(id)}
                          onBlur={() => setHovered(null)}
                        >
                          <Card
                            id={id}
                            selected={selected === id}
                            disabled={!canPlay}
                            onClick={() => selectCard(id)}
                          />
                          {assist && canCapture && myTurn && (
                            <span
                              className="hand-match-dot"
                              title="同じ月の場札があります"
                            />
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
                {assist &&
                  myTurn &&
                  playing &&
                  selected === null &&
                  !animating && (
                    <div className="hand-assist-legend">
                      <span /> 光の印は、今取れる札がある手札です
                    </div>
                  )}
                <PlayerBar
                  player={room.players[own]}
                  active={room.turn === own && !ended}
                  koikoi={room.koikoi[own]}
                  dealer={room.dealer === own}
                  self={me !== null}
                />
                {deciding && myTurn && !animating && (
                  <div className="decision-shade">
                    <div className="decision-panel">
                      <span className="eyebrow">A WINNING HAND</span>
                      <h2>役、成立。</h2>
                      <div className="decision-yaku">
                        {room.yaku[own]?.map((y) => (
                          <span key={y.name}>
                            {y.name}
                            <b>{y.points}文</b>
                          </span>
                        ))}
                      </div>
                      <div className="decision-points">
                        <strong>
                          {points * multiplier}
                          <small>文</small>
                        </strong>
                        <span>
                          あがると獲得{multiplier > 1 && ` · ${multiplier}倍`}
                        </span>
                      </div>
                      <p>
                        {exhausted
                          ? "最後の手札です。あがって得点を確定しましょう。"
                          : "ここであがる。それとも、もう一役。"}
                      </p>
                      <div>
                        <button
                          className="button secondary"
                          disabled={locked}
                          onClick={() =>
                            submit({ type: "decision", koikoi: false })
                          }
                        >
                          <Check size={16} />
                          あがる
                        </button>
                        <button
                          className="button primary koikoi-button"
                          disabled={locked || exhausted}
                          onClick={() =>
                            submit({ type: "decision", koikoi: true })
                          }
                        >
                          こいこい！
                          <Sparkles size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {ended && !animating && (
                  <div className="decision-shade">
                    <div className="decision-panel result-panel">
                      <Trophy className="gold" size={35} />
                      <span className="eyebrow">
                        {room.phase === "finished"
                          ? "FINAL RESULT"
                          : "ROUND RESULT"}
                      </span>
                      <h2>
                        {resultWinner === null
                          ? "引き分け"
                          : `${room.players[resultWinner]?.name}の勝ち`}
                      </h2>
                      <div className="result-score">
                        {room.phase === "finished" ? (
                          room.players.map((player, index) => (
                            <div key={player.id}>
                              <small>{player.name}</small>
                              <strong
                                className={index === resultWinner ? "gold" : ""}
                              >
                                {player.score}
                                <span>文</span>
                              </strong>
                            </div>
                          ))
                        ) : (
                          <strong>
                            ＋{room.roundPoints}
                            <span>文</span>
                          </strong>
                        )}
                      </div>
                      {room.winner !== null && (
                        <p>
                          {room.yaku[room.winner]
                            ?.map((y) => y.name)
                            .join(" ・ ")}
                        </p>
                      )}
                      <div>
                        <button className="button secondary" onClick={leave}>
                          ロビーへ
                        </button>
                        {me !== null &&
                          room.players[me]?.id === room.hostId && (
                            <button
                              className="button primary"
                              disabled={locked}
                              onClick={() =>
                                submit({
                                  type:
                                    room.phase === "finished"
                                      ? "rematch"
                                      : "next_round",
                                })
                              }
                            >
                              {room.phase === "finished"
                                ? "もう一度遊ぶ"
                                : "次の局へ"}
                              <ArrowRight size={16} />
                            </button>
                          )}
                      </div>
                      {me !== null && room.players[me]?.id !== room.hostId && (
                        <small>主催者の操作を待っています</small>
                      )}
                    </div>
                  </div>
                )}
                {celebration && (
                  <div className="yaku-celebration" aria-hidden="true">
                    <span>{celebration}</span>
                    {Array.from({ length: 18 }, (_, index) => (
                      <i
                        key={index}
                        style={{ "--petal-index": index } as CSSProperties}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="game-underbar">
            <span>
              <span className={`connection-dot ${connected ? "online" : ""}`} />
              {connected ? "リアルタイム接続中" : "再接続中…"}
            </span>
            <span>
              <Eye size={13} />
              {incoming.spectators} 人が観戦
            </span>
            <span>
              <ShieldCheck size={13} />
              サーバー判定
            </span>
          </div>
        </div>
        <aside className="game-side">
          <div className="game-side-tabs">
            <button
              className={panel === "yaku" ? "active" : ""}
              onClick={() => setPanel("yaku")}
            >
              <Layers3 size={15} />
              役と獲得札
            </button>
            <button
              className={panel === "chat" ? "active" : ""}
              onClick={() => setPanel("chat")}
            >
              <MessageCircle size={15} />
              会話
            </button>
          </div>
          {panel === "yaku" ? (
            <div className="capture-panel">
              {assist && me !== null && room.phase !== "waiting" && (
                <section className="yaku-assist">
                  <div className="assist-heading">
                    <Sparkles size={15} />
                    <h3>次に狙える役</h3>
                    <span>あと何枚？</span>
                  </div>
                  <p className="assist-description">
                    あなたの獲得札から、役への道しるべ。
                  </p>
                  {yakuCandidates.map((y) => (
                    <div
                      className={`yaku-candidate ${y.need - y.have === 1 ? "one-away" : ""}`}
                      key={y.name}
                    >
                      <div className="candidate-heading">
                        <strong>{y.name}</strong>
                        <span>
                          {y.points}
                          <small>文</small>
                        </span>
                      </div>
                      <div className="candidate-progress">
                        <div>
                          <span
                            style={{
                              width: `${Math.min(100, (y.have / y.need) * 100)}%`,
                            }}
                          />
                        </div>
                        <small>
                          {y.have} / {y.need}
                        </small>
                        <b>あと{y.need - y.have}枚</b>
                      </div>
                      <div className="candidate-missing">
                        {y.missing.slice(0, 6).map((id) => (
                          <img
                            className={
                              room.field.includes(id) ? "in-field" : ""
                            }
                            src={cardImage(id)}
                            key={id}
                            alt={nameOf(id)}
                            title={`${nameOf(id)}${room.field.includes(id) ? " · 場にあります" : ""}`}
                          />
                        ))}
                        {y.missing.length > 6 && (
                          <span>ほか{y.missing.length - 6}枚</span>
                        )}
                      </div>
                      {y.ids.length > y.need && (
                        <small className="candidate-note">
                          {y.name === "雨四光"
                            ? "柳に小野道風と、雨以外の光3枚"
                            : `候補の中から、あと${y.need - y.have}枚`}
                        </small>
                      )}
                    </div>
                  ))}
                  <small className="assist-footnote">
                    金の枠は場にある札。獲得できる保証ではありません。
                    <br />
                    7文以上で得点2倍。相手のこいこい後ならさらに2倍。
                  </small>
                </section>
              )}
              {room.players.map((player, index) => (
                <section key={player.id} data-capture-player={index}>
                  <h3>
                    <span>
                      {player.name}
                      {index === me && <small> · あなた</small>}
                    </span>
                    <small>{player.captured.length}枚</small>
                  </h3>
                  <div className="captured-cards">
                    {player.captured.length ? (
                      player.captured.map((id) => (
                        <img
                          key={id}
                          src={cardImage(id)}
                          title={nameOf(id)}
                          alt={nameOf(id)}
                        />
                      ))
                    ) : (
                      <span>札はこれから。いい一局を。</span>
                    )}
                  </div>
                  <div className="earned-yaku">
                    {room.yaku[index]?.map((y) => (
                      <span key={y.name}>
                        <Check size={10} />
                        {y.name}
                        <b>{y.points}文</b>
                      </span>
                    ))}
                  </div>
                </section>
              ))}
              <div className="game-hint">
                <Flower2 size={18} />
                <p>
                  手札を選ぶ → 場札に重ねる → 獲得。
                  <br />
                  同じ月が2枚なら1枚を選び、3枚ならまとめて取ります。
                </p>
              </div>
              <div className="game-log">
                <span className="eyebrow">TABLE JOURNAL</span>
                {room.log
                  .slice(-5)
                  .reverse()
                  .map((line, index) => (
                    <p key={`${line}-${index}`}>{line}</p>
                  ))}
              </div>
            </div>
          ) : (
            <div className="chat-panel">
              <div className="chat-messages">
                {incoming.messages.length ? (
                  incoming.messages.map((message) => (
                    <div
                      className={`chat-message ${message.system ? "system" : ""}`}
                      key={message.id}
                    >
                      <small>{message.name}</small>
                      <p>{message.text}</p>
                    </div>
                  ))
                ) : (
                  <div className="chat-empty">
                    <MessageCircle size={26} />
                    <p>一言から、いい一局を。</p>
                  </div>
                )}
                <div ref={chatBottom} />
              </div>
              <div className="emotes">
                {["🌸", "👏", "🔥", "🙏"].map((emoji) => (
                  <button
                    key={emoji}
                    aria-label={`リアクション ${emoji}`}
                    disabled={!connected}
                    onClick={() => send({ type: "emote", emoji })}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <form className="chat-form" onSubmit={sendChat}>
                <input
                  aria-label="チャットメッセージ"
                  placeholder="よろしくお願いします"
                  maxLength={200}
                  value={chat}
                  onChange={(event) => setChat(event.target.value)}
                />
                <button aria-label="送信" disabled={!connected || !chat.trim()}>
                  <ArrowRight size={17} />
                </button>
              </form>
            </div>
          )}
        </aside>
      </div>
      {flight && createPortal(<MoveOverlay flight={flight} />, document.body)}
    </section>
  );
}

function MoveOverlay({ flight }: { flight: Flight }) {
  const { source, target, destination, event, stage, duration } = flight;
  const position: CSSProperties = {
    "--source-x": `${source.x}px`,
    "--source-y": `${source.y}px`,
    "--target-x": `${target.x + (event.captured ? 8 : 0)}px`,
    "--target-y": `${target.y - (event.captured ? 7 : 0)}px`,
    "--target-rotation": event.captured ? "5deg" : "0deg",
    "--destination-x": `${destination.x + 18}px`,
    "--destination-y": `${destination.y + 35}px`,
    "--card-width": `${target.width}px`,
    "--duration": `${duration}ms`,
  } as CSSProperties;
  return (
    <div
      className={`move-overlay move-${stage}`}
      aria-hidden="true"
      style={position}
    >
      {(stage === "stack" || stage === "collect") &&
        flight.targets.map(({ id, position: origin }, index) => (
          <div
            key={id}
            className="flying-card target-copy"
            style={
              {
                "--origin-x": `${origin.x}px`,
                "--origin-y": `${origin.y}px`,
                "--stack-offset": `${index * 3}px`,
                "--stack-rotation": `${index * -4}deg`,
              } as CSSProperties
            }
          >
            <img src={cardImage(id)} alt="" />
          </div>
        ))}
      <div className="flying-card played-copy" key={`${event.id}-${stage}`}>
        <img src={cardImage(event.cardId)} alt="" />
      </div>
      {(stage === "stack" || stage === "collect") && event.captured && (
        <div
          className="capture-ring"
          style={{
            left: target.x + target.width / 2,
            top: target.y + target.height / 2,
          }}
        />
      )}
      {stage === "reveal" && (
        <div
          className="reveal-caption"
          style={{ left: source.x + source.width / 2, top: source.y - 30 }}
        >
          めくり
        </div>
      )}
    </div>
  );
}

function PlayerBar({
  player,
  active,
  koikoi,
  dealer,
  self = false,
}: {
  player: RoomView["players"][number] | undefined;
  active: boolean;
  koikoi: number;
  dealer: boolean;
  self?: boolean;
}) {
  if (!player) return null;
  return (
    <div className={`player-bar ${active ? "active" : ""}`}>
      <span className={`player-avatar ${player.isCpu ? "cpu" : ""}`}>
        {player.isCpu ? <Cpu size={18} /> : player.name.slice(0, 1)}
      </span>
      <div className="player-name">
        <strong>
          {player.name}
          {self && <small>あなた</small>}
        </strong>
        <span>
          {player.isCpu ? "COMPUTER" : player.connected ? "ONLINE" : "OFFLINE"}
          {dealer && <b>親</b>}
        </span>
      </div>
      {koikoi > 0 && (
        <span className="koikoi-tag">
          こいこい{koikoi > 1 ? ` ×${koikoi}` : ""}
        </span>
      )}
      <div className="player-score">
        {player.score}
        <small>文</small>
      </div>
    </div>
  );
}
