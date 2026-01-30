# OpenCode で使う

OpenCode は `opencode.json`（または `~/.config/opencode/opencode.json`）の `mcp` で MCP サーバを設定できます（local / remote）。remote の場合は `type: "remote"` と `url` を使います。

参考:

- https://opencode.ai/docs/config/
- https://opencode.ai/docs/mcp-servers/

## 1) 設定ファイル

よく使う配置:

- グローバル: `~/.config/opencode/opencode.json`
- プロジェクト: `<repo-root>/opencode.json`（Git管理しやすい）

## 2) remote MCP（HTTP）を追加

例（APIキー + Cloudflare Access をヘッダで渡す）:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "sxng": {
      "type": "remote",
      "url": "https://mcp.example.com/mcp",
      "enabled": true,
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:SXNG_MCP_API_KEY}",
        "CF-Access-Client-Id": "{env:CF_ACCESS_CLIENT_ID}",
        "CF-Access-Client-Secret": "{env:CF_ACCESS_CLIENT_SECRET}"
      }
    }
  }
}
```

Cloudflare Access を使わない場合は `CF-Access-*` を削除してください。

補足:

- `oauth: false` は「OAuth を使わない（APIキー等の固定ヘッダで認証する）」宣言です。

## 3) 動作確認

```bash
opencode mcp list
```

ツールが読み込めていれば、`sxng_web_search` などが利用可能になります。
