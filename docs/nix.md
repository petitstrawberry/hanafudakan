# Nix ビルドと開発環境

花札館ではローカル開発、リリースビルド、Docker のビルドに同じ `flake.nix` を使います。Linux / macOS の x86_64・aarch64 を対象にしています。

## 初期設定

Nix を導入済みの環境で、flakes と nix-command を有効にしてください。未設定ならコマンドに以下を付けられます。

```sh
nix --extra-experimental-features 'nix-command flakes' develop
```

継続して使う場合は、ユーザーの Nix 設定に `experimental-features = nix-command flakes` を指定します。Nix 自体のインストールはプロジェクトのスクリプトからは行いません。

Git チェックアウトでは、Nix が参照するファイルは Git で追跡されている必要があります。新しく作ったソースや lock ファイルは `git add` してからビルドします。コミットは不要です。`target`、`node_modules`、`dist`、`result` はビルド入力に含めません。

## 主なコマンド

| コマンド | 内容 |
| --- | --- |
| `nix develop` | Rust・Cargo・rustfmt・Clippy・Node.js・npm の開発シェル |
| `nix build .` | サーバーと Web をまとめた実行パッケージを `result` に出力 |
| `nix run .` | 統合パッケージをビルドして起動 |
| `nix build .#server` | Rust サーバー単体。静的ファイルの場所は別途指定 |
| `nix build .#client` | Web の静的ファイルを `result` 直下に出力 |
| `nix build .#container` | Docker 用の実行パッケージ・curl・CA 証明書 |
| `nix flake check` | 現在のプラットフォームでサーバーのテストと Web の型検査・ビルド |
| `nix fmt flake.nix` | flake の整形 |

`nix build` はソースツリーの `node_modules` を使わず、依存を Nix で取得してサンドボックス内でビルドします。開発シェルで Vite を使う場合は、初回に `cd client && npm ci` を実行してください。

## 固定されるもの

- `flake.lock`: nixpkgs のリビジョンとハッシュ。Rust・Node.js・ビルドツールを固定します。
- `Cargo.lock`: Rust 依存のバージョンとチェックサム。`buildRustPackage` の `cargoLock` から利用します。
- `client/package-lock.json`: npm 依存のバージョンと integrity。`importNpmLock` が個別アーカイブのハッシュを使います。
- `Dockerfile`: Nix ビルダーイメージをマルチプラットフォームの digest で固定します。

依存ハッシュの仮値は使用していません。npm 依存の更新時も、集約ハッシュを手計算する必要はありません。

## 更新

ツールチェーンを更新する場合:

```sh
nix flake update nixpkgs
nix flake check
```

Rust / npm 依存を更新する場合は `nix develop` 内で各パッケージマネージャーを使い、更新した lock ファイルも Git に追加して `nix flake check` で確認します。

Docker も新しい lock に揃えるには `docker compose up -d --build` を実行します。再起動によりメモリ上の対戦データが消えるため、対戦終了後に更新してください。

Docker のビルドでは、アーキテクチャごとの BuildKit キャッシュに Nix store を保持して依存関係を再利用します。キャッシュがなくてもビルドできます。最終イメージには実行時に必要な store の内容だけが入ります。
