# Claude Code で使う

Claude Code は MCP に対応しており、`claude mcp add` コマンドでサーバを追加できます。

参考（公式）:

- https://docs.anthropic.com/en/docs/claude-code/mcp

## 1) 事前準備（環境変数）

例（bash）:

```bash
export SXNG_MCP_API_KEY="..."
export CF_ACCESS_CLIENT_ID="..."
export CF_ACCESS_CLIENT_SECRET="..."
```

## 2) HTTP MCP サーバを追加

例（オプションは server 名より前に書く）:

```bash
claude mcp add --transport http \
  --header "Authorization: Bearer $SXNG_MCP_API_KEY" \
  --header "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  --header "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  sxng https://mcp.example.com/mcp
```

Cloudflare Access を使わない場合は `CF-Access-*` の2行を省略してください。

JSONで渡す方法（ヘッダが多い場合に便利）:

```bash
claude mcp add-json sxng '{
  "type": "http",
  "url": "https://mcp.example.com/mcp",
  "headers": {
    "Authorization": "Bearer YOUR_API_KEY",
    "CF-Access-Client-Id": "YOUR_ACCESS_CLIENT_ID",
    "CF-Access-Client-Secret": "YOUR_ACCESS_CLIENT_SECRET"
  }
}'
```

スコープ（設定の保存先）:

- `--scope project` を付けるとプロジェクト直下の `.mcp.json` に保存されます（チームで共有しやすい）
- `--scope user` / `--scope local` なども利用できます（使い分けは公式ドキュメント参照）

## 3) 動作確認

```bash
claude mcp list
```

Claude Code 内でツール一覧に `sxng_web_search` などが出ていればOKです。
