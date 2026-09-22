use std::{
    collections::{HashMap, HashSet},
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use argon2::{
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
    password_hash::{SaltString, rand_core::OsRng},
};
use axum::{
    Json, Router,
    body::Body,
    extract::{
        ConnectInfo, DefaultBodyLimit, Path, Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, HeaderValue, Request, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::{Semaphore, mpsc};
use tower_http::{
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
};
use uuid::Uuid;

use crate::game::{Game, Phase, PublicGameEvent, Yaku};

const SESSION_TTL: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const ROOM_TTL: Duration = Duration::from_secs(6 * 60 * 60);
const MAX_ROOMS: usize = 256;
const MAX_SESSIONS: usize = 10_000;
const MAX_SPECTATORS: usize = 32;
const CPU_THINK_TIME: Duration = Duration::from_millis(1500);

#[derive(Clone)]
pub struct AppState {
    inner: Arc<Mutex<Store>>,
    hashing: Arc<Semaphore>,
}
impl Default for AppState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Store::default())),
            hashing: Arc::new(Semaphore::new(4)),
        }
    }
}
impl AppState {
    pub fn close_connections(&self) {
        let mut store = self.inner.lock().expect("store poisoned");
        for room in store.rooms.values_mut() {
            room.connections.clear();
        }
    }
}
#[derive(Default)]
struct Store {
    sessions: HashMap<String, Session>,
    rooms: HashMap<String, Room>,
    http_rates: HashMap<(IpAddr, &'static str), Rate>,
}
#[derive(Clone)]
struct Session {
    player_id: String,
    name: String,
    expires: Instant,
    password_attempts: Rate,
}
#[derive(Clone)]
struct Rate {
    since: Instant,
    count: u32,
}
impl Default for Rate {
    fn default() -> Self {
        Self {
            since: Instant::now(),
            count: 0,
        }
    }
}
impl Rate {
    fn allow(&mut self, max: u32, interval: Duration) -> bool {
        if self.since.elapsed() >= interval {
            self.since = Instant::now();
            self.count = 0;
        }
        if self.count >= max {
            return false;
        }
        self.count += 1;
        true
    }
}
#[derive(Clone)]
struct Player {
    id: String,
    name: String,
    is_cpu: bool,
}
struct Connection {
    player_id: String,
    tx: mpsc::Sender<Value>,
}
struct Room {
    id: String,
    name: String,
    host_id: String,
    password: Option<String>,
    mode: Mode,
    rounds: u8,
    players: Vec<Player>,
    spectators: HashSet<String>,
    departed: HashSet<String>,
    connections: HashMap<String, Connection>,
    game: Option<Game>,
    event_sequence: u64,
    messages: Vec<ChatMessage>,
    last_active: Instant,
    next_cpu: Instant,
}
#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Mode {
    Pvp,
    Cpu,
}
#[derive(Clone, Serialize)]
struct ChatMessage {
    id: String,
    name: String,
    text: String,
    system: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerView {
    id: String,
    name: String,
    score: u32,
    hand_count: usize,
    captured: Vec<u8>,
    connected: bool,
    is_cpu: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RoomSummary {
    id: String,
    name: String,
    locked: bool,
    mode: Mode,
    rounds: u8,
    players: usize,
    spectators: usize,
    status: &'static str,
    host_name: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RoomView {
    id: String,
    name: String,
    host_id: String,
    mode: Mode,
    rounds: u8,
    round: u8,
    status: &'static str,
    players: Vec<PlayerView>,
    my_index: Option<usize>,
    hand: Vec<u8>,
    field: Vec<u8>,
    deck_count: usize,
    turn: usize,
    dealer: usize,
    phase: &'static str,
    drawn_card: Option<u8>,
    yaku: [Vec<Yaku>; 2],
    koikoi: [u8; 2],
    winner: Option<usize>,
    match_winner: Option<usize>,
    round_points: u32,
    messages: Vec<ChatMessage>,
    log: Vec<String>,
    legal_targets: Vec<u8>,
    events: Vec<PublicGameEvent>,
    spectators: usize,
}
impl Room {
    fn start_game(&mut self) {
        let mut game = Game::new(self.rounds);
        game.set_event_sequence(self.event_sequence);
        self.game = Some(game);
    }
    fn status(&self) -> &'static str {
        match self.game.as_ref().map(|g| &g.phase) {
            None => "waiting",
            Some(Phase::Finished) => "finished",
            _ => "playing",
        }
    }
    fn member(&self, id: &str) -> bool {
        (self.players.iter().any(|p| p.id == id) && !self.departed.contains(id))
            || self.spectators.contains(id)
    }
    fn connected(&self, id: &str) -> bool {
        self.connections.values().any(|c| c.player_id == id)
    }
    fn summary(&self) -> RoomSummary {
        RoomSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            locked: self.password.is_some(),
            mode: self.mode,
            rounds: self.rounds,
            players: self
                .players
                .iter()
                .filter(|p| !self.departed.contains(&p.id))
                .count(),
            spectators: self.spectators.len(),
            status: self.status(),
            host_name: self
                .players
                .iter()
                .find(|p| p.id == self.host_id)
                .map(|p| p.name.clone())
                .unwrap_or_default(),
        }
    }
    fn view(&self, id: &str) -> RoomView {
        let mine = self
            .players
            .iter()
            .position(|p| p.id == id && !self.departed.contains(id));
        let game = self.game.as_ref();
        let players = self
            .players
            .iter()
            .enumerate()
            .map(|(i, p)| PlayerView {
                id: p.id.clone(),
                name: p.name.clone(),
                score: game.map_or(0, |g| g.scores[i]),
                hand_count: game.map_or(0, |g| g.hands[i].len()),
                captured: game.map_or_else(Vec::new, |g| g.captured[i].clone()),
                connected: p.is_cpu || self.connected(&p.id),
                is_cpu: p.is_cpu,
            })
            .collect();
        RoomView {
            id: self.id.clone(),
            name: self.name.clone(),
            host_id: self.host_id.clone(),
            mode: self.mode,
            rounds: self.rounds,
            round: game.map_or(0, |g| g.round),
            status: self.status(),
            players,
            my_index: mine,
            hand: game
                .and_then(|g| mine.map(|i| g.hands[i].clone()))
                .unwrap_or_default(),
            field: game.map_or_else(Vec::new, |g| g.field.clone()),
            deck_count: game.map_or(0, |g| g.deck.len()),
            turn: game.map_or(0, |g| g.turn),
            dealer: game.map_or(0, |g| g.dealer),
            phase: match game.map(|g| &g.phase) {
                None => "waiting",
                Some(Phase::Play) => "play",
                Some(Phase::DrawChoice) => "draw_choice",
                Some(Phase::Decision) => "decision",
                Some(Phase::RoundEnd) => "round_end",
                Some(Phase::Finished) => "finished",
            },
            drawn_card: game.and_then(|g| g.drawn_card),
            yaku: game.map_or_else(|| [vec![], vec![]], Game::yaku),
            koikoi: game.map_or([0, 0], |g| g.koikoi),
            winner: game.and_then(|g| g.winner),
            match_winner: game.and_then(Game::match_winner),
            round_points: game.map_or(0, |g| g.round_points),
            messages: self.messages.clone(),
            log: game.map_or_else(Vec::new, |g| g.log.clone()),
            legal_targets: game.map_or_else(Vec::new, Game::legal_targets),
            events: game.map_or_else(Vec::new, |g| g.events.clone()),
            spectators: self.spectators.len(),
        }
    }
    fn broadcast(&mut self) {
        let failed: Vec<String> = self
            .connections
            .iter()
            .filter_map(|(key, connection)| {
                let state = json!({"type":"state", "room":self.view(&connection.player_id)});
                connection.tx.try_send(state).err().map(|_| key.clone())
            })
            .collect();
        for key in failed {
            self.connections.remove(&key);
        }
    }
    fn add_message(&mut self, name: &str, text: &str, system: bool) {
        self.messages.push(ChatMessage {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            text: text.into(),
            system,
        });
        if self.messages.len() > 80 {
            self.messages.remove(0);
        }
    }
    fn leave(&mut self, player_id: &str) {
        if let Some(index) = self.players.iter().position(|p| p.id == player_id) {
            let name = self.players[index].name.clone();
            if let Some(game) = &mut self.game {
                if !matches!(game.phase, Phase::Finished) {
                    let _ = game.forfeit(index);
                }
                // Keep result indices stable until a rematch, but revoke the departed player's seat authorization.
                self.departed.insert(player_id.to_owned());
            } else {
                self.players.remove(index);
            }
            if self.host_id == player_id {
                self.host_id = self
                    .players
                    .iter()
                    .find(|p| !p.is_cpu && !self.departed.contains(&p.id))
                    .map(|p| p.id.clone())
                    .unwrap_or_default();
            }
            self.add_message("花札館", &format!("{name} さんが退室しました"), true);
        }
        self.spectators.remove(player_id);
        self.connections
            .retain(|_, connection| connection.player_id != player_id);
        self.last_active = Instant::now();
    }
}

#[derive(Debug)]
struct ApiError(StatusCode, String);
impl ApiError {
    fn bad(message: &str) -> Self {
        Self(StatusCode::BAD_REQUEST, message.into())
    }
    fn unauthorized() -> Self {
        Self(
            StatusCode::UNAUTHORIZED,
            "セッションが切れました。名前を入力し直してください".into(),
        )
    }
    fn missing() -> Self {
        Self(StatusCode::NOT_FOUND, "対戦部屋が見つかりません".into())
    }
    fn forbidden(message: &str) -> Self {
        Self(StatusCode::FORBIDDEN, message.into())
    }
    fn limited() -> Self {
        Self(
            StatusCode::TOO_MANY_REQUESTS,
            "操作が多すぎます。少し待ってからお試しください".into(),
        )
    }
    fn internal() -> Self {
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "処理に失敗しました".into(),
        )
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error":self.1}))).into_response()
    }
}
fn clean_text(raw: &str, min: usize, max: usize, field: &str) -> Result<String, ApiError> {
    let text = raw.trim();
    if text.chars().count() < min
        || text.chars().count() > max
        || text.chars().any(char::is_control)
    {
        return Err(ApiError::bad(&format!(
            "{field}は {min}〜{max} 文字で入力してください"
        )));
    }
    Ok(text.to_owned())
}
fn authenticate(store: &Store, headers: &HeaderMap) -> Result<Session, ApiError> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .ok_or_else(ApiError::unauthorized)?;
    session_for_token(store, token)
}
fn session_for_token(store: &Store, token: &str) -> Result<Session, ApiError> {
    store
        .sessions
        .get(token)
        .filter(|s| s.expires > Instant::now())
        .cloned()
        .ok_or_else(ApiError::unauthorized)
}

pub fn app(state: AppState, static_dir: &str) -> Router {
    let static_files = ServeDir::new(static_dir)
        .not_found_service(ServeFile::new(format!("{static_dir}/index.html")));
    Router::new()
        .route("/api/health", get(health))
        .route("/api/session", post(create_session))
        .route("/api/me", get(me))
        .route("/api/rooms", get(list_rooms).post(create_room))
        .route("/api/rooms/{id}/join", post(join_room))
        .route("/api/rooms/{id}/leave", post(leave_room))
        .route("/api/ws", get(upgrade))
        .route(
            "/api/{*path}",
            get(|| async {
                (
                    StatusCode::NOT_FOUND,
                    Json(json!({"error":"API not found"})),
                )
            }),
        )
        .fallback_service(static_files)
        .layer(DefaultBodyLimit::max(4096))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::REFERRER_POLICY,
            HeaderValue::from_static("same-origin"),
        ))
        .layer(middleware::from_fn_with_state(state.clone(), http_guard))
        .with_state(state)
}
async fn http_guard(State(state): State<AppState>, request: Request<Body>, next: Next) -> Response {
    // Exact host comparison also works behind a reverse proxy preserving Host. Native clients may omit Origin.
    if let Some(origin) = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
    {
        let authority = origin
            .strip_prefix("http://")
            .or_else(|| origin.strip_prefix("https://"))
            .filter(|v| !v.contains('/'));
        let host = request
            .headers()
            .get(header::HOST)
            .and_then(|value| value.to_str().ok());
        let allowed_origin = std::env::var("ALLOWED_ORIGIN").ok();
        if (authority.is_none() || authority != host) && allowed_origin.as_deref() != Some(origin) {
            return ApiError::forbidden("この接続元は許可されていません").into_response();
        }
    }
    if request.uri().path().starts_with("/api/") && request.uri().path() != "/api/health" {
        let (bucket, limit) = if request.uri().path() == "/api/session" {
            ("session", 30)
        } else if request.method() == axum::http::Method::GET && request.uri().path() != "/api/ws" {
            ("read", 1200)
        } else {
            ("write", 120)
        };
        let ip = request
            .extensions()
            .get::<ConnectInfo<SocketAddr>>()
            .map(|c| c.0.ip())
            .unwrap_or(IpAddr::from([127, 0, 0, 1]));
        let allowed = {
            let mut store = state.inner.lock().expect("store poisoned");
            if store.http_rates.len() > 20_000 {
                store
                    .http_rates
                    .retain(|_, rate| rate.since.elapsed() < Duration::from_secs(60));
            }
            store
                .http_rates
                .entry((ip, bucket))
                .or_default()
                .allow(limit, Duration::from_secs(60))
        };
        if !allowed {
            return ApiError::limited().into_response();
        }
    }
    next.run(request).await
}
async fn health() -> Json<Value> {
    Json(json!({"status":"ok", "service":"hanafudakan", "version":env!("CARGO_PKG_VERSION")}))
}
#[derive(Deserialize)]
struct SessionRequest {
    name: String,
}
async fn create_session(
    State(state): State<AppState>,
    Json(body): Json<SessionRequest>,
) -> Result<Json<Value>, ApiError> {
    let name = clean_text(&body.name, 1, 20, "お名前")?;
    let mut store = state.inner.lock().expect("store poisoned");
    store.sessions.retain(|_, s| s.expires > Instant::now());
    if store.sessions.len() >= MAX_SESSIONS {
        return Err(ApiError::limited());
    }
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let player_id = Uuid::new_v4().to_string();
    store.sessions.insert(
        token.clone(),
        Session {
            player_id: player_id.clone(),
            name: name.clone(),
            expires: Instant::now() + SESSION_TTL,
            password_attempts: Rate::default(),
        },
    );
    Ok(Json(
        json!({"token":token, "playerId":player_id, "name":name}),
    ))
}
async fn me(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, ApiError> {
    let store = state.inner.lock().expect("store poisoned");
    let session = authenticate(&store, &headers)?;
    Ok(Json(
        json!({"playerId":session.player_id,"name":session.name}),
    ))
}
async fn list_rooms(State(state): State<AppState>) -> Json<Value> {
    let store = state.inner.lock().expect("store poisoned");
    let mut rooms: Vec<_> = store
        .rooms
        .values()
        .filter(|r| !r.host_id.is_empty())
        .map(Room::summary)
        .collect();
    rooms.sort_by(|a, b| a.id.cmp(&b.id));
    Json(json!({"rooms":rooms}))
}
#[derive(Deserialize)]
struct RoomRequest {
    name: String,
    password: Option<String>,
    rounds: u8,
    mode: Mode,
}
async fn hash_password(state: &AppState, password: String) -> Result<String, ApiError> {
    let permit = state
        .hashing
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError::limited())?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let salt = SaltString::generate(&mut OsRng);
        Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map(|h| h.to_string())
            .map_err(|_| ApiError::internal())
    })
    .await
    .map_err(|_| ApiError::internal())?
}
async fn check_password(
    state: &AppState,
    password: String,
    hash: String,
) -> Result<bool, ApiError> {
    let permit = state
        .hashing
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError::limited())?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let parsed = PasswordHash::new(&hash).map_err(|_| ApiError::internal())?;
        Ok(Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok())
    })
    .await
    .map_err(|_| ApiError::internal())?
}
async fn create_room(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RoomRequest>,
) -> Result<Json<Value>, ApiError> {
    let name = clean_text(&body.name, 1, 40, "部屋名")?;
    if ![3, 6, 12].contains(&body.rounds) {
        return Err(ApiError::bad("対戦局数は 3・6・12 局から選んでください"));
    }
    let session = {
        let store = state.inner.lock().expect("store poisoned");
        authenticate(&store, &headers)?
    };
    let password = match body.password.filter(|p| !p.is_empty()) {
        Some(password) => {
            if password.chars().count() > 64 || password.chars().any(char::is_control) {
                return Err(ApiError::bad("合言葉は 64 文字以内で入力してください"));
            }
            Some(hash_password(&state, password).await?)
        }
        None => None,
    };
    let mut store = state.inner.lock().expect("store poisoned");
    if store.rooms.len() >= MAX_ROOMS
        || store
            .rooms
            .values()
            .filter(|r| r.host_id == session.player_id)
            .count()
            >= 5
    {
        return Err(ApiError::limited());
    }
    let id = Uuid::new_v4().simple().to_string()[..12].to_owned();
    let mut players = vec![Player {
        id: session.player_id.clone(),
        name: session.name.clone(),
        is_cpu: false,
    }];
    if body.mode == Mode::Cpu {
        players.push(Player {
            id: format!("cpu-{id}"),
            name: "花影 AI".into(),
            is_cpu: true,
        });
    }
    let mut room = Room {
        id: id.clone(),
        name,
        host_id: session.player_id,
        password,
        mode: body.mode,
        rounds: body.rounds,
        players,
        spectators: HashSet::new(),
        departed: HashSet::new(),
        connections: HashMap::new(),
        game: None,
        event_sequence: 0,
        messages: vec![],
        last_active: Instant::now(),
        next_cpu: Instant::now(),
    };
    room.add_message("花札館", "ようこそ。札に、想いをのせて。", true);
    store.rooms.insert(id.clone(), room);
    Ok(Json(json!({"roomId":id})))
}
#[derive(Deserialize, Default)]
struct JoinRequest {
    password: Option<String>,
    #[serde(default)]
    spectate: bool,
}
async fn join_room(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<JoinRequest>,
) -> Result<Json<Value>, ApiError> {
    let (session, hash, already_member) = {
        let mut store = state.inner.lock().expect("store poisoned");
        let session = authenticate(&store, &headers)?;
        let room = store.rooms.get(&id).ok_or_else(ApiError::missing)?;
        let hash = room.password.clone();
        let member = room.member(&session.player_id);
        if hash.is_some() && !member {
            let token = headers
                .get(header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                .ok_or_else(ApiError::unauthorized)?;
            if !store
                .sessions
                .get_mut(token)
                .ok_or_else(ApiError::unauthorized)?
                .password_attempts
                .allow(8, Duration::from_secs(60))
            {
                return Err(ApiError::limited());
            }
        }
        (session, hash, member)
    };
    if !already_member && let Some(hash) = hash {
        let password = body.password.unwrap_or_default();
        if password.chars().count() > 64 || !check_password(&state, password, hash).await? {
            return Err(ApiError::forbidden("合言葉が違います"));
        }
    }
    let mut store = state.inner.lock().expect("store poisoned");
    let room = store.rooms.get_mut(&id).ok_or_else(ApiError::missing)?;
    if room.member(&session.player_id) {
        return Ok(Json(json!({"roomId":id})));
    }
    if room.departed.contains(&session.player_id) && !body.spectate {
        room.departed.remove(&session.player_id);
        if room.host_id.is_empty() {
            room.host_id = session.player_id;
        }
        room.last_active = Instant::now();
        room.broadcast();
        return Ok(Json(json!({"roomId":id})));
    }
    if body.spectate {
        if room.spectators.len() >= MAX_SPECTATORS {
            return Err(ApiError::bad("観戦席が満席です"));
        }
        room.spectators.insert(session.player_id);
    } else {
        if room.players.len() >= 2 || room.game.is_some() {
            return Err(ApiError::bad("対戦席は満席です。観戦でお入りください"));
        }
        if room.host_id.is_empty() {
            room.host_id = session.player_id.clone();
        }
        room.players.push(Player {
            id: session.player_id,
            name: session.name.clone(),
            is_cpu: false,
        });
        room.add_message(
            "花札館",
            &format!("{} さんが入室しました", session.name),
            true,
        );
    }
    room.last_active = Instant::now();
    room.broadcast();
    Ok(Json(json!({"roomId":id})))
}

/// Explicit REST leave is also available while the WebSocket is disconnected.
/// Repeating the request is safe, including after an empty room was pruned.
async fn leave_room(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let mut store = state.inner.lock().expect("store poisoned");
    let session = authenticate(&store, &headers)?;
    if let Some(room) = store.rooms.get_mut(&id)
        && room.member(&session.player_id)
    {
        room.leave(&session.player_id);
        room.broadcast();
    }
    Ok(Json(json!({"roomId": id})))
}

#[derive(Deserialize)]
struct WsQuery {
    token: String,
    room: String,
}
async fn upgrade(
    State(state): State<AppState>,
    Query(query): Query<WsQuery>,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    let session = {
        let store = state.inner.lock().expect("store poisoned");
        let session = session_for_token(&store, &query.token)?;
        let room = store.rooms.get(&query.room).ok_or_else(ApiError::missing)?;
        if !room.member(&session.player_id) {
            return Err(ApiError::forbidden("先に部屋へ入室してください"));
        }
        if room
            .connections
            .values()
            .filter(|c| c.player_id == session.player_id)
            .count()
            >= 3
        {
            return Err(ApiError::limited());
        }
        session
    };
    Ok(ws
        .max_message_size(4096)
        .max_frame_size(4096)
        .on_upgrade(move |socket| socket_loop(socket, state, query.room, session))
        .into_response())
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Command {
    Start,
    Leave,
    Rematch,
    NextRound,
    Play {
        #[serde(rename = "cardId")]
        card_id: u8,
        #[serde(rename = "targetId")]
        target_id: Option<u8>,
    },
    Choose {
        #[serde(rename = "targetId")]
        target_id: u8,
    },
    Decision {
        koikoi: bool,
    },
    Chat {
        text: String,
    },
    Emote {
        emoji: String,
    },
}
fn apply_command(room: &mut Room, session: &Session, command: Command) -> Result<bool, String> {
    if !room.member(&session.player_id) {
        return Err("この部屋には参加していません".into());
    }
    if matches!(command, Command::Leave) {
        room.leave(&session.player_id);
        return Ok(true);
    }
    match command {
        Command::Chat { text } => {
            let text = clean_text(&text, 1, 240, "メッセージ").map_err(|e| e.1)?;
            room.add_message(&session.name, &text, false);
        }
        Command::Emote { emoji } => {
            if ![
                "🌸",
                "👏",
                "🔥",
                "✨",
                "🎴",
                "👍",
                "😮",
                "🍶",
                "🙏",
                "よろしく！",
                "ありがとう！",
                "お見事！",
            ]
            .contains(&emoji.as_str())
            {
                return Err("そのリアクションは送れません".into());
            }
            room.add_message(&session.name, &emoji, false);
        }
        other => {
            let index = room
                .players
                .iter()
                .position(|p| {
                    p.id == session.player_id && !room.departed.contains(&session.player_id)
                })
                .ok_or("観戦中は対局操作できません")?;
            match other {
                Command::Start => {
                    if room.host_id != session.player_id {
                        return Err("部屋主が対局を開始できます".into());
                    }
                    if room.game.is_some() {
                        return Err("対局はすでに始まっています".into());
                    }
                    if room.players.len() != 2
                        || room
                            .players
                            .iter()
                            .any(|p| !p.is_cpu && !room.connected(&p.id))
                    {
                        return Err("対戦相手の接続をお待ちください".into());
                    }
                    room.start_game();
                    room.add_message("花札館", "対局開始。よろしくお願いします！", true);
                }
                Command::Rematch => {
                    if room.host_id != session.player_id {
                        return Err("部屋主が再戦を開始できます".into());
                    }
                    if room
                        .game
                        .as_ref()
                        .is_none_or(|g| !matches!(g.phase, Phase::Finished))
                    {
                        return Err("対局終了後に再戦できます".into());
                    }
                    if !room.departed.is_empty() {
                        room.players.retain(|p| !room.departed.contains(&p.id));
                        room.departed.clear();
                        room.game = None;
                        room.add_message("花札館", "次の対戦相手をお待ちしています", true);
                        room.last_active = Instant::now();
                        return Ok(false);
                    }
                    if room.players.len() != 2
                        || room
                            .players
                            .iter()
                            .any(|p| !p.is_cpu && !room.connected(&p.id))
                    {
                        return Err("再戦には両者の接続が必要です".into());
                    }
                    room.start_game();
                    room.add_message("花札館", "新たな対局を始めます", true);
                }
                Command::NextRound => {
                    if room.host_id != session.player_id {
                        return Err("部屋主が次の局へ進めます".into());
                    }
                    room.game
                        .as_mut()
                        .ok_or("対局が始まっていません")?
                        .next_round()?;
                }
                Command::Play { card_id, target_id } => {
                    room.game
                        .as_mut()
                        .ok_or("対局が始まっていません")?
                        .play(index, card_id, target_id)?;
                }
                Command::Choose { target_id } => {
                    room.game
                        .as_mut()
                        .ok_or("対局が始まっていません")?
                        .choose(index, target_id)?;
                }
                Command::Decision { koikoi } => {
                    room.game
                        .as_mut()
                        .ok_or("対局が始まっていません")?
                        .decision(index, koikoi)?;
                }
                _ => unreachable!("message and leave handled above"),
            }
            room.event_sequence = room
                .game
                .as_ref()
                .map_or(room.event_sequence, Game::event_sequence);
            room.next_cpu = Instant::now() + CPU_THINK_TIME;
        }
    }
    room.last_active = Instant::now();
    Ok(false)
}
async fn socket_loop(socket: WebSocket, state: AppState, room_id: String, session: Session) {
    let (tx, mut rx) = mpsc::channel::<Value>(32);
    let connection_id = Uuid::new_v4().to_string();
    {
        let mut store = state.inner.lock().expect("store poisoned");
        let Some(room) = store.rooms.get_mut(&room_id) else {
            return;
        };
        // Membership can change after the HTTP handshake while an earlier socket is leaving.
        if !room.member(&session.player_id)
            || room
                .connections
                .values()
                .filter(|c| c.player_id == session.player_id)
                .count()
                >= 3
        {
            return;
        }
        room.connections.insert(
            connection_id.clone(),
            Connection {
                player_id: session.player_id.clone(),
                tx,
            },
        );
        room.last_active = Instant::now();
        room.broadcast();
    }
    let (mut sender, mut receiver) = socket.split();
    let mut rate = Rate::default();
    let mut chat_rate = Rate::default();
    let mut heartbeat = tokio::time::interval(Duration::from_secs(20));
    let mut last_seen = Instant::now();
    loop {
        tokio::select! {
            output = rx.recv() => {
                let Some(output) = output else { break; };
                if !matches!(tokio::time::timeout(Duration::from_secs(5), sender.send(Message::Text(output.to_string().into()))).await, Ok(Ok(()))) { break; }
            },
            incoming = receiver.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        last_seen = Instant::now();
                        let parsed = if !rate.allow(30, Duration::from_secs(10)) {
                            Err("操作が多すぎます。少し待ってください".to_owned())
                        } else {
                            serde_json::from_str::<Command>(&text).map_err(|_| "操作の形式が正しくありません".to_owned())
                        };
                        let result = match parsed {
                            Ok(command) => {
                                if matches!(command, Command::Chat {..} | Command::Emote {..}) && !chat_rate.allow(8, Duration::from_secs(10)) {
                                    Err("メッセージは少し間をあけてお送りください".into())
                                } else {
                                    let mut store = state.inner.lock().expect("store poisoned");
                                    if let Some(room) = store.rooms.get_mut(&room_id) {
                                        let result = apply_command(room, &session, command);
                                        if result.is_ok() { room.broadcast(); }
                                        result
                                    } else { Err("対戦部屋が終了しました".into()) }
                                }
                            },
                            Err(message) => Err(message),
                        };
                        match result {
                            Ok(true) => { let _ = sender.send(Message::Text(json!({"type":"left"}).to_string().into())).await; break; },
                            Ok(false) => {},
                            Err(message) => { if sender.send(Message::Text(json!({"type":"error","message":message}).to_string().into())).await.is_err() { break; } },
                        }
                    },
                    Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => { last_seen = Instant::now(); },
                    Some(Ok(Message::Binary(_))) => { break; },
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => { break; },
                }
            },
            _ = heartbeat.tick() => {
                if last_seen.elapsed() > Duration::from_secs(65) || session.expires <= Instant::now() { break; }
                if sender.send(Message::Ping(Vec::new().into())).await.is_err() { break; }
            },
        }
    }
    {
        let mut store = state.inner.lock().expect("store poisoned");
        if let Some(room) = store.rooms.get_mut(&room_id) {
            room.connections.remove(&connection_id);
            // Last activity is recorded on disconnect to reserve the seat for reconnection.
            room.last_active = Instant::now();
            room.broadcast();
        }
    }
}

pub async fn maintenance(state: AppState) {
    let mut tick = tokio::time::interval(Duration::from_millis(200));
    loop {
        tick.tick().await;
        let mut store = state.inner.lock().expect("store poisoned");
        store.sessions.retain(|_, s| s.expires > Instant::now());
        store.rooms.retain(|_, room| {
            !room.host_id.is_empty()
                && (!room.connections.is_empty() || room.last_active.elapsed() < ROOM_TTL)
        });
        for room in store.rooms.values_mut() {
            if room.connections.is_empty() || room.next_cpu > Instant::now() {
                continue;
            }
            let cpu_turn = room.game.as_ref().is_some_and(|game| {
                matches!(
                    game.phase,
                    Phase::Play | Phase::DrawChoice | Phase::Decision
                ) && room.players.get(game.turn).is_some_and(|p| p.is_cpu)
            });
            if cpu_turn {
                if let Some(game) = &mut room.game {
                    game.cpu_action();
                    room.event_sequence = game.event_sequence();
                }
                room.next_cpu = Instant::now() + CPU_THINK_TIME;
                room.last_active = Instant::now();
                room.broadcast();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use tower::ServiceExt;

    async fn request(
        app: Router,
        method: &str,
        path: &str,
        token: Option<&str>,
        body: Value,
    ) -> (StatusCode, Value) {
        let mut builder = Request::builder()
            .method(method)
            .uri(path)
            .header("Content-Type", "application/json");
        if let Some(token) = token {
            builder = builder.header("Authorization", format!("Bearer {token}"));
        }
        let response = app
            .oneshot(builder.body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 8192).await.unwrap();
        let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, value)
    }
    async fn session(app: &Router, name: &str) -> String {
        let (status, response) = request(
            app.clone(),
            "POST",
            "/api/session",
            None,
            json!({"name":name}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        response["token"].as_str().unwrap().to_owned()
    }
    #[tokio::test]
    async fn sessions_validate_identity_and_room_authentication() {
        let router = app(AppState::default(), "/nonexistent");
        assert_eq!(
            request(
                router.clone(),
                "POST",
                "/api/session",
                None,
                json!({"name":"  "})
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
        let token = session(&router, "桜").await;
        let (_, me) = request(router.clone(), "GET", "/api/me", Some(&token), Value::Null).await;
        assert_eq!(me["name"], "桜");
        assert_eq!(
            request(
                router.clone(),
                "POST",
                "/api/rooms",
                None,
                json!({"name":"花見","rounds":3,"mode":"cpu"})
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            request(
                router,
                "POST",
                "/api/rooms",
                Some(&token),
                json!({"name":"花見","rounds":9,"mode":"cpu"})
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }
    #[tokio::test]
    async fn locked_rooms_protect_players_and_spectators_and_limit_seats() {
        let state = AppState::default();
        let router = app(state.clone(), "/nonexistent");
        let host = session(&router, "主").await;
        let guest = session(&router, "客").await;
        let watcher = session(&router, "観戦").await;
        let (_, room) = request(
            router.clone(),
            "POST",
            "/api/rooms",
            Some(&host),
            json!({"name":"秘密の間","password":"桜月夜","rounds":6,"mode":"pvp"}),
        )
        .await;
        let id = room["roomId"].as_str().unwrap();
        let path = format!("/api/rooms/{id}/join");
        assert_eq!(
            request(
                router.clone(),
                "POST",
                &path,
                Some(&guest),
                json!({"password":"wrong"})
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            request(
                router.clone(),
                "POST",
                &path,
                Some(&watcher),
                json!({"spectate":true})
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            request(
                router.clone(),
                "POST",
                &path,
                Some(&guest),
                json!({"password":"桜月夜"})
            )
            .await
            .0,
            StatusCode::OK
        );
        assert_eq!(
            request(
                router.clone(),
                "POST",
                &path,
                Some(&watcher),
                json!({"password":"桜月夜"})
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            request(
                router.clone(),
                "POST",
                &path,
                Some(&watcher),
                json!({"password":"桜月夜","spectate":true})
            )
            .await
            .0,
            StatusCode::OK
        );
        let (_, listed) = request(router, "GET", "/api/rooms", None, Value::Null).await;
        assert_eq!(listed["rooms"][0]["players"], 2);
        assert_eq!(listed["rooms"][0]["spectators"], 1);
        assert_eq!(listed["rooms"][0]["locked"], true);
        assert!(!listed.to_string().contains("桜月夜"));
        let store = state.inner.lock().unwrap();
        assert!(
            store.rooms[id]
                .password
                .as_ref()
                .unwrap()
                .starts_with("$argon2id$")
        );
    }
    #[tokio::test]
    async fn state_keeps_opponent_hand_and_deck_secret() {
        let state = AppState::default();
        let router = app(state.clone(), "/nonexistent");
        let host = session(&router, "主").await;
        let (_, created) = request(
            router,
            "POST",
            "/api/rooms",
            Some(&host),
            json!({"name":"CPU","rounds":3,"mode":"cpu"}),
        )
        .await;
        let mut store = state.inner.lock().unwrap();
        let player = store.sessions[&host].player_id.clone();
        let room = store
            .rooms
            .get_mut(created["roomId"].as_str().unwrap())
            .unwrap();
        room.game = Some(Game::new(3));
        let mine = room.view(&player);
        let spectator = room.view("spectator");
        assert_eq!(mine.hand.len(), 8);
        assert!(spectator.hand.is_empty());
        assert_eq!(spectator.my_index, None);
        let serialized = serde_json::to_value(mine).unwrap();
        assert!(serialized.get("deck").is_none());
        assert!(serialized["players"][1].get("hand").is_none());
        assert_eq!(serialized["players"][1]["handCount"], 8);
    }
    #[tokio::test]
    async fn spectator_cannot_start_and_wrong_origin_is_rejected() {
        let state = AppState::default();
        let router = app(state.clone(), "/nonexistent");
        let host = session(&router, "主").await;
        let guest = session(&router, "観戦者").await;
        let (_, created) = request(
            router.clone(),
            "POST",
            "/api/rooms",
            Some(&host),
            json!({"name":"CPU","rounds":3,"mode":"cpu"}),
        )
        .await;
        let id = created["roomId"].as_str().unwrap();
        request(
            router.clone(),
            "POST",
            &format!("/api/rooms/{id}/join"),
            Some(&guest),
            json!({"spectate":true}),
        )
        .await;
        {
            let mut store = state.inner.lock().unwrap();
            let session = store.sessions[&guest].clone();
            assert!(
                apply_command(store.rooms.get_mut(id).unwrap(), &session, Command::Start).is_err()
            );
        }
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .header("Host", "localhost:3000")
                    .header("Origin", "https://evil.test")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
    #[test]
    fn rates_reject_burst_and_expiry_is_enforced() {
        let mut rate = Rate::default();
        assert!(rate.allow(2, Duration::from_secs(60)));
        assert!(rate.allow(2, Duration::from_secs(60)));
        assert!(!rate.allow(2, Duration::from_secs(60)));
        let mut store = Store::default();
        store.sessions.insert(
            "expired".into(),
            Session {
                player_id: "old".into(),
                name: "Old".into(),
                expires: Instant::now() - Duration::from_secs(1),
                password_attempts: Rate::default(),
            },
        );
        assert!(session_for_token(&store, "expired").is_err());
    }
    type TestSocket = tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >;
    async fn socket_message(socket: &mut TestSocket, expected: &str) -> Value {
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let message = socket.next().await.unwrap().unwrap();
                if let tokio_tungstenite::tungstenite::Message::Text(text) = message {
                    let value: Value = serde_json::from_str(&text).unwrap();
                    if value["type"] == expected {
                        return value;
                    }
                }
            }
        })
        .await
        .expect("websocket message timed out")
    }
    async fn socket_command(socket: &mut TestSocket, command: Value) {
        socket
            .send(tokio_tungstenite::tungstenite::Message::Text(
                command.to_string().into(),
            ))
            .await
            .unwrap();
    }
    #[tokio::test]
    async fn websockets_enforce_membership_turns_and_private_views() {
        let state = AppState::default();
        let router = app(state.clone(), "/nonexistent");
        let host = session(&router, "親").await;
        let guest = session(&router, "子").await;
        let outsider = session(&router, "外").await;
        let (_, created) = request(
            router.clone(),
            "POST",
            "/api/rooms",
            Some(&host),
            json!({"name":"socket test","rounds":3,"mode":"pvp"}),
        )
        .await;
        let id = created["roomId"].as_str().unwrap().to_owned();
        request(
            router.clone(),
            "POST",
            &format!("/api/rooms/{id}/join"),
            Some(&guest),
            json!({}),
        )
        .await;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let url = |token: &str| format!("ws://{address}/api/ws?token={token}&room={id}");
        assert!(
            tokio_tungstenite::connect_async(url(&outsider))
                .await
                .is_err()
        );
        let (mut host_socket, _) = tokio_tungstenite::connect_async(url(&host)).await.unwrap();
        socket_message(&mut host_socket, "state").await;
        let (mut guest_socket, _) = tokio_tungstenite::connect_async(url(&guest)).await.unwrap();
        socket_message(&mut guest_socket, "state").await;
        socket_command(&mut guest_socket, json!({"type":"start"})).await;
        assert!(
            socket_message(&mut guest_socket, "error").await["message"]
                .as_str()
                .unwrap()
                .contains("部屋主")
        );
        socket_command(&mut host_socket, json!({"type":"start"})).await;
        // Drain preceding connection status until the started state arrives.
        let started = loop {
            let msg = socket_message(&mut host_socket, "state").await;
            if msg["room"]["phase"] != "waiting" {
                break msg;
            }
        };
        assert_eq!(started["room"]["hand"].as_array().unwrap().len(), 8);
        assert_eq!(started["room"]["myIndex"], 0);
        let opponent = socket_message(&mut guest_socket, "state").await;
        assert_eq!(opponent["room"]["myIndex"], 1);
        assert_ne!(opponent["room"]["hand"], started["room"]["hand"]);
        assert!(opponent["room"]["players"][0].get("hand").is_none());
        socket_command(&mut guest_socket, json!({"type":"play","cardId":255})).await;
        socket_message(&mut guest_socket, "error").await;
        socket_command(&mut guest_socket, json!({"type":"chat","text":"よろしく"})).await;
        let chat = socket_message(&mut guest_socket, "state").await;
        assert_eq!(
            chat["room"]["messages"].as_array().unwrap().last().unwrap()["text"],
            "よろしく"
        );
        socket_command(&mut guest_socket, json!({"type":"leave"})).await;
        socket_message(&mut guest_socket, "left").await;
        let finished = socket_message(&mut host_socket, "state").await;
        // There may be an unread chat broadcast before the forfeit broadcast.
        let finished = if finished["room"]["phase"] == "finished" {
            finished
        } else {
            socket_message(&mut host_socket, "state").await
        };
        assert_eq!(finished["room"]["phase"], "finished");
        assert_eq!(finished["room"]["matchWinner"], 0);
        server.abort();
    }
    #[tokio::test]
    async fn maintenance_drives_cpu_and_prunes_disconnected_rooms() {
        let state = AppState::default();
        let router = app(state.clone(), "/nonexistent");
        let host = session(&router, "CPU test").await;
        let (_, created) = request(
            router,
            "POST",
            "/api/rooms",
            Some(&host),
            json!({"name":"CPU","rounds":3,"mode":"cpu"}),
        )
        .await;
        let id = created["roomId"].as_str().unwrap().to_owned();
        let (tx, mut rx) = mpsc::channel(32);
        {
            let mut store = state.inner.lock().unwrap();
            let player = store.sessions[&host].player_id.clone();
            let room = store.rooms.get_mut(&id).unwrap();
            let mut game = Game::new(3);
            while game.phase != Phase::Play {
                game = Game::new(3);
            }
            game.turn = 1;
            room.game = Some(game);
            room.connections.insert(
                "test".into(),
                Connection {
                    player_id: player,
                    tx,
                },
            );
        }
        let task = tokio::spawn(maintenance(state.clone()));
        let view = tokio::time::timeout(Duration::from_secs(3), rx.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(view["room"]["players"][1]["handCount"], 7);
        {
            let mut store = state.inner.lock().unwrap();
            let room = store.rooms.get_mut(&id).unwrap();
            room.connections.clear();
            room.last_active = Instant::now() - ROOM_TTL - Duration::from_secs(1);
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
        assert!(!state.inner.lock().unwrap().rooms.contains_key(&id));
        task.abort();
    }
    #[tokio::test]
    async fn explicit_leave_revokes_seat_and_host_can_reopen_for_another_player() {
        let state = AppState::default();
        let router = app(state.clone(), "/nonexistent");
        let host = session(&router, "親").await;
        let guest = session(&router, "子").await;
        let newcomer = session(&router, "次の客").await;
        let (_, created) = request(
            router.clone(),
            "POST",
            "/api/rooms",
            Some(&host),
            json!({"name":"継続","rounds":3,"mode":"pvp"}),
        )
        .await;
        let id = created["roomId"].as_str().unwrap();
        let join_path = format!("/api/rooms/{id}/join");
        request(router.clone(), "POST", &join_path, Some(&guest), json!({})).await;
        {
            let mut store = state.inner.lock().unwrap();
            let host_session = store.sessions[&host].clone();
            let guest_session = store.sessions[&guest].clone();
            let room = store.rooms.get_mut(id).unwrap();
            room.game = Some(Game::new(3));
            assert!(
                apply_command(room, &guest_session, Command::NextRound)
                    .unwrap_err()
                    .contains("部屋主")
            );
            assert!(
                apply_command(room, &guest_session, Command::Rematch)
                    .unwrap_err()
                    .contains("部屋主")
            );
            assert!(apply_command(room, &guest_session, Command::Leave).unwrap());
            assert!(!room.member(&guest_session.player_id));
            assert_eq!(room.view(&guest_session.player_id).my_index, None);
            assert_eq!(room.summary().players, 1);
            assert_eq!(room.game.as_ref().unwrap().match_winner(), Some(0));
            // The former player may return as spectator but cannot operate their old seat.
            room.spectators.insert(guest_session.player_id.clone());
            assert!(
                apply_command(
                    room,
                    &guest_session,
                    Command::Play {
                        card_id: 0,
                        target_id: None
                    }
                )
                .unwrap_err()
                .contains("観戦")
            );
            assert!(!apply_command(room, &host_session, Command::Rematch).unwrap());
            assert_eq!(room.status(), "waiting");
            assert_eq!(room.players.len(), 1);
        }
        assert_eq!(
            request(router, "POST", &join_path, Some(&newcomer), json!({}))
                .await
                .0,
            StatusCode::OK
        );
    }
    #[tokio::test]
    async fn leaving_cpu_room_releases_host_quota_immediately() {
        let state = AppState::default();
        let router = app(state.clone(), "/nonexistent");
        let host = session(&router, "親").await;
        let (_, created) = request(
            router,
            "POST",
            "/api/rooms",
            Some(&host),
            json!({"name":"CPU","rounds":3,"mode":"cpu"}),
        )
        .await;
        let mut store = state.inner.lock().unwrap();
        let host_session = store.sessions[&host].clone();
        let room = store
            .rooms
            .get_mut(created["roomId"].as_str().unwrap())
            .unwrap();
        room.game = Some(Game::new(3));
        apply_command(room, &host_session, Command::Leave).unwrap();
        assert!(room.host_id.is_empty());
        assert!(!room.member(&host_session.player_id));
    }
    #[tokio::test]
    async fn rest_leave_works_disconnected_and_is_authenticated_and_idempotent() {
        let state = AppState::default();
        let router = app(state.clone(), "/nonexistent");
        let host = session(&router, "親").await;
        let guest = session(&router, "子").await;
        let outsider = session(&router, "外").await;
        let (_, created) = request(
            router.clone(),
            "POST",
            "/api/rooms",
            Some(&host),
            json!({"name":"再接続","rounds":3,"mode":"pvp"}),
        )
        .await;
        let id = created["roomId"].as_str().unwrap();
        let path = format!("/api/rooms/{id}/leave");
        request(
            router.clone(),
            "POST",
            &format!("/api/rooms/{id}/join"),
            Some(&guest),
            json!({}),
        )
        .await;
        {
            let mut store = state.inner.lock().unwrap();
            let room = store.rooms.get_mut(id).unwrap();
            room.start_game();
            assert!(room.connections.is_empty());
        }
        assert_eq!(
            request(router.clone(), "POST", &path, None, json!({}))
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            request(router.clone(), "POST", &path, Some(&outsider), json!({}))
                .await
                .0,
            StatusCode::OK
        );
        let (status, result) =
            request(router.clone(), "POST", &path, Some(&guest), json!({})).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(result["roomId"], id);
        let message_count = {
            let store = state.inner.lock().unwrap();
            let room = &store.rooms[id];
            assert!(!room.member(&store.sessions[&guest].player_id));
            assert!(room.member(&store.sessions[&host].player_id));
            assert_eq!(room.game.as_ref().unwrap().match_winner(), Some(0));
            room.messages.len()
        };
        assert_eq!(
            request(router.clone(), "POST", &path, Some(&guest), json!({}))
                .await
                .0,
            StatusCode::OK
        );
        assert_eq!(
            state.inner.lock().unwrap().rooms[id].messages.len(),
            message_count
        );
        assert_eq!(
            request(
                router,
                "POST",
                "/api/rooms/missing/leave",
                Some(&guest),
                json!({})
            )
            .await
            .0,
            StatusCode::OK
        );
    }
    #[tokio::test]
    async fn public_events_show_revealed_cards_only_and_rematch_preserves_sequence() {
        let state = AppState::default();
        let router = app(state.clone(), "/nonexistent");
        let host = session(&router, "親").await;
        let (_, created) = request(
            router,
            "POST",
            "/api/rooms",
            Some(&host),
            json!({"name":"演出","rounds":3,"mode":"cpu"}),
        )
        .await;
        let mut store = state.inner.lock().unwrap();
        let player_id = store.sessions[&host].player_id.clone();
        let room = store
            .rooms
            .get_mut(created["roomId"].as_str().unwrap())
            .unwrap();
        room.start_game();
        let game = room.game.as_mut().unwrap();
        game.phase = Phase::Play;
        game.hands = [vec![0, 12], vec![20, 24]];
        game.field = vec![1, 5, 8, 16];
        game.deck = vec![44, 4];
        game.play(0, 0, Some(1)).unwrap();
        room.event_sequence = game.event_sequence();
        let events = &room.view("spectator").events;
        assert_eq!(events.len(), 2);
        assert_eq!(
            serde_json::to_value(events).unwrap(),
            serde_json::to_value(room.view(&player_id).events).unwrap()
        );
        for event in events {
            let mut public_cards = vec![event.card_id];
            public_cards.extend(&event.target_ids);
            public_cards.extend(&event.field);
            public_cards.extend(event.captured_cards.iter().flatten());
            assert!(
                public_cards
                    .iter()
                    .all(|card| ![12, 20, 24, 44].contains(card))
            );
        }
        assert!(room.view("spectator").hand.is_empty());
        let previous_id = events.last().unwrap().id;
        room.start_game();
        while room.game.as_ref().unwrap().phase != Phase::Play {
            room.start_game();
        }
        let game = room.game.as_mut().unwrap();
        assert!(game.events.is_empty());
        game.cpu_action();
        assert!(game.events[0].id > previous_id);
    }
    #[tokio::test]
    async fn prayer_emote_is_allowed_and_game_actions_reserve_animation_time() {
        let state = AppState::default();
        let router = app(state.clone(), "/nonexistent");
        let host = session(&router, "親").await;
        let (_, created) = request(
            router,
            "POST",
            "/api/rooms",
            Some(&host),
            json!({"name":"間合い","rounds":3,"mode":"cpu"}),
        )
        .await;
        let mut store = state.inner.lock().unwrap();
        let session = store.sessions[&host].clone();
        let room = store
            .rooms
            .get_mut(created["roomId"].as_str().unwrap())
            .unwrap();
        let (tx, _rx) = mpsc::channel(32);
        room.connections.insert(
            "test".into(),
            Connection {
                player_id: session.player_id.clone(),
                tx,
            },
        );
        apply_command(
            room,
            &session,
            Command::Emote {
                emoji: "🙏".into()
            },
        )
        .unwrap();
        assert_eq!(room.messages.last().unwrap().text, "🙏");
        let before = Instant::now();
        apply_command(room, &session, Command::Start).unwrap();
        assert!(room.next_cpu >= before + CPU_THINK_TIME);
        assert_eq!(CPU_THINK_TIME, Duration::from_millis(1500));
    }
}
