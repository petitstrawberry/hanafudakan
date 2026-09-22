# セルフホスト

## Nix で起動

flakes と nix-command を有効にした Nix で、リポジトリのルートから実行します。

```sh
nix build .
BIND_ADDR=127.0.0.1:3000 RUST_LOG=info ./result/bin/hanafudakan-server
```

`nix run .` でもビルドと起動をまとめて実行できます。Nix パッケージはビルド済み Web クライアントのパスをラッパーで設定するため、どの作業ディレクトリからでも起動できます。サーバーの既定の待受アドレスは `0.0.0.0:3000` です。ホスト内だけで使う場合は上の例のように `BIND_ADDR` を設定します。

## Docker Compose

リポジトリのルートで実行します。Docker Engine と Compose v2 が必要です。

```sh
cp .env.example .env
docker compose up -d --build
docker compose ps
```

ブラウザで `http://localhost:3000` を開きます。`.env` の `HANAFUDA_PORT` でホスト側のポートを変更できます。初期設定はホストのループバックだけに公開します。LAN へ公開する場合は `HANAFUDA_HOST=0.0.0.0` に変更し、再度 `docker compose up -d` を実行します。

```sh
docker compose logs -f --tail=100
curl --fail http://localhost:3000/api/health
docker compose down
```

コンテナは非 root ユーザーで起動し、Compose ではファイルシステムを読み取り専用にしています。ゲーム状態を保存するボリュームはありません。再起動や更新で、進行中の対戦・部屋・セッションが消えます。対戦が終わったタイミングで更新してください。

Dockerfile も `nix build .#container` を実行します。`flake.lock`、`package-lock.json`、`Cargo.lock` に従ってビルドし、実行時に必要な Nix store の依存関係だけを `scratch` イメージへコピーします。最終イメージに Nix デーモンや開発ツールは含めません。

## HTTPS とリバースプロキシ

別の端末から WebGPU を使うには、ブラウザが安全なコンテキストと判断する HTTPS が必要です。`localhost` での開発は例外です。GPU やブラウザが WebGPU に対応しない場合は WebGL2、GPU 初期化もできない場合は CSS の背景にフォールバックします。対戦操作はそのまま利用できます。

インターネットへ公開する場合は、ドメインと TLS を設定したリバースプロキシを配置してください。以下は同じホストで Caddy を実行する例です。ドメインは自分のものに置き換え、DNS をサーバーへ向けます。

```caddyfile
hanafuda.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy は WebSocket のアップグレードも処理します。プロキシも別のコンテナで動かす場合、`127.0.0.1` はプロキシ自身を指します。同じ Docker ネットワーク上から `hanafudakan:3000` に接続するよう構成してください。

WebSocket 接続 URL にはセッショントークンを含むため、アクセスログにクエリ文字列を残さない設定にしてください。ゲストの表示名や部屋のパスワードはサービス全体のユーザー認証にはなりません。利用者を限定したい場合は、VPN やプロキシ側の認証を組み合わせてください。

## 手元の PC を一時的に公開

Nix が使える環境では、同梱のスクリプトで Cloudflare Quick Tunnel の HTTPS URL を発行できます。

```sh
./scripts/share.sh start
./scripts/share.sh status
./scripts/share.sh stop
```

`start` は同じ flake の実行パッケージと cloudflared を Nix で準備し、専用サーバーを `127.0.0.1:3100` に起動します。表示された URL を他のプレイヤーに共有してください。公開プロセスはバックグラウンドで動くため、終了するときは `stop` を実行します。開発用の Vite とポート 3000 のサーバーは停止しません。

ポートを変更する場合は `HANAFUDA_SHARE_PORT=3200 ./scripts/share.sh start` のように指定します。URL・ログ・プロセス情報は `artifacts/share` に保存します。PC のスリープやネットワーク切断で公開できなくなる場合があり、作り直すと URL が変わります。継続して公開する場合は、上記の固定ドメインとリバースプロキシの構成を使用してください。

## 環境変数と運用上限

systemd 等で常駐化する場合は、`nix build` の出力を保持し、その `bin/hanafudakan-server` を実行します。Nix パッケージのラッパーが静的ファイルのパスを設定します。開発時に `cargo run` で直接起動する場合だけ、作業ディレクトリをリポジトリのルートにするか `STATIC_DIR` を指定してください。

| 環境変数 | 既定値 | 用途 |
| --- | --- | --- |
| `BIND_ADDR` | `0.0.0.0:3000` | Rust サーバーの待受アドレス |
| `STATIC_DIR` | Nix パッケージでは Nix store 内。Cargo 直接起動では `client/dist` | Web クライアントのビルド出力 |
| `RUST_LOG` | `info` | ログ出力レベル |
| `ALLOWED_ORIGIN` | 未設定 | Origin と Host が一致しない構成で許可する単一の Origin。例: `https://hanafuda.example.com` |
| `HANAFUDA_HOST` | `127.0.0.1` | Compose のホスト側公開アドレス |
| `HANAFUDA_PORT` | `3000` | Compose のホスト側公開ポート |

`.env` は Compose が読み込みます。Rust バイナリを直接起動する場合は、環境変数をシェルやプロセスマネージャーで設定してください。

全体で 256 部屋、ゲストセッション 10,000 件、1 人につき作成した部屋 5 つ、1 部屋につき観戦者 32 人が上限です。ゲストセッションは 7 日、全員切断後の部屋は最終活動から 6 時間で期限切れになります。

HTTP の制限は接続元 IP ごとに、読み取り 1,200 回/分、変更操作と WebSocket 接続 120 回/分、セッション新規作成 30 回/分です。ヘルスチェックは対象外です。転送ヘッダーの IP を自動で信頼しないため、リバースプロキシ越しの利用者はプロキシの IP による制限を共有します。大人数へ公開するときは、この制限を含めて構成を調整してください。

## 問題が起きたとき

- ページが表示されない: `client/dist/index.html` が存在することと `STATIC_DIR` を確認します。
- 開発画面で接続できない: Rust がポート 3000 で起動しているかを確認します。Vite のプロキシ先も同じポートが必要です。
- WebGPU が使えない: HTTPS または localhost で開き、ブラウザ・GPU ドライバーを確認します。
- リバースプロキシ越しに対戦だけ接続できない: WebSocket のアップグレードとタイムアウトの設定を確認します。
- 再起動後に部屋がない: 現状の状態保存はメモリ上のみです。新しいセッションで部屋を作り直します。
