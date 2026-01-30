# MCPクライアント別 設定ガイド

このリポジトリの MCP Gateway（SearXNG WebSearch MCP）を、各種CLIエージェントから使うための設定手順をまとめます。

前提（共通）:

- MCP URL は `https://<your-domain>/mcp`（Cloudflare Tunnel + Access 推奨）
- このサーバは追加で `Authorization: Bearer <API_KEY>` を要求します
- Cloudflare Access（Service Token）を使う場合は `CF-Access-Client-Id` / `CF-Access-Client-Secret` も必要です（インストール不要、ヘッダを付けるだけ）
- ツール名は衝突回避のためデフォルトで `sxng_` プレフィックスです（例: `sxng_web_search`）

まずは共通事項を読んでから、利用するクライアントのページへ進んでください。

- 共通（URL/ヘッダ/命名/チェック方法）: `docs/clients/common.md`

クライアント別:

- Codex CLI: `docs/clients/codex-cli.md`
- Claude Code: `docs/clients/claude-code.md`
- Gemini CLI: `docs/clients/gemini-cli.md`
- OpenCode: `docs/clients/opencode.md`
