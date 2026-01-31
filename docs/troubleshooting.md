# トラブルシューティング（Cloudflare / MCP / Docker / Claude Code / OpenCode）

このドキュメントは、実運用で詰まりやすいポイントを「症状 → 原因 → 直し方」でまとめたものです。  
**秘密鍵/APIキー/Client Secret は貼らない**でください（ログやスクショも同様）。漏洩した可能性がある場合は必ずローテーションしてください。

---

## 0) まず結論: どこで止まってるかを分離する

外部公開は層が多いので、まず「どの層で失敗しているか」を切り分けます。

- Cloudflare Access（認証）
- Cloudflare Tunnel（ルーティング）
- MCP Gateway（`/mcp`）
- MCP Gateway → SearXNG（`SEARXNG_BASE_URL`）

### 0.1 `/healthz` が最速（Access/Tunnel/オリジン到達）

`/healthz` は MCP の Bearer 認証をスキップするので「Access + Tunnel」だけ確認できます。

PowerShell（例）:

```powershell
curl.exe -sS -m 15 -i `
  -H "CF-Access-Client-Id: $CF_ID" `
  -H "CF-Access-Client-Secret: $CF_SEC" `
  https://<your-host>/healthz
```

- `200` + `{"ok":true,...}` → Access/Tunnel/オリジン到達OK
- `302` + `Location: .../cdn-cgi/access/login/...` → Accessで止まってる
- `403` → Accessポリシー不一致、またはヘッダが実値になっていない
- `404` → Tunnel のルート（Path）ミスの可能性が高い

---

## 1) Cloudflare Access で詰まる

### 1.1 `302` で `...cloudflareaccess.com/cdn-cgi/access/login/...` に飛ぶ

症状:

- `curl` で `302 Found`
- `Location:` が `.../cdn-cgi/access/login/...`

原因:

- Service Token を許可するポリシーが **マッチしていない**
- ポリシー条件が厳しすぎる（WARP必須/Device posture必須など）
- アプリの `domain` / `path` がズレている

直し方:

- Zero Trust の Access アプリで、対象ホスト（例: `mcpsearxng.example.com`）にマッチする Application を作る/見直す
- Policy で **Service Token を許可**する
  - UIによっては Action が `Service Auth` になっていることがあります
- まずは切り分けのため、Require系は外して最小で通す（後から強化）

### 1.2 `403 Forbidden`（Cloudflareヘッダ付き）

原因候補:

- `CF-Access-Client-Id/Secret` が実値で送れていない（プレースホルダのまま）
- 別トークンを選んでいる/Secretを再表示できないのに古い値を使っている
- ポリシーにマッチしていない

直し方:

- コマンドのヘッダが本当に変数展開されているか確認（`<CLIENT_ID>` のような文字列をそのまま送らない）
- Service Token を再発行して更新

---

## 2) Cloudflare Tunnel（ルーティング）で詰まる

### 2.1 `/healthz` が `404`（キャッチオール 404）

原因:

- Tunnel の公開ルートが `/mcp` など **特定Pathだけ**オリジンへ流す設定になっている
- それ以外はキャッチオールで `http_status:404` になっている

直し方（おすすめ）:

- Public hostname（公開されたアプリケーション ルート）で
  - Hostname: `mcpsearxng.example.com`
  - Path: **空（未指定）**
  - Service: `http://mcp:8787`

最小変更:

- `/mcp` ルートは維持して、追加で `/healthz` ルートを作る

### 2.2 502 / 接続できない

原因候補:

- Service が `https://mcp:8787` になっている（コンテナ内は通常HTTP）
- Service のポート/ホストが違う
- cloudflared が別のネットワークで `mcp` を解決できていない

直し方:

- Service はまず `http://mcp:8787` を基本にする
- `docker compose logs -f --tail 200 cloudflared` を確認

---

## 3) MCP（Streamable HTTP）の仕様で詰まる

### 3.1 `406 Not Acceptable`（initialize）

症状:

- `initialize` が `406` で落ちる
- エラー文が「`application/json` と `text/event-stream` を受け取れ」と言っている

原因:

- Streamable HTTP は SSE を使うため、クライアントが `text/event-stream` を accept する必要がある

直し方:

```powershell
curl.exe -sS -m 15 -D - -o - `
  -H "Accept: application/json, text/event-stream" `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer $API_KEY" `
  --data-raw "$init" `
  https://<your-host>/mcp
```

### 3.2 `400 Bad Request`（HTMLで "Bad Request"）

原因候補:

- JSONが壊れている（改行混入、引用符のコピペ事故、文字コードなど）

直し方:

- PowerShell で JSON を生成してファイル経由で送る（事故りにくい）

```powershell
$init = @{ jsonrpc="2.0"; id=1; method="initialize"; params=@{ protocolVersion="2024-11-05"; capabilities=@{}; clientInfo=@{name="ps"; version="1.0"} } } `
  | ConvertTo-Json -Depth 10 -Compress
$init | Set-Content -NoNewline -Encoding utf8 .\mcp_init.json

curl.exe -sS -m 15 -D - -o - `
  -H "Accept: application/json, text/event-stream" `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer $API_KEY" `
  --data-binary "@mcp_init.json" `
  https://<your-host>/mcp
```

---

## 4) Claude Code 側で詰まる

### 4.1 `settings.json` が壊れて起動時に警告が出る

症状:

- `C:\Users\<you>\.claude\settings.json` が `Invalid or malformed JSON`
- 「エラーのある設定ファイルは丸ごと無視」と表示される

原因:

- JSONの末尾にコマンド/メモを貼ってしまう（JSONでなくなる）

直し方:

- `settings.json` を **JSONだけ**に戻す（メモは別ファイルへ）

### 4.2 `claude mcp list` が `Failed to connect`

原因候補:

- URLが古い（別サブドメインへ移動した等）
- Cloudflare Access で止まっている
- Streamable HTTP の `Accept` が足りない（クライアント側差）

直し方:

- `docs/clients/claude-code.md` の設定例どおりに登録し直す
- 必要なら `Accept: application/json, text/event-stream` を追加する

---

## 5) OpenCode 側で詰まる

### 5.1 `opencode mcp list` が設定エラー

症状:

- `permission.edit` / `permission.bash` が `auto` などで弾かれる

直し方:

- OpenCode が要求する値（例: `ask|allow|deny`）に合わせる

### 5.2 `SSE error: Non-200 status code (403)`

原因候補:

- `Authorization` / `CF-Access-*` の env が未設定で、ヘッダが空扱い

直し方:

- 環境変数を設定してから `opencode mcp list` を実行

---

## 6) `sxng_web_search` だけ `fetch failed` になる（重要）

症状:

- MCP 接続はOK（`tools/list` も出る）
- `sxng_web_fetch` は動く
- `sxng_web_search` だけ `fetch failed`

原因の典型:

- MCP Gateway から `SEARXNG_BASE_URL`（デフォルト `http://searxng:8080`）へ到達できていない
- Docker の内部DNS/ネットワークが壊れて、`searxng` サービス名が解決できない
- ポート 8080 が別コンテナに占有され、`searxng` が起動できていない

### 6.1 まずは mcp→searxng の到達テスト（wget不要）

`mcp` コンテナに `wget` が無い環境があるため、Node の `fetch` で確認します。

```bash
docker compose exec mcp node -e "
(async () => {
  const url='http://searxng:8080/search?format=json&q=test&pageno=1&language=en&safesearch=1';
  const r=await fetch(url,{headers:{accept:'application/json'}});
  console.log('status', r.status);
  console.log((await r.text()).slice(0,200));
})().catch(e=>{ console.error('ERR', e); process.exit(1); });
"
```

- `getaddrinfo ENOTFOUND searxng` → Docker内部DNS/ネットワーク崩れ
- `ECONNREFUSED` → `searxng` が落ちてる/起動してない
- `status 200` → 到達OK（次はSearXNGのエンジン設定/外向き通信）

### 6.2 Docker内部DNS/ネットワーク崩れの直し方

まずは再作成:

```bash
docker compose --profile tunnel down --remove-orphans
docker compose down --remove-orphans
docker compose up -d --build
docker compose --profile tunnel up -d cloudflared
```

### 6.3 `Bind for 0.0.0.0:8080 failed: port is already allocated`

原因:

- 別のコンテナ（例: `searxng`）がホストの 8080 を占有している

直し方:

```bash
sudo ss -lntp | grep ':8080' || true
docker ps --format '{{.Names}}\t{{.Ports}}' | grep 8080 || true

# 競合コンテナを止める/消す（例）
docker rm -f searxng
```

その後に `docker compose up -d --build`。

---

## 7) 秘密情報の扱い（必須）

- どこにも貼らない: `API_KEYS`, `CF-Access-Client-Secret`, `CLOUDFLARE_TUNNEL_TOKEN`, `SEARXNG_SECRET`
- 会話/スクショ/ログに出した可能性がある場合は **ローテーション**
- クライアントごとにキーを分ける（漏れたクライアントだけ止められる）

