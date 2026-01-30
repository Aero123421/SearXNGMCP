# Ubuntu Server にデプロイ（推奨）

目的:

- `docker compose` で `mcp` + `searxng` + `valkey` を起動
- 公開は Cloudflare Tunnel 経由（インスタンスのインバウンドは基本 SSH のみ）

## 0) 前提

- Ubuntu Server 22.04 / 24.04（推奨）
- SSH でログインできること
- DNS/証明書/ポート開放は **Cloudflare Tunnel で吸収**する（MCP を直公開しない）

## 1) OS の初期セットアップ（最低限）

```bash
sudo apt-get update
sudo apt-get install -y git ca-certificates curl
```

（任意）ファイアウォール:

```bash
sudo apt-get install -y ufw
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status
```

## 2) Docker / docker compose のインストール

Ubuntu のパッケージで入れる方法:

```bash
sudo apt-get install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

※ `usermod` 反映のため、いったんログアウト→ログインし直してください。

確認:

```bash
docker version
docker compose version
```

## 3) リポジトリ取得と `.env` 設定

```bash
git clone https://github.com/Aero123421/SearXNGMCP.git
cd SearXNGMCP
cp .env.example .env
```

`.env` で最低限変えるもの:

- `API_KEYS`: 強いランダム文字列（複数環境ならカンマ区切りで複数）
- `SEARXNG_SECRET`: 強いランダム文字列

ランダム生成例:

```bash
openssl rand -hex 32
python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
```

## 4) 起動（ローカルのみ公開）

この `docker-compose.yml` は `127.0.0.1` にバインドしているので、外部から直接はアクセスできません（Cloudflare Tunnel 前提）。

```bash
docker compose up -d --build
docker compose ps
```

ログ:

```bash
docker compose logs -f --tail 200 mcp
docker compose logs -f --tail 200 searxng
```

ヘルスチェック:

```bash
curl -fsS http://127.0.0.1:8787/healthz
```

## 4.1) 「穴が開いてないか」確認（おすすめ）

Ubuntu（ホスト）で待ち受けているポート確認:

```bash
sudo ss -lntup
```

Docker が公開しているポート確認:

```bash
docker compose ps
```

ポイント:

- compose の `ports:` を `8787:8787` のように書くと、通常は `0.0.0.0` にバインドして外部から到達し得ます（ルータ/SG次第）。
- このリポジトリは `127.0.0.1:8787:8787` のように **ループバック限定**にしてあります。

## 5) Cloudflare Tunnel を同じホストで動かす（推奨）

Cloudflare 側で Tunnel を作って `CLOUDFLARE_TUNNEL_TOKEN` を発行したら、`.env` に入れて:

```bash
docker compose --profile tunnel up -d
docker compose ps
```

Cloudflare 側の設定は `docs/deploy/cloudflare.md` を参照。

## 6) 更新（pull → rebuild）

```bash
cd SearXNGMCP
git pull
docker compose up -d --build
```

SearXNG 設定を変更したら:

```bash
docker compose restart searxng
```

## 7) rendered fetch（任意 / 重い）

Chromium 同梱の `Dockerfile.rendered` は重くなりがちです。まずは HTTP fetch 運用を推奨。

有効化する場合:

- `.env` の `MCP_DOCKERFILE=Dockerfile.rendered`
- `.env` の `ENABLE_RENDERED_FETCH=true`

```bash
docker compose up -d --build
```
