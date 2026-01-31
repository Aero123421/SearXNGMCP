# デプロイ（Ubuntu Server + Cloudflare）

この MCP は **自前ホスト（Ubuntu Server）** に置いて、**Cloudflare（Tunnel + Access）で公開**する運用を推奨します。

- Ubuntu Server 手順（推奨）: `docs/deploy/ubuntu-server.md`
- Cloudflare 公開（Tunnel + Access）: `docs/deploy/cloudflare.md`

OCI / VPS / 自宅サーバなど、どこに Ubuntu を置いても基本は同じです（インバウンドはSSHだけにして Tunnel で出すのが安全）。
