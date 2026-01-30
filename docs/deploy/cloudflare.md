# Cloudflare で公開（Tunnel + Access 推奨）

ゴール:

- オリジン（Ubuntu Server）側は **インバウンドを基本SSHだけ**にする
- 公開は Cloudflare Tunnel
- 認証は Cloudflare Access（Service Token など）
- さらに MCP Gateway 側の `Authorization: Bearer <API_KEY>` も必須（防御を二重化）

## 1) Tunnel を作成

Cloudflare Zero Trust の画面で Tunnel を作成し、トークンを取得します。

トークンを `.env` の `CLOUDFLARE_TUNNEL_TOKEN` に設定してください。

## 2) `cloudflared` を起動（docker compose）

このリポジトリは `cloudflared` コンテナを同梱しています。

```bash
docker compose --profile tunnel up -d
docker compose logs -f --tail 200 cloudflared
```

## 3) Public Hostname（ルーティング）

Tunnel の Public Hostname で、MCP Gateway にルーティングします。

例:

- Hostname: `mcp.example.com`
- Service: `http://mcp:8787`
- Path: `/mcp`（任意。MCP Gateway の `MCP_PATH` と合わせる）

## 4) Access（認証）を掛ける

Cloudflare Access の Application を作り、認証方式を選びます（推奨: Service Token）。

Service Token を使う場合、クライアントからは通常以下のヘッダを送ります:

- `CF-Access-Client-Id: <id>`
- `CF-Access-Client-Secret: <secret>`

加えて、この MCP Gateway は必ず:

- `Authorization: Bearer <API_KEY>`

を要求します。

## 5) 疎通の考え方

1) Cloudflare 側で Access を満たしている（= 入口で弾かれない）  
2) MCP Gateway 側の Bearer token が正しい  
3) `sxng_web_search` などのツール一覧が取得できる  

クライアント別の設定は `docs/clients/README.md` を参照。

