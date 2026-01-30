# Codex CLI で使う

Codex CLI は MCP（Streamable HTTP / stdio）に対応しています。MCP サーバは `~/.codex/config.toml`（または `.codex/config.toml`）で設定できます。

参考（公式）:

- https://platform.openai.com/docs/codex/cli#model-context-protocol-mcp

## 1) 事前準備（環境変数）

例（PowerShell）:

```powershell
$env:SXNG_MCP_API_KEY="..."
$env:CF_ACCESS_CLIENT_ID="..."
$env:CF_ACCESS_CLIENT_SECRET="..."
```

## 2) `config.toml` に MCP サーバを追加

`~/.codex/config.toml` に追記します。

```toml
[mcp_servers.sxng]
url = "https://mcp.example.com/mcp"

# MCP Gateway の Bearer 認証（必須）
bearer_token_env_var = "SXNG_MCP_API_KEY"

# Cloudflare Access（Service Token）を使う場合（任意）
[mcp_servers.sxng.env_http_headers]
"CF-Access-Client-Id" = "CF_ACCESS_CLIENT_ID"
"CF-Access-Client-Secret" = "CF_ACCESS_CLIENT_SECRET"
```

ポイント:

- ツール名衝突を避けるため、このサーバはデフォルトで `sxng_web_search` 等のツール名を返します（詳しくは `docs/clients/common.md`）。
- Cloudflare Access を使わない場合は `env_http_headers` を削ってOKです。

## 3) 動作確認

Codex CLI 側で MCP ツールが認識されているか（ツール一覧）→ `sxng_web_search` を1回呼べるか、の順で確認してください。
