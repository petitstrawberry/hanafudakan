import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  MessageCircle,
  Plus,
  ShieldCheck,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";
import Card from "./Card";
import CapturedYaku from "./CapturedYaku";
import { YakuCutIn } from "./YakuCutIn";
import Scene from "./Scene";
import type { TableSceneState } from "./Scene";
import {
  buildYakuAnnouncements,
  yakuAnnouncementDuration,
  type YakuAnnouncement,
} from "../lib/yakuAnnouncements";
import { cards, cardImage } from "../lib/cards";
import { useCardSkin } from "../lib/cardSkin";
import { playSound } from "../lib/audio";
import { getYakuStatuses } from "../lib/yakuStatus";
import { fitFieldLayout } from "../lib/fieldLayout";
import { reconcileFieldSlots, type FieldSlot } from "../lib/fieldSlots";
import type { PublicGameEvent, RoomView } from "../lib/types";
import "../game-enhancements.css";
import "../game-layout.css";

type Props = {
  room: RoomView;
  connected: boolean;
  busy: boolean;
  send: (command: object) => void;
  leave: () => void;
  copyInvite: () => void;
  onBackend?: (backend: string) => void;
};
// Every card in these events has already been played or revealed by the server.
// Neither the opponent's remaining hand nor the stock is part of this protocol.
type PublicMove = PublicGameEvent;
type AnimatedRoom = RoomView & { events?: PublicMove[] };
type Cue = {
  announcement: YakuAnnouncement;
  playerName: string;
  sequence: number;
  reducedMotion: boolean;
  position: { left: number; top: number; width: number; height: number };
};
type Position = { x: number; y: number; width: number; height: number };
type Flight = {
  event: PublicMove;
  source: Position;
  target: Position;
  destination: Position;
  targets: { id: number; position: Position; destination: Position }[];
  stage: "reveal" | "travel" | "stack" | "settle" | "collect";
  duration: number;
  hyper: boolean;
};
type HyperCutIn = {
  name: string;
  source: string;
  description: string;
  sequence: number;
};
const nameOf = (id: number) => cards[id]?.name || "花札";
const sameMonth = (left: number, right: number) =>
  Math.floor(left / 4) === Math.floor(right / 4);
const fieldWobble = (id: number, index: number) => ({
  "--field-shift-x": `${((id * 5 + index * 3) % 7) - 3}px`,
  "--field-shift-y": `${((id * 3 + index * 5) % 5) - 2}px`,
  "--field-rotate": `${(((id * 7 + index * 11) % 9) - 4) / 3}deg`,
});
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
    room.hyper?.contracts,
    room.hyper?.stake,
    room.hyper?.bloom,
    room.hyper?.chain,
    room.hyper?.options,
  ]);
const sleep = (duration: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, duration));
// Keep the contract beat readable without stalling the table for several
// seconds. The queue still waits for this promise, so CPU/opponent moves cannot
// slip underneath the overlay while it is on screen.
const hyperCutInDuration = () => (motionEnabled() ? 1800 : 900);
const paint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

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
  onBackend,
}: Props) {
  const { skin } = useCardSkin();
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
  const [showChat, setShowChat] = useState(false);
  const [roleDetail, setRoleDetail] = useState<{
    player: number;
    id: string;
  } | null>(null);
  const [animating, setAnimating] = useState(false);
  const [sceneBackend, setSceneBackend] = useState("2D");
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [landingCard, setLandingCard] = useState<number | null>(null);
  const [hyperFlash, setHyperFlash] = useState<{ ids: number[]; seq: number } | null>(null);
  const hyperFlashTimer = useRef(0);
  const fieldSlotState = useRef<{ round: number; slots: FieldSlot[] }>({
    round: incoming.round || 0,
    slots: [],
  });
  const currentRound = room.round || 0;
  if (fieldSlotState.current.round !== currentRound) {
    fieldSlotState.current = { round: currentRound, slots: [] };
  }
  const fieldSlots = reconcileFieldSlots(
    fieldSlotState.current.slots,
    room.field,
    landingCard,
  );
  fieldSlotState.current.slots = fieldSlots;
  const [fieldViewport, setFieldViewport] = useState({
    width: 0,
    height: 0,
    maxCardWidth: 64,
  });
  const fieldCleanup = useRef<() => void>(() => {});
  const bindFieldArea = useCallback((node: HTMLDivElement | null) => {
    fieldCleanup.current();
    fieldCleanup.current = () => {};
    if (!node) return;
    const measure = () => {
      const style = window.getComputedStyle(node);
      const width = Math.max(
        0,
        Math.floor(
          (node.clientWidth -
            (parseFloat(style.paddingLeft) || 0) -
            (parseFloat(style.paddingRight) || 0)) *
            10,
        ) / 10,
      );
      const height = Math.max(
        0,
        Math.floor(
          (node.clientHeight -
            (parseFloat(style.paddingTop) || 0) -
            (parseFloat(style.paddingBottom) || 0)) *
            10,
        ) / 10,
      );
      const maxCardWidth = window.innerWidth <= 600 ? 52 : 64;
      setFieldViewport((current) =>
        current.width === width &&
        current.height === height &&
        current.maxCardWidth === maxCardWidth
          ? current
          : { width, height, maxCardWidth },
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(node);
    window.addEventListener("resize", measure);
    fieldCleanup.current = () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const fieldCardCount = fieldSlots.length;
  const fieldLayout = useMemo(
    () =>
      fitFieldLayout(
        fieldCardCount,
        fieldViewport.width,
        fieldViewport.height,
        fieldViewport.maxCardWidth,
        4,
      ),
    [fieldCardCount, fieldViewport],
  );
  const [announcement, setAnnouncement] = useState("");
  const [celebration, setCelebration] = useState("");
  const [hyperCutIn, setHyperCutIn] = useState<HyperCutIn | null>(null);
  const [cue, setCue] = useState<Cue | null>(null);
  const cueSequence = useRef(0);
  const announcedRoles = useRef(
    incoming.yaku.map(
      (roles) => new Map(roles.map((role) => [role.name, role.points])),
    ),
  );
  const reconnectPending = useRef(false);
  const playbackEpoch = useRef(0);
  const table = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const chatBottom = useRef<HTMLDivElement>(null);
  const queue = useRef<{ room: AnimatedRoom; resync: boolean }[]>([]);
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
  const hyperMode = room.hyperEnabled || room.mode === "hyper";
  const hyperState = room.hyper;
  const playing = room.phase === "play";
  const drawnChoice = room.phase === "draw_choice";
  const deciding = room.phase === "decision";
  const ended = room.phase === "round_end" || room.phase === "finished";
  const locked =
    !connected || reconnectPending.current || busy || animating || submitting;
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
  const yakuByPlayer = useMemo(
    () =>
      room.players.map((player, index) =>
        getYakuStatuses(
          player.captured,
          room.players[1 - index]?.captured || [],
          room.yaku[index] || [],
        ),
      ),
    [room.players, room.yaku],
  );
  const detailedRole = roleDetail
    ? yakuByPlayer[roleDetail.player]?.find((role) => role.id === roleDetail.id)
    : undefined;
  const resultWinner =
    room.phase === "finished" ? room.matchWinner : room.winner;
  const handleSceneBackend = useCallback(
    (backend: string) => {
      setSceneBackend(backend);
      onBackend?.(backend);
    },
    [onBackend],
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      queue.current = [];
      window.clearTimeout(hyperFlashTimer.current);
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
    setRoleDetail(null);
  }, [room.round]);
  useEffect(() => {
    if (!roleDetail || !assist) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRoleDetail(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [roleDetail, assist]);
  useEffect(() => {
    chatBottom.current?.scrollIntoView({
      block: "nearest",
      behavior: motionEnabled() ? "smooth" : "instant",
    });
  }, [incoming.messages.length, showChat]);
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
    if (!hyperCutIn) return;
    const timer = window.setTimeout(() => setHyperCutIn(null), hyperCutInDuration());
    return () => window.clearTimeout(timer);
  }, [hyperCutIn]);

  useEffect(() => {
    if (!connected) {
      reconnectPending.current = true;
      playbackEpoch.current++;
      queue.current = [];
      setCue(null);
      setFlight(null);
      setLandingCard(null);
      setHyperCutIn(null);
      window.clearTimeout(hyperFlashTimer.current);
      setHyperFlash(null);
    }
  }, [connected]);

  useEffect(() => {
    // A retained room shown while offline is not a restored server snapshot.
    // Keep the resync marker until the first fresh message after reconnect.
    if (!connected) return;
    const next = incoming as AnimatedRoom;
    const resync = reconnectPending.current;
    reconnectPending.current = false;
    const nextSignature = signature(next);
    const hasUnseen = (next.events || []).some(
      (event) => event.id > lastEvent.current,
    );
    if (nextSignature === receivedSignature.current && !hasUnseen && !resync) {
      if (!processing.current) {
        displayed.current = next;
        setRoom(next);
      }
      return;
    }
    receivedSignature.current = nextSignature;
    if (resync) {
      queue.current = [];
      playbackEpoch.current++;
    }
    queue.current.push({ room: next, resync });
    if (processing.current) return;
    processing.current = true;
    setAnimating(true);

    const updateView = (value: RoomView) => {
      if (!alive.current) return;
      displayed.current = value;
      setRoom(value);
    };
    const runEvent = async (event: PublicMove, epoch: number) => {
      const before = displayed.current;
      const placing = !event.captured && !event.requiresChoice;
      // Reserve exactly the appended field slot before measuring. This also
      // gives wrapping rows room to settle before the card starts travelling.
      setLandingCard(placing ? event.cardId : null);
      await paint();
      if (!alive.current || epoch !== playbackEpoch.current) return;
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
      const destinationFor = (id: number): Position => {
        const pile = root.current?.querySelector(
          `[data-capture-player="${event.player}"] [data-capture-kind="${cards[id].kind}"] .captured-yaku-scroll`,
        );
        const pileBounds = pile?.getBoundingClientRect();
        const visible =
          pileBounds &&
          pileBounds.top >= 0 &&
          pileBounds.bottom < window.innerHeight;
        const anchor = positionOf(
          (visible
            ? pile
            : table.current?.querySelector(
                `[data-player-index="${event.player}"] .player-score`,
              )) || null,
          { ...center, y: center.y + (isOwn ? 200 : -130) },
        );
        return {
          ...anchor,
          x: anchor.x + anchor.width / 2 - target.width / 2,
          y: anchor.y + anchor.height / 2 - target.height / 2,
        };
      };
      const destination = destinationFor(event.cardId);
      // A Hyper capture means the taker already holds a Hyper contract.
      // Merely playing in a Hyper room keeps the normal capture sound.
      const hyperCharged =
        hyperMode &&
        event.captured &&
        (before.hyper?.contracts[event.player]?.length ?? 0) > 0;
      const animate = motionEnabled();
      const timing = animate
        ? { reveal: 350, travel: 430, stack: 450, collect: 450 }
        : { reveal: 120, travel: 0, stack: 100, collect: 0 };
      const base = {
        event,
        source,
        target,
        destination,
        targets: targetPositions.map((item) => ({
          ...item,
          destination: destinationFor(item.id),
        })),
        duration: timing.travel,
        hyper: hyperCharged,
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
        if (!alive.current || epoch !== playbackEpoch.current) return;
      }
      if (!event.requiresChoice) {
        setFlight(animate ? { ...base, stage: "travel" } : null);
        await sleep(timing.travel);
        if (!alive.current || epoch !== playbackEpoch.current) return;
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
        if (!alive.current || epoch !== playbackEpoch.current) return;
        if (event.captured) {
          if (hyperCharged) {
            const flashIds = [event.cardId, ...event.targetIds];
            const seq = event.id;
            window.clearTimeout(hyperFlashTimer.current);
            setHyperFlash({ ids: flashIds, seq });
            hyperFlashTimer.current = window.setTimeout(() => {
              if (!alive.current) return;
              setHyperFlash((current) =>
                current && current.seq === seq ? null : current,
              );
            }, 1500);
          }
          playSound(hyperCharged ? "hyper_capture" : "capture");
          if (hyperCharged && event.targetIds.length >= 2) {
            await sleep(110);
            playSound("hyper_chain");
          }
          setFlight(
            animate
              ? { ...base, stage: "collect", duration: timing.collect }
              : null,
          );
          await sleep(timing.collect);
          if (!alive.current || epoch !== playbackEpoch.current) return;
        }
      } else await sleep(180);
      if (!alive.current || epoch !== playbackEpoch.current) return;
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
          const { room: nextRoom, resync: restoring } = queue.current.shift()!;
          const epoch = playbackEpoch.current;
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
            !restoring &&
            (!events.length || events[0].id === lastEvent.current + 1);
          const announce = !roundChanged && continuous;
          const calledHyper =
            nextRoom.hyper?.contracts.some(
              (contracts, index) =>
                contracts.length > (previous.hyper?.contracts[index]?.length || 0),
            ) || false;
          const hyperContract = calledHyper
            ? nextRoom.hyper?.contracts
                .flatMap((contracts, player) =>
                  contracts
                    .slice(previous.hyper?.contracts[player]?.length || 0)
                    .map((contract) => ({ contract, player })),
                )[0]?.contract
            : undefined;

          // A contract announcement owns the timeline. Show it before the next
          // snapshot's move queue is allowed to advance so a CPU/opponent can
          // never play behind the cut-in overlay.
          if (calledHyper && announce && hyperContract) {
            setCelebration(`契約 · ${hyperContract.name}`);
            setHyperCutIn({
              name: hyperContract.name,
              source: hyperContract.source,
              description: hyperContract.description,
              sequence: ++cueSequence.current,
            });
            playSound("hyper");
            await sleep(hyperCutInDuration());
            if (!alive.current) return;
            if (epoch !== playbackEpoch.current) continue;
          }
          if (!roundChanged && continuous) {
            for (const event of events) {
              await runEvent(event, epoch);
              if (epoch !== playbackEpoch.current) break;
              lastEvent.current = event.id;
            }
          } else {
            setSelected(null);
            setCelebration("");
            window.clearTimeout(hyperFlashTimer.current);
            setHyperFlash(null);
          }
          if (!alive.current) return;
          if (epoch !== playbackEpoch.current) {
            setFlight(null);
            setLandingCard(null);
            setCue(null);
            continue;
          }
          lastEvent.current = Math.max(
            lastEvent.current,
            ...events.map((event) => event.id),
          );
          if (!announce)
            announcedRoles.current = nextRoom.yaku.map(
              (roles) => new Map(roles.map((role) => [role.name, role.points])),
            );
          const cues = announce
            ? nextRoom.yaku.flatMap((roles, player) =>
                buildYakuAnnouncements(
                  Array.from(
                    announcedRoles.current[player] || [],
                    ([name, points]) => ({ name, points }),
                  ),
                  roles,
                  nextRoom.players[player]?.captured || [],
                ).map((announcement) => ({ announcement, player })),
              )
            : [];
          nextRoom.yaku.forEach((roles, player) => {
            const baseline = (announcedRoles.current[player] ||= new Map());
            roles.forEach((role) =>
              baseline.set(
                role.name,
                Math.max(baseline.get(role.name) || 0, role.points),
              ),
            );
          });
          const calledKoikoi = nextRoom.koikoi.some(
            (count, index) => count > (previous.koikoi[index] || 0),
          );
          updateView(nextRoom);
          setFlight(null);
          setSelected(null);
          submitLock.current = false;
          setSubmitting(false);
          await paint();
          if (epoch !== playbackEpoch.current) continue;
          if (calledKoikoi && announce) {
            setCelebration("こいこい！");
            playSound("koikoi");
            await sleep(motionEnabled() ? 650 : 150);
          }
          for (const item of cues) {
            if (!alive.current) return;
            if (epoch !== playbackEpoch.current) break;
            const bounds = table.current?.getBoundingClientRect();
            const field = table.current
              ?.querySelector(".table-middle")
              ?.getBoundingClientRect();
            const height = Math.max(
              180,
              Math.min(420, window.innerHeight - 160),
            );
            const width = Math.min(
              bounds?.width || 500,
              window.innerWidth - 24,
            );
            const left = Math.max(
              12,
              Math.min(bounds?.left || 12, window.innerWidth - width - 12),
            );
            const top = Math.max(
              68,
              Math.min(
                (field?.top || 100) + (field?.height || 200) / 2 - height / 2,
                window.innerHeight - height - 82,
              ),
            );
            const reducedMotion = !motionEnabled();
            setCue({
              ...item,
              playerName: nextRoom.players[item.player]?.name || "プレイヤー",
              sequence: ++cueSequence.current,
              reducedMotion,
              position: { left, top, width, height },
            });
            playSound(item.announcement.kind === "role" ? "win" : "capture");
            await sleep(
              yakuAnnouncementDuration(item.announcement, reducedMotion),
            );
            if (!alive.current) return;
            setCue(null);
            if (epoch !== playbackEpoch.current) break;
            await paint();
          }
          if (
            epoch === playbackEpoch.current &&
            !cues.length &&
            announce &&
            (nextRoom.phase === "round_end" || nextRoom.phase === "finished") &&
            previous.phase !== nextRoom.phase
          )
            playSound("win");
        }
      } finally {
        processing.current = false;
        if (alive.current) {
          if (signature(latest.current) === signature(displayed.current))
            updateView(latest.current);
          setAnimating(false);
          setCue(null);
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
                  ? "光っている場札を1枚選んでください。"
                  : "あなたの番です。手札を1枚選んでください。"
              : `${room.players[room.turn]?.name || "対戦相手"}の番です`;
  const sendChat = (event: FormEvent) => {
    event.preventDefault();
    if (chat.trim() && connected) {
      send({ type: "chat", text: chat.trim() });
      setChat("");
    }
  };
  const points = (room.yaku[own] || []).reduce((sum, y) => sum + y.points, 0);
  const hyperContracts = hyperState?.contracts[own]?.length || 0;
  const hyperMultiplier = hyperMode
    ? hyperContracts >= 3
      ? 5
      : hyperContracts === 2
        ? 3
        : hyperContracts === 1
          ? 1.8
          : 1
    : 1;
  const multiplier = hyperMode
    ? hyperMultiplier
    : (points >= 7 ? 2 : 1) * (room.koikoi[opponent] > 0 ? 2 : 1);
  const hyperProjected = hyperMode
    ? Math.ceil(
        (points + (hyperState?.stake[own] || 0) + (hyperState?.bloom[own] || 0)) *
          hyperMultiplier *
          (1 + 0.25 * Math.min(4, Math.max(0, (hyperState?.chain[own] || 0) - 2))),
      )
    : points * multiplier;
  const exhausted = room.players.every((player) => player.handCount === 0);

  const renderCaptured = (index: number) =>
    room.players[index] && (
      <CapturedYaku
        playerIndex={index}
        playerName={room.players[index].name}
        captured={room.players[index].captured}
        statuses={yakuByPlayer[index]}
        flashIds={hyperFlash?.ids}
        self={me === index}
        spectator={me === null}
        assist={assist}
        selectedRoleId={
          roleDetail?.player === index ? roleDetail.id : undefined
        }
        onRoleSelect={(id) =>
          setRoleDetail((current) =>
            current?.player === index && current.id === id
              ? null
              : { player: index, id },
          )
        }
      />
    );

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
            {hyperMode
              ? `ハイパー花札 · ${room.mode === "cpu" || room.mode === "hyper" ? "花影 Hyper AI" : "対人"}`
              : room.mode === "cpu"
                ? "CPU 対戦"
                : "オンライン対戦"} · 第{" "}
            {room.round || 1} 局 / {room.rounds} 回戦
          </span>
        </div>
        <div className="game-heading-actions">
          <button
            className={`game-chat-toggle assist-toggle ${showChat ? "on" : ""}`}
            aria-expanded={showChat}
            aria-controls="game-chat"
            onClick={() => setShowChat((value) => !value)}
          >
            <MessageCircle size={14} />
            会話
          </button>
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
      <div className={`game-layout ${showChat ? "chat-open" : ""}`}>
        <div className="game-primary">
          <div
            ref={table}
            className={`game-table three-dimensional-table ${animating ? "table-in-motion" : ""} ${hyperMode ? "hyper-table" : ""} ${hyperFlash ? "hyper-flash-active" : ""}`}
            data-scene-backend={sceneBackend}
          >
            <Scene
              placement="table"
              active={!ended && motionEnabled()}
              intensity={hyperMode ? 1.8 : 0.92}
              cardSkin={skin}
              game={
                {
                  hyper: hyperMode,
                  field: room.field,
                  hand: room.hand,
                  opponentHandCount: room.players[opponent]?.handCount || 0,
                  deckCount: room.deckCount,
                  drawnCard: room.drawnCard,
                  phase: room.phase,
                  turn: room.turn,
                  eventId: flight?.event.id || room.events.at(-1)?.id || 0,
                  eventCaptured: flight?.event.captured || room.events.at(-1)?.captured || false,
                  eventCardId: flight?.event.cardId ?? null,
                  eventTargetIds: flight?.event.targetIds || [],
                  eventStage: flight?.stage || null,
                  effectId: hyperMode
                    ? (flight?.event.id || room.events.at(-1)?.id || 0) * 10
                      + (room.hyper?.contracts.flat().length || 0)
                    : flight?.event.id || room.events.at(-1)?.id || 0,
                } as TableSceneState
              }
              onReady={handleSceneBackend}
            />
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
                {hyperMode && hyperState && (
                  <HyperHud
                    state={hyperState}
                    own={own}
                    opponent={opponent}
                    active={myTurn && !ended}
                  />
                )}
                <PlayerBar
                  player={room.players[opponent]}
                  playerIndex={opponent}
                  position="opponent"
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
                <div className="capture-zone capture-zone-opponent">
                  {renderCaptured(opponent)}
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
                  <div className="field-area" ref={bindFieldArea}>
                    <span className="table-watermark">花札館</span>
                    <div
                      className="field-cards"
                      data-field-rows={fieldLayout.rows}
                      data-field-cols={fieldLayout.columns}
                      data-field-count={fieldCardCount}
                      style={
                        {
                          "--field-card-width": `${fieldLayout.cardWidth}px`,
                          "--field-card-height": `${fieldLayout.cardHeight}px`,
                          "--field-cols": fieldLayout.columns,
                          "--field-rows": fieldLayout.rows,
                          "--field-gap": `${fieldLayout.gap}px`,
                        } as CSSProperties
                      }
                    >
                      {fieldSlots.map((id, index) => {
                        if (id === null) {
                          return (
                            <div
                              className="field-slot field-empty-slot"
                              key={`empty-${index}`}
                              style={fieldWobble(0, index) as CSSProperties}
                              aria-hidden="true"
                            >
                              <span className="hana-card field-card-placeholder" />
                            </div>
                          );
                        }
                        const landing =
                          landingCard === id && !room.field.includes(id);
                        return (
                          <div
                            className={`field-slot ${landing ? "field-landing-slot" : ""} ${targets.includes(id) && myTurn && !animating ? "match-target" : assistTargets.includes(id) && canPlay ? "assist-target" : ""} ${flight?.event.targetIds.includes(id) && (flight.stage === "stack" || flight.stage === "collect") ? "card-in-flight" : ""} ${hyperFlash?.ids.includes(id) ? "hyper-capture-flash" : ""}`}
                            key={id}
                            style={fieldWobble(id, index) as CSSProperties}
                            data-landing-card={landing ? id : undefined}
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
                        );
                      })}
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
                <div className="capture-zone capture-zone-own">
                  {renderCaptured(own)}
                </div>
                <div className="your-hand">
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
                            />
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
                <PlayerBar
                  player={room.players[own]}
                  playerIndex={own}
                  position="own"
                  active={room.turn === own && !ended}
                  koikoi={room.koikoi[own]}
                  dealer={room.dealer === own}
                  self={me !== null}
                />
                {deciding && myTurn && !animating && (
                  <div className="decision-shade">
                    <div className="decision-panel">
                      <span className="eyebrow">A WINNING HAND</span>
                      <div className="decision-scoreline" aria-label="現在の累計得点">
                        <span>現在の累計</span>
                        <strong>
                          {room.players[own]?.score ?? 0}
                          <small>文</small>
                        </strong>
                        <span className="decision-opponent-score">
                          相手 {room.players[opponent]?.score ?? 0}文
                        </span>
                      </div>
                      <h2>この勝負、どうする？</h2>
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
                          {hyperMode ? hyperProjected : points * multiplier}
                          <small>文</small>
                        </strong>
                        <span>
                          あがると獲得{multiplier > 1 && ` · ${multiplier}倍`}
                        </span>
                      </div>
                      <p>
                        {exhausted
                          ? "最後の手札です。あがって得点を確定しましょう。"
                          : hyperMode
                            ? "役を契約へ変えると、札を戻して能力が残ります。"
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
                      {hyperMode && hyperState?.options.length ? (
                        <div className="hyper-contract-options" aria-label="Hyper契約候補">
                          <span className="eyebrow">HYPER CONTRACT · 役を能力へ</span>
                          <div>
                            {hyperState.options.map((option) => (
                              <button
                                key={option.contract.id}
                                className="hyper-contract-option"
                                disabled={locked}
                                onClick={() =>
                                  submit({ type: "hyper", role: option.role })
                                }
                              >
                                <strong>{option.contract.name}</strong>
                                <span>{option.role} · {option.points}文</span>
                                <small>{option.contract.description}</small>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
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
        {showChat && (
          <aside className="game-side game-conversation" id="game-chat">
            <div className="game-side-tabs">
              <button
                className="active"
                type="button"
                onClick={() => setShowChat(false)}
                aria-label="会話を閉じる"
              >
                <MessageCircle size={15} />
                会話
              </button>
            </div>
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
            <div className="table-role-guide">
              <Flower2 size={18} />
              <p>
                取り札は光・たね・短冊・かすに分けて並びます。
                <br />
                金色は成立した役、印付きはあと1枚。取り消し線は成立できなくなった役です。
                {assist && (
                  <>
                    <br />
                    役を押すと、必要な札と理由を確認できます。
                  </>
                )}
              </p>
            </div>
          </aside>
        )}
      </div>
      {assist && roleDetail && detailedRole && (
        <section
          className={`role-detail role-detail-${detailedRole.state}`}
          aria-label={`${room.players[roleDetail.player]?.name}の${detailedRole.name}の詳細`}
        >
          <div className="role-detail-title">
            <span>{room.players[roleDetail.player]?.name}</span>
            <button
              className="icon-button"
              aria-label="役の詳細を閉じる"
              onClick={() => setRoleDetail(null)}
            >
              <X size={13} />
            </button>
          </div>
          <h3>
            {detailedRole.name}
            <span>{detailedRole.points}文</span>
          </h3>
          <p>{detailedRole.reason}</p>
          {detailedRole.missing.length > 0 && (
            <div className="role-detail-cards">
              {detailedRole.missing.map((id) => {
                const blocked =
                  room.players[1 - roleDetail.player]?.captured.includes(id);
                return (
                  <span
                    key={id}
                    className={`${blocked ? "role-card-blocked" : ""} ${room.field.includes(id) ? "role-card-in-field" : ""}`}
                    title={`${nameOf(id)}${blocked ? " · 相手が獲得済み" : room.field.includes(id) ? " · 場にあります" : ""}`}
                  >
                    <img src={cardImage(id, skin)} alt={nameOf(id)} />
                    {blocked && <X size={13} />}
                  </span>
                );
              })}
            </div>
          )}
          {detailedRole.missing.length > 0 && (
            <small>金枠：場にある札　×：相手が獲得済み</small>
          )}
        </section>
      )}
      {cue &&
        createPortal(
          <div className="table-cutin-anchor" style={cue.position}>
            <YakuCutIn
              announcement={cue.announcement}
              playerName={cue.playerName}
              sequenceKey={cue.sequence}
              reducedMotion={cue.reducedMotion}
            />
          </div>,
          document.body,
        )}
      {hyperCutIn &&
        createPortal(
          <HyperContractCutIn cutIn={hyperCutIn} />,
          document.body,
        )}
      {flight && createPortal(<MoveOverlay flight={flight} />, document.body)}
    </section>
  );
}

function MoveOverlay({ flight }: { flight: Flight }) {
  const { skin } = useCardSkin();
  const { source, target, destination, event, stage, duration, hyper } = flight;
  const hyperCharged = hyper && event.captured;
  const position: CSSProperties = {
    "--source-x": `${source.x}px`,
    "--source-y": `${source.y}px`,
    "--target-x": `${target.x + (event.captured ? 8 : 0)}px`,
    "--target-y": `${target.y - (event.captured ? 7 : 0)}px`,
    "--target-rotation": event.captured ? "5deg" : "0deg",
    "--destination-x": `${destination.x}px`,
    "--destination-y": `${destination.y}px`,
    "--card-width": `${target.width}px`,
    "--duration": `${duration}ms`,
  } as CSSProperties;
  return (
    <div
      className={`move-overlay move-${stage} ${hyperCharged ? "hyper-capture" : ""}`}
      aria-hidden="true"
      style={position}
    >
      {(stage === "stack" || stage === "collect") &&
        flight.targets.map(
          (
            { id, position: origin, destination: captureDestination },
            index,
          ) => (
            <div
              key={id}
              className="flying-card target-copy"
              style={
                {
                  "--origin-x": `${origin.x}px`,
                  "--destination-x": `${captureDestination.x}px`,
                  "--destination-y": `${captureDestination.y}px`,
                  "--origin-y": `${origin.y}px`,
                  "--stack-offset": `${index * 3}px`,
                  "--stack-rotation": `${index * -4}deg`,
                } as CSSProperties
              }
            >
              <img src={cardImage(id, skin)} alt="" />
            </div>
          ),
        )}
      <div className="flying-card played-copy" key={`${event.id}-${stage}`}>
        <img src={cardImage(event.cardId, skin)} alt="" />
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

function HyperContractCutIn({ cutIn }: { cutIn: HyperCutIn }) {
  return (
    <div className="hyper-contract-cutin" aria-live="assertive">
      <div className="hyper-contract-cutin-rays" aria-hidden="true" />
      <div className="hyper-contract-cutin-copy">
        <span>HYPER CONTRACT · {cutIn.source}</span>
        <strong>{cutIn.name}</strong>
        <small>{cutIn.description}</small>
      </div>
      <div className="hyper-contract-cutin-seal" aria-hidden="true">契</div>
    </div>
  );
}

function HyperHud({
  state,
  own,
  opponent,
  active,
}: {
  state: NonNullable<RoomView["hyper"]>;
  own: number;
  opponent: number;
  active: boolean;
}) {
  const renderContracts = (index: number) => (
    <div className={`hyper-contracts ${index === own ? "own" : "opponent"}`}>
      <span className="hyper-contract-label">{index === own ? "あなたの契約" : "相手の契約"}</span>
      <div>
        {state.contracts[index]?.length ? (
          state.contracts[index].map((contract) => (
            <span className="hyper-contract-chip" key={contract.id} title={contract.description}>
              <b>{contract.name}</b>
              <small>{contract.source}</small>
            </span>
          ))
        ) : (
          <span className="hyper-contract-empty">未契約</span>
        )}
      </div>
    </div>
  );
  return (
    <div className={`hyper-hud ${active ? "is-active" : ""}`}>
      <div className="hyper-hud-title">
        <span className="hyper-pulse" />
        <strong>HYPER 花札</strong>
        <small>役を契約に変換して、連鎖を伸ばす</small>
        <em>{active ? "ACTIVE" : "SYNCED"}</em>
      </div>
      <div className="hyper-hud-main">
        <div className="hyper-hud-side hyper-hud-side-opponent">
          {renderContracts(opponent)}
        </div>
        <div className="hyper-hud-center">
          <div className="hyper-hud-metrics">
            <span>賭け点 <b>{state.stake[own] || 0}</b></span>
            <span>花力 <b>{state.bloom[own] || 0}</b></span>
          </div>
          <div className="hyper-hud-chain-readout">
            <small>CHAIN</small>
            <strong>
              {state.contracts[own]?.length ? `x${state.chain[own] || 0}` : "—"}
            </strong>
          </div>
        </div>
        <div className="hyper-hud-side hyper-hud-side-own">
          {renderContracts(own)}
        </div>
      </div>
    </div>
  );
}

function PlayerBar({
  player,
  playerIndex,
  position,
  active,
  koikoi,
  dealer,
  self = false,
}: {
  player: RoomView["players"][number] | undefined;
  playerIndex: number;
  position: "opponent" | "own";
  active: boolean;
  koikoi: number;
  dealer: boolean;
  self?: boolean;
}) {
  if (!player) return null;
  return (
    <div
      className={`player-bar ${position}-player ${active ? "active" : ""}`}
      data-player-index={playerIndex}
    >
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
