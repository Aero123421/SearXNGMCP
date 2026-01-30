# SearXNG MCP（HTTP / Streamable MCP）

SearXNG を「候補取得（検索エンジン集約）」として使い、**MCP Gateway 側で重複排除・再ランキング・（必要なら）本文取得**まで行う、HTTP公開の Web検索 MCP サーバです。  
CLI系AIエージェント（Codex CLI / Claude Code / Gemini CLI など）から **HTTPで直に叩ける MCP** を想定しています。

このリポジトリは「まずローカルで評価 → チューニング → OCI Always Free（ARM）に載せる」流れを前提に、SearXNG の docker compose も同梱しています。

クライアント設定ガイド（Codex CLI / Claude Code / Gemini CLI / OpenCode）: `docs/clients/README.md`

次に読む: [目次](#目次) / [クイックスタート](#クイックスタートdocker--ローカル評価)

---

## 目次

- [全体像（アーキテクチャ）](#全体像アーキテクチャ)
- [できること](#できること)
- [クイックスタート（Docker / ローカル評価）](#クイックスタートdocker--ローカル評価)
- [環境変数（.env）](#環境変数env)
- [OCI Always Free（ARM）にデプロイ](#oci-always-freearmにデプロイ)
- [Cloudflare 公開（推奨手順）](#cloudflare-公開推奨手順)
- [ツール仕様（どう使うか）](#ツール仕様どう使うか)
- [検索品質のチューニング（本番デプロイ不要）](#検索品質のチューニング本番デプロイ不要)
- [rendered fetch（agent-browser）について](#rendered-fetchagent-browserについて)
- [評価（検索タスクをまとめて流す）](#評価検索タスクをまとめて流す)
- [テスト](#テスト)
- [トラブルシューティング](#トラブルシューティング)
- [開発（ローカル）](#開発ローカル)

次に読む: [全体像（アーキテクチャ）](#全体像アーキテクチャ) / [クイックスタート](#クイックスタートdocker--ローカル評価)

---

## 全体像（アーキテクチャ）

推奨構成（本番）:

1. クライアント（各CLI AI Agent）
2. Cloudflare Access（Service Token 等で認証）
3. Cloudflare Tunnel（OCIのインバウンド開放を不要に）
4. MCP Gateway（本リポジトリの Node/TS サーバ）
5. SearXNG（候補取得） + Valkey（SearXNG側キャッシュ等）
6. （任意）`agent-browser`（ヘッドレスレンダリングで本文抽出を補強）

MCP Gateway は以下を担当します:

- `Authorization: Bearer <API_KEY>` 認証（環境ごとにキー発行）
- レート制限（分/日、トークン単位）
- SSRF対策付き `sxng_web_fetch`（デフォルト。ツール名は prefix で変更可）
- SearXNG結果の整形（URL正規化/重複排除）と再ランキング
- `mode=balanced/high` で上位結果を本文取得して、**スニペット品質を改善**

次に読む: [できること](#できること) / [クイックスタート](#クイックスタートdocker--ローカル評価) / [Cloudflare 公開](#cloudflare-公開推奨手順)（推奨構成）

---

## できること

- MCP Streamable HTTP（`POST/GET/DELETE /mcp`）で公開
- ツール:
  - `sxng_web_search`（`fast|balanced|high`）
  - `sxng_web_image_search`
  - `sxng_web_research`（複数クエリで深掘り、要約はしない＝証拠を返す）
  - `sxng_web_fetch`（`http|rendered|auto`）
- セキュリティ:
  - Bearer token 認証（必須）
  - レート制限（必須）
  - SSRF対策（ローカル/プライベート/メタデータIP拒否、非標準ポート拒否）
- 品質:
  - `lang=auto`（簡易判定で ja/en を選ぶ）
  - intent判定（tech/hardware/history/images/general）でドメインブースト
  - 追加で `include_domains` / `exclude_domains` なども指定可能

次に読む: [クイックスタート](#クイックスタートdocker--ローカル評価) / [ツール仕様](#ツール仕様どう使うか)

---

## クイックスタート（Docker / ローカル評価）

前提:

- Docker Desktop（または Docker Engine）
- Node.js（評価スクリプト `npm run eval` を回す場合）

起動:

```bash
cp .env.example .env
# 重要: .env の API_KEYS と SEARXNG_SECRET を必ず変更
docker compose up -d --build
```

ローカルURL:

- MCP endpoint: `http://127.0.0.1:8787/mcp`
- SearXNG: `http://127.0.0.1:8080`
- healthcheck: `http://127.0.0.1:8787/healthz`

Cloudflare Tunnel（任意）:

```bash
# .env に CLOUDFLARE_TUNNEL_TOKEN が必要
docker compose --profile tunnel up -d
```

次に読む: [環境変数](#環境変数env) / [評価](#評価検索タスクをまとめて流す) / [OCIデプロイ](#oci-always-freearmにデプロイ)

---

## 環境変数（.env）

代表的なものだけ抜粋（全量は `.env.example` を参照）:

- `API_KEYS`: Bearer token をカンマ区切りで複数設定可（例: `key-dev,key-ci,key-prod`）
- `SEARXNG_BASE_URL`: SearXNG のURL（composeなら `http://searxng:8080`）
- `TOOL_PREFIX`: ツール名のプレフィックス（デフォルト `sxng` → `sxng_web_search` など）
- `ENABLE_LEGACY_TOOL_NAMES`: `true` で `web_search` 等の旧名も併設（混同しやすいので非推奨）
- `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_PER_DAY`: トークン単位の制限
- `FETCH_TIMEOUT_MS`, `FETCH_MAX_BYTES`, `FETCH_MAX_CHARS`: `sxng_web_fetch` の防御的制限
- `ENABLE_RENDERED_FETCH`: `true` で `mode=rendered/auto` を有効化
- `MCP_DOCKERFILE`: `Dockerfile`（通常）/ `Dockerfile.rendered`（Chromium同梱）

本番向けに最低限ちゃんと決めるもの:

- `API_KEYS`: 長いランダム文字列（複数環境ならキーを分ける）
- `SEARXNG_SECRET`: 長いランダム文字列
- `CLOUDFLARE_TUNNEL_TOKEN`: Tunnel を使う場合

次に読む: [OCIデプロイ](#oci-always-freearmにデプロイ) / [Cloudflare 公開](#cloudflare-公開推奨手順) / [ツール仕様](#ツール仕様どう使うか)

---

## OCI Always Free（ARM）にデプロイ

前提:

- OCI の Always Free で ARM（Ampere）インスタンスを用意済み
- OS は Ubuntu / Oracle Linux どちらでもOK（以下は Ubuntu 例）
- セキュリティ的には **MCP をインターネットに直公開しない**（Cloudflare Tunnel 経由）運用を推奨

### 1) OCI 側（インスタンス作成/ネットワーク）

- インスタンス作成:
  - Shape: ARM（A1）系
  - OS: Ubuntu 推奨（手順が短い）
  - Public IP: あり（SSH用。公開を最小化するなら固定IPよりも Access/Tunnel を優先）
  - SSH鍵: 手元の公開鍵を登録
- ネットワーク（重要）:
  - インバウンドは **22/tcp（SSH）のみ** を開ける運用を推奨
  - `8787`（MCP）や `8080`（SearXNG）は **開けない**
  - 可能なら 22/tcp も自宅/作業IPに制限

### 2) OCI で Docker / docker compose を入れる（Ubuntu）

OCI に SSH で入って実行します。

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin git
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

※ `usermod` 反映のため、いったんログアウト→ログインし直してください。

Oracle Linux などで手順が合わない場合（汎用 / 便利スクリプト）:

```bash
sudo dnf install -y git || true
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
docker compose version
```

### 3) デプロイ（git clone → .env → docker compose up）

```bash
git clone https://github.com/Aero123421/SearXNGMCP.git
cd SearXNGMCP
cp .env.example .env
```

`.env` を編集（最低限これだけ）:

- `API_KEYS`: 強いランダム文字列（カンマ区切りで複数可）
- `SEARXNG_SECRET`: 強いランダム文字列
- `CLOUDFLARE_TUNNEL_TOKEN`: Tunnel を使うなら設定

ランダム生成例（どれか1つでOK）:

```bash
openssl rand -hex 32
python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
```

※ `openssl` が無ければ `sudo apt-get install -y openssl`。

起動:

```bash
docker compose up -d --build
# Tunnel も同じホストで動かす場合（推奨）
docker compose --profile tunnel up -d
```

確認:

```bash
docker compose ps
docker compose logs --tail 100 mcp
docker compose logs --tail 100 searxng
curl -fsS http://127.0.0.1:8787/healthz
```

### 4) 更新（pull → up -d --build）

```bash
cd SearXNGMCP
git pull
docker compose up -d --build
```

SearXNG 設定を変えたら:

```bash
docker compose restart searxng
```

ディスクが厳しい場合（任意）:

```bash
docker image prune -f
```

### 5) rendered を OCI で使う場合の注意（任意）

ARM Always Free はリソースが限られることが多く、Chromium 同梱は重くなりがちです。

- まずは `ENABLE_RENDERED_FETCH=false`（デフォルト）で運用
- 必要になったら `MCP_DOCKERFILE=Dockerfile.rendered` + `ENABLE_RENDERED_FETCH=true` を検討
- OOM が出るなら swap の追加を検討（OCI/OSの推奨に従ってください）

次に読む: [Cloudflare 公開](#cloudflare-公開推奨手順) / [ツール仕様](#ツール仕様どう使うか) / [評価](#評価検索タスクをまとめて流す)

---

## Cloudflare 公開（推奨手順）

目的:

- OCIのインバウンドを開けずに公開（Tunnel）
- 先に Cloudflare Access で認証（Service Token / JWT）
- さらに MCP 側の `Authorization: Bearer` でも認証（二重化）

流れ（概要）:

1) Cloudflare 側で Tunnel 作成 → token 発行  
2) `.env` に `CLOUDFLARE_TUNNEL_TOKEN` を設定  
3) OCI 側で `docker compose --profile tunnel up -d`  
4) Access で Service Token 必須にする（環境ごとに発行）  

Public Hostname（ルーティング）の設定（例）:

- Hostname: `mcp.example.com`
- Service: `http://mcp:8787`
- Path: `/mcp`（任意。MCP Gateway は `MCP_PATH` で変更可能）

クライアント側は最終的に、以下へ接続するイメージです:

- MCP URL: `https://mcp.example.com/mcp`
- 追加ヘッダ:
  - `Authorization: Bearer <API_KEY>`（本サーバの認証）
  - `CF-Access-Client-Id: <id>` / `CF-Access-Client-Secret: <secret>`（Cloudflare Access の Service Token 認証）

※ 現状、MCP Gateway は「Cloudflare Access のJWT検証」までは実装していません（Cloudflare側でブロックする前提）。必要なら origin 側で `Cf-Access-Jwt-Assertion` を検証する実装も追加できます。

次に読む: [ツール仕様](#ツール仕様どう使うか) / [OCIデプロイ](#oci-always-freearmにデプロイ) / [環境変数](#環境変数env)

---

## ツール仕様（どう使うか）

このサーバは MCP の `tools/call` で使われます（クライアントは MCP SDK 等で接続）。

### `sxng_web_search`（デフォルト）

他のMCPやクライアント内蔵ツールと `web_search` / `web_fetch` が衝突・混同しやすいので、**デフォルトで `sxng_` プレフィックス**を付けています。
必要なら `.env` の `TOOL_PREFIX` を変更してください。

用途: まず「それっぽいURLを集める」＋必要なら「上位の本文で検証してスニペット改善」

- `mode=fast`: SearXNG結果のみ（最速・最安）
- `mode=balanced`: 上位1件を `sxng_web_fetch(mode=http)` で本文取得して品質を少し上げる
- `mode=high`: 上位3件を `sxng_web_fetch(mode=auto)`（HTTP→必要ならrendered）で検証して品質を上げる（重い）

よく使う引数:

- `query`（必須）: 検索クエリ
- `limit`（任意）: 1〜50（デフォルト10）
- `lang`（任意）: `ja` / `en` / `auto` など
- `safe`（任意）: `off|moderate|strict`
- `categories` / `time_range` / `engines`（任意）: SearXNGに透過
- `tech_bias`（任意）: 技術ドメイン優先を強める
- `include_domains` / `exclude_domains`（任意）: ドメインで絞る

返り値:

- `structuredContent.results[]`: `{ title, url, snippet, source, score, domain }`
- `structuredContent.nextCursor`: 次ページ用カーソル

### `sxng_web_image_search`（デフォルト）

用途: 画像検索（SearXNG categories=images）

- `structuredContent.results[]`: `{ title, pageUrl, imageUrl, thumbnailUrl, width, height, source }`

### `sxng_web_fetch`（デフォルト）

用途: URLの本文抽出（Readability）

- `mode=http`: 通常HTTPで取得して抽出（軽い）
- `mode=rendered`: ヘッドレスで描画後に抽出（重い / JS必須サイト向け）
- `mode=auto`: まずHTTP、本文が薄い場合だけ rendered にフォールバック

セキュリティ上の制約（重要）:

- ローカル/プライベートIP/メタデータIPへのアクセスを拒否（SSRF対策）
- 非標準ポートを拒否
- `FETCH_MAX_BYTES` / `FETCH_TIMEOUT_MS` などで防御的に制限

### `sxng_web_research`（デフォルト）

用途: 「質問」を複数クエリに分解して検索→結果を集約（**要約はしない**）

- `maxQueries`: 生成する検索クエリ数（例: 3）
- `perQueryLimit`: 各クエリの取得件数（例: 5）
- `fetchTopK`: 上位K件だけ本文も取る（0なら取らない）
- `fetchMode`: `http|rendered|auto`

次に読む: [検索品質チューニング](#検索品質のチューニング本番デプロイ不要) / [rendered fetch](#rendered-fetchagent-browserについて) / [評価](#評価検索タスクをまとめて流す)

---

## 検索品質のチューニング（本番デプロイ不要）

このプロジェクトは SearXNG の設定も同梱しているので、ローカルで回しながら調整できます。

1) `searxng/settings.template.yml` を編集  
2) `docker compose restart searxng`  
3) `npm run eval` を回して結果を見る

起動時に `searxng/settings.runtime.yml` を生成して `.env` の `SEARXNG_SECRET` を注入します（git には含めません）。

補足:

- SearXNG 側の `server.limiter` は `false` にしています（ヘッダ無し環境で 429 になりやすい）。レート制御は **MCP Gateway側 + Cloudflare** で実施してください。
- SearXNG はエンジンによっては起動時に「このエンジンは無効化した」系のログが出ることがあります（致命ではない場合があります）。

次に読む: [評価](#評価検索タスクをまとめて流す) / [ツール仕様](#ツール仕様どう使うか)

---

## rendered fetch（agent-browser）について

`agent-browser` は **Vercel Labs の `agent-browser` CLI** を想定しています。

結論: **重たい** です。

- Chromium（+依存）を含むため、イメージサイズ/起動時間/CPU/RAM が増えます
- 1リクエスト数秒になりがちで、毎回 rendered は現実的に厳しいです
- 推奨運用: 通常は `http`、必要な時だけ `auto`/`rendered`

有効化（Docker）:

```bash
# .env
MCP_DOCKERFILE=Dockerfile.rendered
ENABLE_RENDERED_FETCH=true

docker compose up -d --build
```

次に読む: [ツール仕様](#ツール仕様どう使うか) / [評価](#評価検索タスクをまとめて流す) / [トラブルシューティング](#トラブルシューティング)

## 開発（ローカル）

```bash
API_KEYS=dev SEARXNG_BASE_URL=http://127.0.0.1:8080 npm run dev
```

次に読む: [テスト](#テスト) / [ツール仕様](#ツール仕様どう使うか)

---

## テスト

```bash
npm test
npm run typecheck
```

次に読む: [評価](#評価検索タスクをまとめて流す) / [トラブルシューティング](#トラブルシューティング)

---

## 評価（検索タスクをまとめて流す）

`docs/eval/tasks.json` に、SWE/ハードウェア/日常/歴史/多言語/画像/深掘り のタスク例があります。  
デプロイ済み（またはローカル）の MCP に対して一括実行します。

```bash
API_KEY=... MCP_URL=http://127.0.0.1:8787/mcp npm run eval
```

出力は `docs/eval/out.json` に保存されます（`docs/eval/tasks.json` を編集して拡張可能）。

次に読む: [検索品質チューニング](#検索品質のチューニング本番デプロイ不要) / [トラブルシューティング](#トラブルシューティング)

---

## トラブルシューティング

### `SearXNG error 429 Too Many Requests` が出る

- SearXNG 側の limiter が有効だと、ヘッダが無い環境で 429 になりやすいです  
  → `searxng/settings.template.yml` の `server.limiter: false` を確認してください

### rendered が動かない

- `ENABLE_RENDERED_FETCH=true` になっているか
- `MCP_DOCKERFILE=Dockerfile.rendered` でビルドしているか（Chromium同梱）
- `RENDER_TIMEOUT_MS` をサイトに合わせて調整

次に読む: [目次](#目次) / [評価](#評価検索タスクをまとめて流す) / [OCIデプロイ](#oci-always-freearmにデプロイ)
