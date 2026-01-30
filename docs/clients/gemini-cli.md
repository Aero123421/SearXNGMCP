# Gemini CLI で使う

Gemini CLI は `settings.json` の `mcpServers` で MCP サーバを設定できます（stdio / SSE / Streamable HTTP）。HTTP の場合は `httpUrl` を使います。

参考:

- https://geminicli.com/docs/tools/mcp-server

## 1) 設定ファイル

以下のいずれかに `settings.json` を置きます（上にある方が優先される運用が多いです）:

- ユーザー設定: `~/.gemini/settings.json`
- プロジェクト設定: `.gemini/settings.json`

## 2) Streamable HTTP MCP を追加（推奨）

`~/.gemini/settings.json` 例:

```json
{
  "mcpServers": {
    "sxng": {
      "httpUrl": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer $SXNG_MCP_API_KEY",
        "CF-Access-Client-Id": "$CF_ACCESS_CLIENT_ID",
        "CF-Access-Client-Secret": "$CF_ACCESS_CLIENT_SECRET"
      }
    }
  }
}
```

Cloudflare Access を使わない場合は `CF-Access-*` を削除してください。

## 3) ツール名の混同について

Gemini CLI は「サーバ名のプレフィックス」を付けてツール名の衝突を避ける実装になっていることがあります。
このサーバ側も衝突回避のためデフォルトで `sxng_` プレフィックスのツール名を返します（例: `sxng_web_search`）。

