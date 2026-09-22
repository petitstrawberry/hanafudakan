import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  CircleHelp,
  Cpu,
  Flower2,
  Gamepad2,
  Globe2,
  Layers3,
  LockKeyhole,
  Maximize,
  Music2,
  Palette,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  X,
} from "lucide-react";
import Card from "./components/Card";
import CardArtCredit from "./components/CardArtCredit";
import Scene from "./components/Scene";
import GameRoom from "./components/GameRoom";
import { cards, cardImage } from "./lib/cards";
import { CARD_SKIN_OPTIONS, useCardSkin } from "./lib/cardSkin";
import { playSound, setMuted } from "./lib/audio";
import { api, ApiError, readSession, saveSession } from "./lib/api";
import type { Mode, RoomSummary, RoomView, Session } from "./lib/types";

type Page = "lobby" | "collection" | "guide" | "settings";
type Modal = "create" | "profile" | "leave" | RoomSummary | null;
const YAKU = [
  {
    name: "五光",
    points: 10,
    ids: [0, 8, 28, 40, 44],
    text: "光札を5枚すべて集める。花札の頂点。",
  },
  {
    name: "四光",
    points: 8,
    ids: [0, 8, 28, 44],
    text: "雨を除く光札を4枚。雨四光は7文。",
  },
  {
    name: "三光",
    points: 5,
    ids: [0, 8, 28],
    text: "雨を除く光札を3枚集める。",
  },
  {
    name: "猪鹿蝶",
    points: 5,
    ids: [20, 24, 36],
    text: "萩に猪、紅葉に鹿、牡丹に蝶。",
  },
  {
    name: "花見で一杯",
    points: 5,
    ids: [8, 32],
    text: "桜に幕と、菊に盃。月と盃は月見で一杯。",
  },
  {
    name: "赤短・青短",
    points: 5,
    ids: [1, 5, 9, 21, 33, 37],
    text: "文字入りの赤短3枚、または青短3枚。",
  },
  {
    name: "たね・たん",
    points: 1,
    ids: [4, 12, 16, 20, 24],
    text: "たね札または短冊札を5枚。以降1枚ごとに＋1文。",
  },
  {
    name: "かす",
    points: 1,
    ids: [2, 6, 10, 14, 18],
    text: "かす札を10枚。以降1枚ごとに＋1文。盃はかすにも数える。",
  },
];
function FlowerMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`flower-mark ${small ? "small" : ""}`}>
      <Flower2 strokeWidth={1.25} />
    </span>
  );
}
function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    const root = ref.current;
    root?.querySelector<HTMLElement>("input,button")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && root) {
        const items = Array.from(
          root.querySelectorAll<HTMLElement>(
            'button,input,select,[tabindex="0"]',
          ),
        ).filter((el) => !el.hasAttribute("disabled"));
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      before?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-shade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <div className="modal-heading">
          <span className="eyebrow">HANAFUDAKAN</span>
          <button className="icon-button" aria-label="閉じる" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
export default function App() {
  const { skin: cardSkin } = useCardSkin();
  const [session, setSession] = useState<Session | null>(readSession);
  const [page, setPage] = useState<Page>("lobby");
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [connected, setConnected] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sound, setSound] = useState(
    () => localStorage.getItem("hana-sound") !== "false",
  );
  const [motion, setMotion] = useState(
    () =>
      localStorage.getItem("hana-motion") !== "false" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [backend, setBackend] = useState("描画準備中");
  const ws = useRef<WebSocket | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const currentRoom = useRef<RoomView | null>(null);
  const inviteHandled = useRef(false);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 5000);
  }, []);
  useEffect(() => {
    setMuted(!sound);
    localStorage.setItem("hana-sound", String(sound));
  }, [sound]);
  useEffect(() => {
    localStorage.setItem("hana-motion", String(motion));
    document.documentElement.dataset.motion = String(motion);
  }, [motion]);
  const refresh = useCallback(async () => {
    try {
      const data = await api<{ rooms: RoomSummary[] }>("/rooms");
      setRooms(data.rooms);
      setOnline(true);
    } catch {
      setOnline(false);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  const ensureSession = async () => {
    if (session) {
      try {
        await api("/me", { token: session.token });
        return session;
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
      }
    }
    const name =
      session?.name ||
      localStorage.getItem("hana-name") ||
      `旅人${Math.floor(100 + Math.random() * 900)}`;
    const s = await api<Session>("/session", {
      method: "POST",
      body: { name },
    });
    saveSession(s);
    setSession(s);
    return s;
  };
  const openRoom = (id: string) => {
    setRoom(null);
    currentRoom.current = null;
    setRoomId(id);
    setModal(null);
    setPage("lobby");
    const url = new URL(location.href);
    url.searchParams.set("room", id);
    history.replaceState({}, "", url);
  };
  const join = async (r: RoomSummary, password = "", spectate = false) => {
    setBusy(true);
    try {
      const s = await ensureSession();
      await api(`/rooms/${r.id}/join`, {
        method: "POST",
        token: s.token,
        body: { password, spectate },
      });
      openRoom(r.id);
      playSound("deal");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const create = async (
    name: string,
    mode: Mode,
    rounds: number,
    password = "",
    hyper = false,
  ) => {
    setBusy(true);
    try {
      const s = await ensureSession();
      const result = await api<{ roomId: string }>("/rooms", {
        method: "POST",
        token: s.token,
        body: { name, mode, rounds, password, hyper },
      });
      openRoom(result.roomId);
      playSound("deal");
      void refresh();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (loading || !online || inviteHandled.current) return;
    inviteHandled.current = true;
    const id = new URLSearchParams(location.search).get("room");
    if (!id) return;
    const r = rooms.find((r) => r.id === id);
    if (r) {
      if (r.locked) setModal(r);
      else void join(r, "", r.players >= 2);
    } else notify("招待された卓は見つかりませんでした。");
  }, [loading, online, rooms]);
  useEffect(() => {
    if (!roomId || !session) return;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const connect = () => {
      const socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws?token=${encodeURIComponent(session.token)}&room=${encodeURIComponent(roomId)}`,
      );
      ws.current = socket;
      socket.onopen = () => {
        setConnected(true);
        attempts = 0;
      };
      socket.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === "error") notify(data.message);
          if (data.type === "state") {
            const next = data.room as RoomView;
            currentRoom.current = next;
            setRoom(next);
          }
        } catch {
          notify("受信データを読み込めませんでした");
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (!stopped) {
          attempts++;
          if (attempts <= 8)
            retry = setTimeout(connect, Math.min(1000 * 2 ** attempts, 15000));
          else notify("接続が切れました。ロビーから再入室してください。");
        }
      };
      socket.onerror = () => socket.close();
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      ws.current?.close();
      ws.current = null;
      setConnected(false);
    };
  }, [roomId, session?.token, notify]);
  const send = (command: object) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(command));
    } else notify("サーバーへ再接続しています。しばらくお待ちください。");
  };
  const performLeave = async () => {
    if (!roomId || !session) return;
    setBusy(true);
    try {
      await api(`/rooms/${roomId}/leave`, {
        method: "POST",
        token: session.token,
        body: {},
      });
      setRoomId(null);
      setRoom(null);
      setModal(null);
      setPage("lobby");
      const url = new URL(location.href);
      url.searchParams.delete("room");
      history.replaceState({}, "", url);
      void refresh();
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 404 || error.status === 401)
      ) {
        setRoomId(null);
        setRoom(null);
        setModal(null);
        history.replaceState({}, "", location.pathname);
        void refresh();
      } else notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const leave = () => {
    if (room?.myIndex !== null && room?.status === "playing") setModal("leave");
    else void performLeave();
  };
  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      notify("招待リンクをコピーしました");
    } catch {
      notify("アドレスバーのURLをコピーして招待できます");
    }
  };
  const visibleRooms = rooms.filter(
    (r) =>
      (filter === "all" ||
        (filter === "open"
          ? r.status === "waiting" && r.players < 2
          : r.locked)) &&
      `${r.name} ${r.hostName}`.toLowerCase().includes(search.toLowerCase()),
  );
  const closeModal = useCallback(() => setModal(null), []);
  return (
    <div className="app-shell">
      {!roomId && (
        <Scene
          active={motion}
          cardSkin={cardSkin}
          intensity={1}
          onReady={setBackend}
        />
      )}
      <aside className="sidebar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            setPage("lobby");
          }}
        >
          <FlowerMark />
          <span>
            <strong>花札館</strong>
            <small>HANAFUDAKAN</small>
          </span>
        </a>
        <span className="sidebar-caption">遊びを、粋に。</span>
        <nav className="navigation" aria-label="メインメニュー">
          {(
            [
              { id: "lobby", icon: Gamepad2, label: "対戦ロビー", en: "PLAY" },
              {
                id: "collection",
                icon: Layers3,
                label: "札の図鑑",
                en: "CARDS",
              },
              { id: "guide", icon: BookOpen, label: "遊びかた", en: "GUIDE" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? "active" : ""}`}
              onClick={() => {
                setPage(item.id);
                playSound("click");
              }}
            >
              <item.icon size={19} />
              <span>
                {item.id === "lobby" && roomId ? "対戦に戻る" : item.label}
                <small>{item.en}</small>
              </span>
              {page === item.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="season-note">
            <span className="mini-line" />
            <span>花鳥風月と、ひと勝負。</span>
            <Flower2 size={36} strokeWidth={0.7} />
            <p>
              四季をめくる。
              <br />
              こころが重なる。
            </p>
          </div>
          <button
            className={`nav-item settings-nav ${page === "settings" ? "active" : ""}`}
            onClick={() => {
              setPage("settings");
            }}
          >
            <Settings2 size={18} />
            <span>設定</span>
          </button>
          <button
            className="profile-button"
            onClick={() => setModal("profile")}
          >
            <span className="avatar">
              {(session?.name || "旅人").slice(0, 1)}
            </span>
            <span>
              <strong>{session?.name || "旅人さん"}</strong>
              <small>ゲストプレイヤー</small>
            </span>
            <ChevronRight size={14} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            花札館 <ChevronRight size={12} />
            <span>
              {roomId && page === "lobby"
                ? "対戦の間"
                : {
                    lobby: "対戦ロビー",
                    collection: "札の図鑑",
                    guide: "遊びかた",
                    settings: "設定",
                  }[page]}
            </span>
          </div>
          <div className="topbar-right">
            <span className={`connection-dot ${online ? "online" : ""}`} />
            <span className="server-label">
              {online ? "サーバー接続中" : "サーバー未接続"}
            </span>
            <span className="topbar-divider" />
            <button
              className={`icon-button ${sound ? "gold" : ""}`}
              aria-label={sound ? "音をオフにする" : "音をオンにする"}
              onClick={() => {
                setSound(!sound);
                if (!sound) {
                  setMuted(false);
                  playSound("click");
                }
              }}
            >
              {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            <button
              className="icon-button"
              aria-label="全画面表示"
              onClick={() => {
                if (document.fullscreenElement) void document.exitFullscreen();
                else
                  void document.documentElement
                    .requestFullscreen()
                    .catch(() =>
                      notify("このブラウザーは全画面表示に対応していません"),
                    );
              }}
            >
              <Maximize size={17} />
            </button>
            <span className="mini-avatar">
              {(session?.name || "旅").slice(0, 1)}
            </span>
          </div>
        </header>
        <main>
          {roomId && page === "lobby" ? (
            room ? (
              <GameRoom
                room={room}
                connected={connected}
                busy={busy}
                send={send}
                leave={leave}
                copyInvite={copyInvite}
                onBackend={setBackend}
              />
            ) : (
              <div className="connecting">
                <FlowerMark />
                <h2>卓を支度しています</h2>
                <p>対戦サーバーに接続中…</p>
                <button className="button secondary" onClick={leave}>
                  ロビーへ戻る
                </button>
              </div>
            )
          ) : page === "lobby" ? (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <div className="eyebrow">
                    <span className="short-line" /> THE HANAFUDA SALON
                  </div>
                  <h1>
                    一枚に、
                    <br />
                    <em>心が躍る。</em>
                  </h1>
                  <p className="hero-description">
                    四季の彩りを手のひらに。
                    <br />
                    駆け引きも、偶然も、粋にたのしむ花札の時間。
                  </p>
                  <div className="hero-actions">
                    <button
                      className="button primary"
                      disabled={busy || !online}
                      onClick={() => setModal("create")}
                    >
                      <Plus size={18} />
                      対戦部屋をつくる
                      <ArrowRight size={17} />
                    </button>
                    <button
                      className="text-button"
                      disabled={busy || !online}
                      onClick={() =>
                        void create("ひとりで、こいこい", "cpu", 3)
                      }
                    >
                      <Cpu size={17} /> CPUと遊ぶ <ArrowRight size={15} />
                    </button>
                  </div>
                  <div className="hero-meta">
                    <span>
                      <Globe2 size={13} /> ブラウザですぐに
                    </span>
                    <span className="tiny-dot" />
                    <span>
                      <ShieldCheck size={13} /> あなたのサーバーで
                    </span>
                  </div>
                </div>
                <div
                  className="hero-art"
                  aria-label="松に鶴、桜に幕、芒に月の花札"
                >
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="sun-disc" />
                  <span className="art-caption">花 鳥 風 月</span>
                  <span className="art-spark spark-one">✧</span>
                  <span className="art-spark spark-two">✦</span>
                  <div className="hero-card hero-card-left">
                    <img src={cardImage(8, cardSkin)} alt="桜に幕" />
                  </div>
                  <div className="hero-card hero-card-right">
                    <img src={cardImage(28, cardSkin)} alt="芒に月" />
                  </div>
                  <div className="hero-card hero-card-front">
                    <img src={cardImage(0, cardSkin)} alt="松に鶴" />
                  </div>
                  <div className="art-seal">
                    こい
                    <br />
                    こい
                  </div>
                  <div className="art-bottom-label">
                    <span />
                    四十八枚の、小さな物語。
                    <span />
                  </div>
                </div>
              </section>
              <section className="lobby-section">
                <div className="section-heading">
                  <div>
                    <div className="eyebrow">FIND YOUR TABLE</div>
                    <h2>今宵、どの卓へ。</h2>
                  </div>
                  <div className="live-count">
                    <span className="connection-dot online" />
                    {rooms.length} 卓がオープン <span> / </span>{" "}
                    {rooms.reduce((a, r) => a + r.players + r.spectators, 0)}{" "}
                    人が参加中
                  </div>
                </div>
                <div className="lobby-grid">
                  <div className="rooms-pane">
                    <div className="room-toolbar">
                      <div
                        className="segmented"
                        role="group"
                        aria-label="部屋を絞り込む"
                      >
                        {[
                          { id: "all", label: "すべて" },
                          { id: "open", label: "対戦相手募集中" },
                          { id: "locked", label: "鍵付き" },
                        ].map((f) => (
                          <button
                            key={f.id}
                            onClick={() => setFilter(f.id)}
                            className={filter === f.id ? "active" : ""}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                      <div className="search-box">
                        <Search size={15} />
                        <input
                          aria-label="部屋を検索"
                          placeholder="部屋をさがす"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </div>
                      <button
                        className="icon-button"
                        aria-label="部屋一覧を更新"
                        onClick={() => void refresh()}
                      >
                        <RefreshCw size={15} />
                      </button>
                    </div>
                    <div className="room-list">
                      {loading ? (
                        <div className="empty-state">
                          <Flower2 className="spin" />
                          <p>卓を探しています…</p>
                        </div>
                      ) : !online ? (
                        <div className="empty-state">
                          <Wifi size={30} />
                          <h3>開館の準備中です</h3>
                          <p>対戦サーバーを起動すると、ここに卓が並びます。</p>
                          <button
                            className="text-button"
                            onClick={() => void refresh()}
                          >
                            もう一度接続する <RefreshCw size={14} />
                          </button>
                        </div>
                      ) : visibleRooms.length === 0 ? (
                        <div className="empty-state">
                          <span className="empty-flower">
                            <Flower2 size={32} strokeWidth={1} />
                          </span>
                          <h3>
                            {rooms.length
                              ? "お探しの卓はまだありません"
                              : "今宵の一番席へ、ようこそ。"}
                          </h3>
                          <p>
                            {rooms.length
                              ? "検索条件を変えるか、新しい卓をつくりましょう。"
                              : "新しい卓を囲んで、最初の一局をはじめましょう。"}
                          </p>
                          <button
                            className="text-button gold"
                            onClick={() => setModal("create")}
                          >
                            卓をひらく <Plus size={15} />
                          </button>
                        </div>
                      ) : (
                        visibleRooms.map((r) => (
                          <div className="room-row" key={r.id}>
                            <span
                              className={`room-emblem ${r.locked ? "locked" : ""}`}
                            >
                              {r.hyperEnabled ? (
                                <Sparkles size={23} />
                              ) : r.mode === "cpu" ? (
                                <Cpu size={23} />
                              ) : r.locked ? (
                                <LockKeyhole size={22} />
                              ) : (
                                <Flower2 size={25} strokeWidth={1.3} />
                              )}
                            </span>
                            <div className="room-info">
                              <h3>
                                {r.name}
                                {r.locked && <LockKeyhole size={12} />}
                              </h3>
                              <p>
                                {r.hostName}
                                <span>·</span> {r.rounds}回戦 <span>·</span>{" "}
                                {r.hyperEnabled
                                  ? `ハイパー花札 · ${r.mode === "cpu" ? "CPU" : "対人"}`
                                  : r.mode === "cpu"
                                    ? "CPU対戦"
                                    : "こいこい"}
                              </p>
                            </div>
                            <div className="room-status">
                              <span className={`status-pill ${r.status}`}>
                                {r.status === "waiting"
                                  ? "募集中"
                                  : r.status === "playing"
                                    ? "対戦中"
                                    : "終局"}
                              </span>
                              <small>
                                <Users size={11} />
                                {r.players}/2
                              </small>
                            </div>
                            <button
                              className="join-button"
                              disabled={busy}
                              onClick={() =>
                                r.locked
                                  ? setModal(r)
                                  : void join(
                                      r,
                                      "",
                                      r.players >= 2 || r.status !== "waiting",
                                    )
                              }
                            >
                              {r.players < 2 && r.status === "waiting"
                                ? "入室"
                                : "観戦"}
                              <ArrowRight size={14} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="room-list-footer">
                      <ShieldCheck size={13} />
                      <span>合言葉付きの部屋で、気の合う仲間と。</span>
                      <span className="live-indicator">LIVE</span>
                    </div>
                  </div>
                  <div className="practice-panel">
                    <div className="practice-top">
                      <span className="eyebrow">SOLO PLAY</span>
                      <span className="practice-icon">
                        <Cpu size={22} strokeWidth={1.3} />
                      </span>
                    </div>
                    <h3>
                      ひとり、
                      <br />
                      腕を磨く。
                    </h3>
                    <p>
                      まずは気軽にCPUと一局。
                      <br />
                      自分のペースで、こいこいを。
                    </p>
                    <div className="mini-card-fan">
                      <img src={cardImage(36, cardSkin)} alt="紅葉に鹿" />
                      <img src={cardImage(24, cardSkin)} alt="萩に猪" />
                      <img src={cardImage(20, cardSkin)} alt="牡丹に蝶" />
                    </div>
                    <button
                      className="button practice-button"
                      disabled={busy || !online}
                      onClick={() =>
                        void create("ひとりで、こいこい", "cpu", 3)
                      }
                    >
                      CPU対戦をはじめる
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
              </section>
              <section className="bottom-strip">
                <div>
                  <span className="feature-icon">
                    <BookOpen size={20} strokeWidth={1.4} />
                  </span>
                  <span>
                    <strong>はじめての花札</strong>
                    <small>ルールと役を、さくっとおさらい。</small>
                  </span>
                  <button
                    className="icon-button"
                    aria-label="遊びかたを見る"
                    onClick={() => setPage("guide")}
                  >
                    <ArrowRight size={20} />
                  </button>
                </div>
                <span className="strip-divider" />
                <div>
                  <span className="feature-icon">
                    <Sparkles size={20} strokeWidth={1.4} />
                  </span>
                  <span>
                    <strong>伝統に、新しい遊び心。</strong>
                    <small>立体演出と心地よい音で、没入する一局。</small>
                  </span>
                  <button
                    className="icon-button"
                    aria-label="演出の設定"
                    onClick={() => setPage("settings")}
                  >
                    <ArrowRight size={20} />
                  </button>
                </div>
              </section>
            </>
          ) : page === "collection" ? (
            <Collection />
          ) : page === "guide" ? (
            <Guide
              onPractice={() => void create("はじめてのこいこい", "cpu", 3)}
              disabled={!online || busy || !!roomId}
            />
          ) : (
            <Settings
              sound={sound}
              motion={motion}
              setSound={setSound}
              setMotion={setMotion}
              backend={backend}
              session={session}
              editName={() => setModal("profile")}
            />
          )}
        </main>
        <footer className="footer">
          <span>
            花札館 <span className="footer-dot">·</span> 四季を遊ぶ、縁を結ぶ。
          </span>
          <div>
            <span className="render-tag">
              <span />
              {backend}
            </span>
            <span>SELF-HOSTED, WITH LOVE</span>
          </div>
        </footer>
      </div>
      {modal === "leave" && (
        <ModalShell title="この一局を、終えますか？" onClose={closeModal}>
          <p className="form-intro">
            対戦中に退室すると投了となり、相手の勝ちになります。遊びかたや設定は、対戦を続けたまま開けます。
          </p>
          <div className="modal-actions">
            <button className="button secondary" onClick={closeModal}>
              対戦に戻る
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void performLeave()}
            >
              {busy ? "退室中…" : "投了して退室する"}
            </button>
          </div>
        </ModalShell>
      )}
      {toast && (
        <div className="toast" role="status">
          <Flower2 size={18} />
          {toast}
          <button aria-label="通知を閉じる" onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {modal === "create" && (
        <ModalShell title="今宵の卓を、ひらく。" onClose={closeModal}>
          <CreateForm busy={busy} onCreate={create} />
        </ModalShell>
      )}
      {modal === "profile" && (
        <ModalShell title="あなたのお名前は？" onClose={closeModal}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const name = String(data.get("name")).trim();
              if (!name) return;
              setBusy(true);
              try {
                const s = await api<Session>("/session", {
                  method: "POST",
                  body: { name },
                });
                saveSession(s);
                localStorage.setItem("hana-name", name);
                setSession(s);
                setModal(null);
                notify("お名前を変更しました");
              } catch (e) {
                notify((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p className="form-intro">対戦相手に表示する名前を決めましょう。</p>
            <label className="field-label">
              プレイヤー名
              <input
                name="name"
                defaultValue={session?.name || ""}
                placeholder="旅人"
                required
                maxLength={20}
              />
            </label>
            <button
              className="button primary full-width"
              disabled={busy || !!roomId}
            >
              この名前ではじめる
              <ArrowRight size={17} />
            </button>
            {roomId && (
              <p className="form-note">
                名前はロビーに戻ってから変更できます。
              </p>
            )}
          </form>
        </ModalShell>
      )}
      {modal && typeof modal === "object" && (
        <ModalShell title="合言葉を、どうぞ。" onClose={closeModal}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void join(
                modal,
                String(d.get("password")),
                modal.players >= 2 || modal.status !== "waiting",
              );
            }}
          >
            <p className="form-intro">「{modal.name}」は鍵付きのお部屋です。</p>
            <label className="field-label">
              合言葉
              <input
                name="password"
                type="password"
                placeholder="主催者から届いた合言葉"
                autoComplete="off"
                required
                maxLength={64}
              />
            </label>
            <button className="button primary full-width" disabled={busy}>
              <LockKeyhole size={16} /> {busy ? "確認中…" : "入室する"}
            </button>
          </form>
        </ModalShell>
      )}
    </div>
  );
}
function CreateForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (
    name: string,
    mode: Mode,
    rounds: number,
    password: string,
    hyper: boolean,
  ) => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>("pvp");
  const [hyper, setHyper] = useState(false);
  const [locked, setLocked] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        void onCreate(
          String(d.get("name")),
          mode,
          Number(d.get("rounds")),
          locked ? String(d.get("password")) : "",
          hyper,
        );
      }}
    >
      <p className="form-intro">友人と、まだ見ぬ好敵手と。お好きな一局を。</p>
      <div className="mode-options">
        <button
          type="button"
          className={mode === "pvp" ? "selected" : ""}
          onClick={() => setMode("pvp")}
        >
          <Users size={22} />
          <strong>みんなで対戦</strong>
          <small>友人を招待 / 公開対戦</small>
        </button>
        <button
          type="button"
          className={mode === "cpu" ? "selected" : ""}
          onClick={() => setMode("cpu")}
        >
          <Cpu size={22} />
          <strong>CPUと対戦</strong>
          <small>ひとりで気軽に練習</small>
        </button>
      </div>
      <button
        type="button"
        className={`hyper-toggle ${hyper ? "enabled" : ""}`}
        aria-pressed={hyper}
        onClick={() => setHyper((value) => !value)}
      >
        <span className="hyper-toggle-icon"><Sparkles size={19} /></span>
        <span>
          <strong>ハイパー花札</strong>
          <small>{hyper ? "ON · 役を契約に変えて派手に連鎖" : "OFF · 通常のこいこい"}</small>
        </span>
        <b>{hyper ? "ON" : "OFF"}</b>
      </button>
      <label className="field-label">
        部屋の名前
        <input
          name="name"
          placeholder="月あかりのこいこい"
          maxLength={40}
          required
          defaultValue="月あかりのこいこい"
        />
      </label>
      <label className="field-label">
        対戦の長さ
        <select name="rounds" defaultValue="3">
          <option value="3">3回戦 · さくっと一勝負</option>
          <option value="6">6回戦 · じっくり駆け引き</option>
          <option value="12">12回戦 · 四季をひとめぐり</option>
        </select>
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={locked}
          onChange={(e) => setLocked(e.target.checked)}
        />
        <LockKeyhole size={15} /> 合言葉をつける
      </label>
      {locked && (
        <label className="field-label">
          合言葉
          <input
            name="password"
            type="password"
            minLength={1}
            maxLength={64}
            required
            autoComplete="new-password"
            placeholder="仲間だけの合言葉"
          />
        </label>
      )}
      <button className="button primary full-width" disabled={busy}>
        {busy ? "卓を支度中…" : "この内容で卓をひらく"}
        <ArrowRight size={18} />
      </button>
    </form>
  );
}
function Collection() {
  const [month, setMonth] = useState(0);
  return (
    <section className="inner-page">
      <div className="eyebrow">THE FORTY-EIGHT STORIES</div>
      <h1>札の図鑑</h1>
      <p className="page-intro">
        十二か月の花と、鳥と、物語。四十八枚に息づく日本の四季。
      </p>
      <div className="month-tabs">
        <button className={!month ? "active" : ""} onClick={() => setMonth(0)}>
          すべて
        </button>
        {Array.from({ length: 12 }, (_, i) => (
          <button
            key={i}
            className={month === i + 1 ? "active" : ""}
            onClick={() => setMonth(i + 1)}
          >
            {i + 1}月
          </button>
        ))}
      </div>
      <div className="collection-grid">
        {Array.from({ length: 12 }, (_, i) => i + 1)
          .filter((n) => !month || month === n)
          .map((n) => (
            <div className="collection-month" key={n}>
              <h2>
                <span>{String(n).padStart(2, "0")}</span>
                {
                  [
                    "松",
                    "梅",
                    "桜",
                    "藤",
                    "菖蒲",
                    "牡丹",
                    "萩",
                    "芒",
                    "菊",
                    "紅葉",
                    "柳",
                    "桐",
                  ][n - 1]
                }
              </h2>
              <div>
                {cards
                  .filter((c) => c.month === n)
                  .map((c) => (
                    <div key={c.id}>
                      <Card id={c.id} />
                      <small>{c.name}</small>
                      <span className={`kind-label ${c.kind}`}>
                        {
                          {
                            bright: "光",
                            animal: "たね",
                            ribbon: "短冊",
                            chaff: "かす",
                          }[c.kind]
                        }
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          ))}
      </div>
      <CardArtCredit className="collection-art-credit" />
    </section>
  );
}
function Guide({
  onPractice,
  disabled,
}: {
  onPractice: () => void;
  disabled: boolean;
}) {
  return (
    <section className="inner-page">
      <div className="eyebrow">A LITTLE GUIDE TO KOI-KOI</div>
      <h1>めくる、集める、こいこい。</h1>
      <p className="page-intro">
        同じ月の札を合わせて、役をつくる。あと一枚の駆け引きを楽しもう。
      </p>
      <div className="guide-steps">
        {[
          {
            title: "同じ月の札を合わせる",
            text: "手札を1枚選び、同じ月の場札を取ります。合う札がなければ、手札を場に置きます。",
            icon: Layers3,
          },
          {
            title: "山札をめくって、もう一組",
            text: "山札から1枚めくり、もう一度場札と合わせます。候補が2枚あれば、好きな方を選べます。",
            icon: RefreshCw,
          },
          {
            title: "あがる？ こいこい？",
            text: "役ができたら「あがる」で得点。「こいこい」で続行し、さらに大きな役を狙えます。",
            icon: Trophy,
          },
        ].map((s, i) => (
          <div key={s.title}>
            <span className="step-number">0{i + 1}</span>
            <s.icon size={27} strokeWidth={1.3} />
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </div>
        ))}
      </div>
      <div className="section-heading">
        <div>
          <div className="eyebrow">WINNING COMBINATIONS</div>
          <h2>覚えたい、八つの役。</h2>
        </div>
        <button
          className="button secondary"
          disabled={disabled}
          onClick={onPractice}
        >
          <Cpu size={16} />
          CPUで練習する
        </button>
      </div>
      <div className="yaku-guide">
        {YAKU.map((y) => (
          <article key={y.name}>
            <div className="yaku-title">
              <h3>{y.name}</h3>
              <span>
                {y.points}
                <small>文</small>
              </span>
            </div>
            <div className="yaku-example">
              {y.ids.map((id) => (
                <Card key={id} id={id} small />
              ))}
            </div>
            <p>{y.text}</p>
          </article>
        ))}
      </div>
      <div className="rule-note">
        <CircleHelp size={22} />
        <div>
          <h3>この館の取り決め</h3>
          <p>
            役の合計が7文以上で得点2倍。相手のこいこい後にあがるとさらに2倍。光役は最上位のみ採用し、両者の手札を使い切り、最後の手番で役の増点がなければ流局です。配札時の手四・くっつきは6文。こいこいの後は、役の点数が増えたときに再びあがれます。
          </p>
        </div>
      </div>
    </section>
  );
}
function Settings({
  sound,
  motion,
  setSound,
  setMotion,
  backend,
  session,
  editName,
}: {
  sound: boolean;
  motion: boolean;
  setSound: (v: boolean) => void;
  setMotion: (v: boolean) => void;
  backend: string;
  session: Session | null;
  editName: () => void;
}) {
  const { skin, setSkin } = useCardSkin();
  return (
    <section className="inner-page settings-page">
      <div className="eyebrow">MAKE YOURSELF AT HOME</div>
      <h1>お好みの、ひとときに。</h1>
      <p className="page-intro">音と光を整えて、あなたらしい一局を。</p>
      <div className="settings-card">
        <div className="setting-row">
          <Music2 />
          <div>
            <h3>効果音</h3>
            <p>札の音、和の響き、あがりの余韻。</p>
          </div>
          <button
            className={`toggle ${sound ? "on" : ""}`}
            role="switch"
            aria-checked={sound}
            aria-label="効果音"
            onClick={() => {
              setSound(!sound);
              if (!sound) {
                setMuted(false);
                playSound("capture");
              }
            }}
          >
            <span />
          </button>
        </div>
        <div className="setting-row">
          <Sparkles />
          <div>
            <h3>背景のアニメーション</h3>
            <p>花びらと光の立体演出。動きを控えたいときはオフに。</p>
          </div>
          <button
            className={`toggle ${motion ? "on" : ""}`}
            role="switch"
            aria-checked={motion}
            aria-label="アニメーション"
            onClick={() => setMotion(!motion)}
          >
            <span />
          </button>
        </div>
        <div className="setting-row">
          <Cpu />
          <div>
            <h3>グラフィックス</h3>
            <p>WebGPUを優先し、環境に合わせて描画方式を選択します。</p>
          </div>
          <span className="status-pill waiting">{backend}</span>
        </div>
        <div className="setting-row setting-row-skin">
          <Palette />
          <div>
            <h3>札の絵柄</h3>
            <p>リカラー版と原色版を、いつでも切り替えられます。</p>
          </div>
          <label className="setting-select-label">
            <span className="sr-only">札の絵柄</span>
            <select
              aria-label="札の絵柄"
              value={skin}
              onChange={(event) => setSkin(event.target.value as typeof skin)}
            >
              {CARD_SKIN_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="setting-row">
          <Users />
          <div>
            <h3>プレイヤー名</h3>
            <p>{session?.name || "未設定（初回対戦で自動作成）"}</p>
          </div>
          <button className="button secondary compact" onClick={editName}>
            変更する
          </button>
        </div>
      </div>
      <div className="selfhost-note">
        <ShieldCheck size={27} />
        <h3>あなたの場所で、あなたの遊びを。</h3>
        <p>
          花札館はセルフホストの花札サロン。
          <br />
          アカウント登録不要。対戦は、接続先のサーバーで進行します。
        </p>
      </div>
    </section>
  );
}
