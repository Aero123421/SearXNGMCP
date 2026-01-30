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

例（公式ドキュメントの書き方）:

```bash
claude mcp add --transport http sxng https://mcp.example.com/mcp \
  --header "Authorization: Bearer $SXNG_MCP_API_KEY" \
  --header "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  --header "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET"
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

注意:

- secrets をリポジトリに残したくない場合は `--scope local`（デフォルト）を推奨です。
- `--scope project` を使うとプロジェクト直下の `.mcp.json` に保存されるので、秘密情報を入れる運用ならコミットしないようにしてください。

スコープ（設定の保存先）:

- `--scope project` を付けるとプロジェクト直下の `.mcp.json` に保存されます（チームで共有しやすい）
- `--scope user` / `--scope local` なども利用できます（使い分けは公式ドキュメント参照）

## 3) 動作確認

```bash
claude mcp list
```

Claude Code 内でツール一覧に `sxng_web_search` などが出ていればOKです。
