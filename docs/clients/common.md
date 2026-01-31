# 共通: 接続情報・認証・動作確認

## 1) MCP URL

このサーバは MCP Streamable HTTP を `POST/GET/DELETE /mcp` で公開します。

- 例（推奨）: `https://mcp.example.com/mcp`
- ローカル: `http://127.0.0.1:8787/mcp`

## 2) 必須ヘッダ（認証）

このサーバは **必ず** Bearer token を要求します。

- `Authorization: Bearer <API_KEY>`

さらに Cloudflare Access（Service Token）で守る場合:

- `CF-Access-Client-Id: <client-id>`
- `CF-Access-Client-Secret: <client-secret>`

※ Cloudflare Access のヘッダ名は Access の Service Token 認証で一般的に使われるものです。実際にどの認証方式（Service Token / mTLS / etc）を使うかで必要ヘッダは変わります。
Access 側の設定手順は `docs/deploy/cloudflare.md` を参照してください。

### よくあるミス（重要）

- 変数の中に `CF-Access-Client-Id:` や `CF-Access-Client-Secret:` の文字列まで入れないでください（NG）
  - `claude mcp add --header "CF-Access-Client-Id: $CF_ID"` のように **ヘッダ名はコマンド側に書き**、`$CF_ID` には **IDだけ**を入れます
- PowerShell の `-Headers @{ ... }` は **キーがヘッダ名、値が中身**です（ヘッダ名+値を1本の文字列にしない）

PowerShell 例（疎通確認用。Access + Bearer の両方を送る）:

```powershell
$MCP_URL = "https://mcp.example.com/mcp"
$API_KEY = "YOUR_MCP_API_KEY"
$CF_ID   = "YOUR_ACCESS_CLIENT_ID"
$CF_SEC  = "YOUR_ACCESS_CLIENT_SECRET"

Invoke-RestMethod $MCP_URL -Method Post -ContentType "application/json" `
  -Headers @{
    "Authorization"="Bearer $API_KEY"
    "CF-Access-Client-Id"=$CF_ID
    "CF-Access-Client-Secret"=$CF_SEC
  } `
  -Body '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"powershell","version":"1.0"}}}'
```

## 3) ツール名の衝突回避（重要）

他のMCPやクライアント内蔵ツールと `web_search` / `web_fetch` が衝突・混同しやすいので、このサーバはデフォルトでツール名をプレフィックス付きにしています。

- デフォルト（推奨）:
  - `sxng_web_search`
  - `sxng_web_fetch`
  - `sxng_web_image_search`
  - `sxng_web_research`

環境変数で変更できます（`docker-compose.yml` / `.env.example` 参照）:

- `TOOL_PREFIX=sxng`（デフォルト）
- `ENABLE_LEGACY_TOOL_NAMES=false`（デフォルト。`true` にすると `web_search` 等も併設するが、混同しやすいので基本OFF推奨）

## 4) 動作確認のコツ

どのクライアントでも、最初は「ツール一覧が見える」ことを確認するのが早いです。

期待するツール名（デフォルト）:

- `sxng_web_search`
- `sxng_web_fetch`
- `sxng_web_image_search`
- `sxng_web_research`

次に、簡単な検索を1回投げて結果が返ればOKです。
