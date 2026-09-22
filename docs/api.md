# REST / WebSocket API

ゲームサーバーは JSON を使用します。Web クライアントとサーバーは同じオリジンで配信できます。ネイティブクライアントも同じ API を使用できます。現状の API はバージョン付きの公開互換契約ではないため、クライアントとサーバーを同じリリースに揃えてください。

## REST

リクエストボディは `Content-Type: application/json`。認証が必要なリクエストには、セッション発行で取得したトークンを付けます。

```http
Authorization: Bearer <token>
```

| メソッド・パス | 認証 | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `GET /api/health` | 不要 | なし | `{status, service, version}` |
| `POST /api/session` | 不要 | `{name}` | `{token, playerId, name}` |
| `GET /api/me` | 必要 | なし | `{playerId, name}` |
| `GET /api/rooms` | 不要 | なし | `{rooms: RoomSummary[]}` |
| `POST /api/rooms` | 必要 | `{name, mode, rounds, password?}` | `{roomId}` |
| `POST /api/rooms/{id}/join` | 必要 | `{password?, spectate?}` | `{roomId}` |
| `POST /api/rooms/{id}/leave` | 必要 | なし | `{roomId}` |

`name` はセッションでは 1〜20 文字、部屋では 1〜40 文字です。前後の空白は除き、制御文字は拒否します。`mode` は `"pvp"` または `"cpu"`、`rounds` は `3`・`6`・`12` です。`password` は省略・空文字で公開部屋、指定時は最大 64 文字です。サーバーには Argon2 のハッシュを保持します。

部屋作成者は自動で対戦席に入ります。CPU 部屋ではもう一方の席に CPU が入ります。参加者は `join` を呼び出してから WebSocket に接続します。`spectate: true` で観戦席へ入れます。パスワード付きの部屋は観戦にもパスワードが必要です。既に所属しているプレイヤーの再入室では再認証しません。

REST の `leave` は WebSocket が切れていても退室でき、対局中なら投了します。既に退室済み・部屋が消えている場合も成功を返すため、退室の再試行に使えます。セッションの認証自体は必要です。

```json
{
  "id": "example-room",
  "name": "月見の間",
  "locked": true,
  "mode": "pvp",
  "rounds": 6,
  "players": 2,
  "spectators": 1,
  "status": "playing",
  "hostName": "花子"
}
```

上記は `RoomSummary` の例です。`status` は `waiting` / `playing` / `finished` です。パスワードの平文やハッシュはレスポンスに含めません。

アプリケーションエラーは適切な HTTP ステータスと `{ "error": "説明" }` を返します。JSON が壊れている等のフレームワークの入力エラーは、この形式にならない場合があります。認証切れは `401`、権限不足・パスワード不一致は `403`、部屋が存在しない場合は `404`、制限超過は `429` です。

## WebSocket

```text
ws://localhost:3000/api/ws?token=<URLエンコードしたtoken>&room=<roomId>
wss://your-domain.example/api/ws?token=<URLエンコードしたtoken>&room=<roomId>
```

トークンと部屋の所属を接続時に検証します。REST と同じくブラウザの Origin を検証するため、通常は同じオリジンで配信してください。ネイティブクライアントでは Origin ヘッダーを省略できます。TLS 環境では `wss://` を使用し、URL のトークンをログに記録しないでください。

接続直後、およびゲームやチャットの更新時に、その接続者向けの状態が届きます。

```json
{ "type": "state", "room": {} }
```

`room` は以下の `RoomView` です。差分ではなく完全なスナップショットなので、受信した状態で画面の状態を置き換えられます。

| フィールド | 内容 |
| --- | --- |
| `id`, `name`, `hostId`, `mode`, `rounds` | 部屋情報 |
| `round` | 現在の局数。開始前は `0` |
| `status` | `waiting` / `playing` / `finished` |
| `players` | 席順のプレイヤー配列。`id`, `name`, `score`, `handCount`, `captured`, `connected`, `isCpu` |
| `myIndex` | 自分の席 `0` / `1`。観戦者は `null` |
| `hand` | 自分の手札 ID。観戦者は空配列 |
| `field` | 場札 ID |
| `deckCount` | 山札の残り枚数 |
| `turn`, `dealer` | 手番と親の席番号 |
| `phase` | `waiting` / `play` / `draw_choice` / `decision` / `round_end` / `finished` |
| `drawnCard` | 選択待ちでめくった札 ID。通常は `null` |
| `legalTargets` | 山札の選択待ちで取れる場札 ID。その他は空配列 |
| `yaku` | 席ごとの `[{name, points}]` |
| `koikoi` | 席ごとのこいこい回数 |
| `winner` | その局の勝者の席。未確定・流局は `null` |
| `matchWinner` | 対戦全体の勝者の席。未終了・引き分けは `null` |
| `roundPoints` | その局で獲得した文 |
| `messages` | `[{id, name, text, system}]` のチャット履歴 |
| `log` | ゲーム進行ログの文字列配列 |
| `events` | 直近 12 件の公開された札移動イベント。下記参照 |
| `spectators` | 観戦人数 |

対戦相手の手札 ID と山札の内容は送信しません。`captured` の取り札は公開情報です。待機中は `players` が 1 人の場合もあります。ゲーム中は `status` と `phase` の両方を見て操作 UI を切り替えます。

### 札移動イベント

`events` を使うと、手札を出す・山札をめくる・取り札へ移す動きを順番に演出できます。各要素の形式は次のとおりです。

```json
{
  "id": 21,
  "player": 0,
  "source": "hand",
  "cardId": 0,
  "targetIds": [1],
  "captured": true,
  "field": [5, 8],
  "capturedCards": [[0, 1], []],
  "deckCount": 24,
  "requiresChoice": false
}
```

`source` は `hand` / `draw` / `choice`。`field`、`capturedCards`、`deckCount` は、その動きの直後の公開状態です。`requiresChoice` が `true` の山札は、相手の場札を選ぶまで待ちます。イベントにも非公開の手札や山札の中身は含めません。

イベント ID は部屋の存続中は単調に増加します。次の局・再戦で一覧を空にしますが、ID は引き継ぎます。クライアントは処理済み ID を記録し、差分だけを演出してください。初回接続・再接続時は過去の演出を再生せず、最新の部屋スナップショットに同期できます。ゲームの正しい状態は常に `room` 全体です。

## クライアントからのコマンド

各コマンドを JSON テキストフレームとして送信します。

| コマンド | JSON の例 | 用途 |
| --- | --- | --- |
| 開始 | `{"type":"start"}` | 部屋主が、両者接続後に対戦を開始 |
| 手札を出す | `{"type":"play","cardId":0,"targetId":1}` | 出す手札と、必要なら取る場札を指定 |
| 山札の相手を選ぶ | `{"type":"choose","targetId":2}` | `draw_choice` で場札を指定 |
| こいこい | `{"type":"decision","koikoi":true}` | 対局を続ける |
| 勝負 | `{"type":"decision","koikoi":false}` | 得点を確定 |
| 次の局 | `{"type":"next_round"}` | 部屋主が、局終了後に次へ進む |
| 再戦 | `{"type":"rematch"}` | 部屋主が、対戦終了後に新しい対戦を開始。相手が退室済みなら席を再募集 |
| チャット | `{"type":"chat","text":"よろしくお願いします！"}` | 部屋へメッセージを送る |
| リアクション | `{"type":"emote","emoji":"🌸"}` | 絵文字リアクションを送る |
| 退室 | `{"type":"leave"}` | 部屋から退出。対局中は投了 |

`play` で同じ月の場札が 2 枚ある場合は `targetId` が必須です。候補が 1 枚または 3 枚の場合は省略できます。一致する場札がなければ `targetId` を送らず、場に札を置きます。

権限・手番・フェーズ・札をサーバーが検証します。不正な操作ではゲーム状態を変えず、次の形式を返します。

```json
{ "type": "error", "message": "説明" }
```

退室の完了は `{ "type": "left" }` で通知したあと接続を閉じます。観戦者はチャット・リアクション・退室だけを操作できます。チャットは 1〜240 文字です。リアクションは `🌸`、`👏`、`🔥`、`✨`、`🎴`、`👍`、`😮`、`🍶`、`🙏`、`よろしく！`、`ありがとう！`、`お見事！` に対応します。

## 接続と制限

サーバーは 20 秒おきに WebSocket Ping を送り、65 秒間応答がない接続を終了します。ブラウザは Pong を自動で返します。ネイティブクライアントでも使用する WebSocket ライブラリの Ping / Pong 対応を確認してください。

一時的な切断では席を維持します。同じトークンと部屋 ID で再接続すると、最新のスナップショットを受け取れます。`leave` は明示的な退室なので席の権限を失い、対局中なら投了になります。

1 人につき 1 部屋で同時に最大 3 接続、コマンドは 10 秒あたり 30 件、チャットとリアクションは合計 10 秒あたり 8 件までです。テキストメッセージは 4 KiB まで、バイナリフレームには対応しません。チャットとゲームログはそれぞれ直近 80 件です。HTTP と部屋の上限は [セルフホスト](self-hosting.md) を参照してください。

## 札 ID

48 枚の札は `0`〜`47` の整数 ID です。月は `Math.floor(id / 4) + 1`、月内の種類は `id % 4` で表します。

| 月 | `+0` | `+1` | `+2` | `+3` |
| --- | --- | --- | --- | --- |
| 1 月 / 松 / ID 0〜3 | 鶴 | 赤短 | カス | カス |
| 2 月 / 梅 / ID 4〜7 | 鶯 | 赤短 | カス | カス |
| 3 月 / 桜 / ID 8〜11 | 幕 | 赤短 | カス | カス |
| 4 月 / 藤 / ID 12〜15 | 不如帰 | 短冊 | カス | カス |
| 5 月 / 菖蒲 / ID 16〜19 | 八橋 | 短冊 | カス | カス |
| 6 月 / 牡丹 / ID 20〜23 | 蝶 | 青短 | カス | カス |
| 7 月 / 萩 / ID 24〜27 | 猪 | 短冊 | カス | カス |
| 8 月 / 芒 / ID 28〜31 | 月 | 雁 | カス | カス |
| 9 月 / 菊 / ID 32〜35 | 盃 | 青短 | カス | カス |
| 10 月 / 紅葉 / ID 36〜39 | 鹿 | 青短 | カス | カス |
| 11 月 / 柳 / ID 40〜43 | 小野道風 | 燕 | 短冊 | カス |
| 12 月 / 桐 / ID 44〜47 | 鳳凰 | カス | カス | カス |
