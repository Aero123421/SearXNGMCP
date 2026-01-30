# SearXNG WebSearch MCP (HTTP)

SearXNG を “候補取得” に使い、MCP Gateway 側で **重複排除/再ランキング/本文取得(任意)** を行う Web検索MCPサーバです。  
公開は **Cloudflare Tunnel + Access** を前提にしています。

## できること

- MCP Streamable HTTP（`POST/GET/DELETE /mcp`）で公開
- `Authorization: Bearer <API_KEY>` による認証（環境ごとにキー発行可能）
- トークン単位のレート制限（分/日）
- SSRF対策（localhost/プライベート/メタデータIP拒否、非標準ポート拒否）
- `web_search`（`fast|balanced|high` で品質/コスト調整）
- `web_fetch`（`auto|http|rendered`、rendered は agent-browser が必要）

## ローカル起動（Docker）

```bash
cp .env.example .env
# .env の API_KEYS を必ず変更
docker compose up -d --build
```

- MCP endpoint: `http://127.0.0.1:8787/mcp`
- SearXNG: `http://127.0.0.1:8080`
- Cloudflare Tunnel: `docker compose --profile tunnel up -d`（`.env` に `CLOUDFLARE_TUNNEL_TOKEN` が必要）

## SearXNG の検索品質チューニング（本番デプロイ不要）

このリポジトリの `searxng/settings.template.yml` を編集して `docker compose restart searxng` すれば、ローカルで即反映して評価できます。
（注: SearXNG 側の `server.limiter` は、プロキシヘッダ無し環境で 429 になりやすいので無効化してあります。レート制御は MCP Gateway 側 + Cloudflare で行います。）
起動時に `searxng/settings.runtime.yml` を生成し、`.env` の `SEARXNG_SECRET` を注入します（git には含めません）。


## ツール

### `web_search`

- `mode=fast`: SearXNG結果のみ（最速）
- `mode=balanced`: 上位1件を HTTP で本文取得し、スニペットを改善
- `mode=high`: 上位3件を `auto` fetch（HTTP→必要ならrendered）で検証して改善

追加パラメータ（任意）:
- `lang=auto`（簡易判定で ja/en を選択）
- `categories` / `time_range` / `engines`（SearXNGに透過）
- `tech_bias`（技術系ドメイン優先を強める）

### `web_image_search`

画像検索。`imageUrl`（必要なら `thumbnailUrl`）を返します。

### `web_research`

複数クエリで検索を回して `finalResults` を作り、必要なら `fetchTopK` 件の本文も取得します（要約はしません）。

### `web_fetch`

- `mode=http`: 通常HTTPで取得して本文抽出
- `mode=rendered`: ヘッドレスで描画後に抽出（`ENABLE_RENDERED_FETCH=true` + `agent-browser` が必要）
- `mode=auto`: まずHTTP、本文が薄い場合にrenderedへフォールバック

## Cloudflare 公開（方針）

1. Cloudflare Tunnel で OCI の `mcp:8787` を公開（オリジンへ inbound を開けない）
2. Cloudflare Access で Service Token を要求（環境ごとに発行）
3. さらに本サーバの `Authorization: Bearer` でも認証（防御を二重化）

## rendered fetch を有効化（agent-browser）

`web_fetch(mode=rendered)` や `web_search(mode=high)` を本格的に使う場合は Chromium が必要です。

- Dockerで有効化（イメージが重くなります）:
  - `.env` で `MCP_DOCKERFILE=Dockerfile.rendered`
  - `.env` で `ENABLE_RENDERED_FETCH=true`

## 開発（ローカル）

```bash
API_KEYS=dev SEARXNG_BASE_URL=http://127.0.0.1:8080 npm run dev
```

## テスト

```bash
npm test
```

## 評価タスク（カテゴリ別にまとめて実行）

デプロイ済みのMCPに対して、SWE/ハードウェア/日常/歴史/多言語/画像/深掘りのタスクセットを流します。

```bash
API_KEY=... MCP_URL=https://<your-domain>/mcp npm run eval
```

出力は `docs/eval/out.json` に保存されます（`docs/eval/tasks.json` を編集して拡張可能）。
