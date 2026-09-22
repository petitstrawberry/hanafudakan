# 花札館 — HANAFUDAKAN

Rust サーバーと Web クライアントで動く、セルフホスト型の花札「こいこい」対戦サービスです。複数の対戦部屋、パスワード付きの入室、人との対戦と CPU 対戦を備えます。WebGPU の花びら・光・粒子と、48 枚の札、Web Audio の効果音で対戦を彩ります。描画と音声をゲームロジックから分離し、将来のネイティブアプリでも同じサーバーを利用できる構成です。

札画像と日本語フォントを同梱し、外部 CDN の素材参照を必要としません。WebGPU 非対応環境では WebGL2、さらに CSS の背景へフォールバックします。

対局中は双方の取り札を「光・たね・短冊・かす」に分類し、それぞれの札の下に役候補を表示します。あと 1 枚で揃う役は色で強調し、成立できなくなった役は取り消し線で示します。役を押すと必要な札や理由を確認できます。取れる手札・場札のハイライトと、札を重ねて取り込む演出も備えます。新しく揃った役は役名と札を大きく表示し、複数役は順番に演出します。

横長の画面では取り札を盤面の左右、縦長の画面では上下へ自動配置します。会話は対局画面のボタンから開けます。

## すぐ起動する

Nix の flakes と nix-command を有効にし、リポジトリのルートで実行します。

```sh
nix run .
```

Rust サーバーと Web クライアントを同じ flake でビルドして起動します。`http://localhost:3000` を開いて表示名を登録し、CPU 対戦または対戦部屋の作成へ進みます。人と対戦するときは、もう 1 人が同じサーバーにアクセスして部屋に参加します。

Docker Engine と Compose v2 でも起動できます。Dockerfile 内も Nix を使い、同じ flake から実行用イメージを作ります。

```sh
cp .env.example .env
docker compose up -d --build
```

部屋・セッション・進行中の対戦はメモリ上に保持され、サーバーの再起動で消えます。公開設定と HTTPS の例は [セルフホスト手順](docs/self-hosting.md) を参照してください。

手元の PC を一時的な HTTPS URL で共有する場合は `./scripts/share.sh start`、公開状態の確認は `./scripts/share.sh status`、停止は `./scripts/share.sh stop` です。Nix でビルドした専用サーバーを Cloudflare Quick Tunnel で公開します。公開中の画面だけを更新する場合は `./scripts/share.sh refresh-ui` を使うと、部屋と対戦を保持したまま新しい画面へ切り替えられます。

## 開発

`nix develop` が Rust・Cargo・Node.js・npm・テストランナーの tsx を揃えます。

```sh
nix develop
cd client
npm ci
cd ..
./scripts/dev.sh
```

開発画面は `http://localhost:5173` です。終了は `Ctrl+C`。スクリプトはサーバーをビルドしてから両方を起動します。Rust を変更した場合は再起動してください。

個別に起動する場合は、2 つのターミナルでそれぞれ `nix develop` に入ってから次を実行します。

```sh
# ターミナル 1: Rust サーバー
cargo run -p hanafudakan-server
```

```sh
# ターミナル 2: Web クライアント
cd client
npm run dev
```

Vite が API と WebSocket を Rust のポート 3000 にプロキシします。

## ビルドと検証

```sh
# Web クライアント込みの実行パッケージ
nix build .
./result/bin/hanafudakan-server

# サーバーと役表示のテスト、Web クライアントの型検査・ビルド
nix flake check

# 開発シェル内で個別に確認
nix develop
cargo test --locked
cargo clippy --all-targets -- -D warnings
cd client
npm test
npm run build
```

`flake.lock` でツールチェーン、`Cargo.lock` と `client/package-lock.json` で依存関係を固定します。[Nix の構成と更新手順](docs/nix.md)も参照してください。

[GitHub Actions](.github/workflows/ci.yml) では Linux x86_64 上で `nix flake check` と `nix build .` を実行します。役の成立可能性を扱うクライアントのロジックテストも `nix flake check` に含まれ、手元では次のコマンドで個別に実行できます。テストランナーも `flake.lock` の nixpkgs に固定します。

```sh
nix develop --command npm --prefix client test
```

## ドキュメント

- [セルフホスト・環境変数・HTTPS](docs/self-hosting.md)
- [サーバーとクライアントの構成](docs/architecture.md)
- [Nix ビルド・開発環境](docs/nix.md)
- [REST / WebSocket API](docs/api.md)
- [採用しているこいこいのルール](docs/rules.md)

この実装ではゲストセッションを使用します。アカウント登録、永続的な戦績、複数サーバーへの分散は含まれません。
