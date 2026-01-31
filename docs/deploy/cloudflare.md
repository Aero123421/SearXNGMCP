# Cloudflare で公開（Tunnel + Access 推奨）

ゴール:

- オリジン（Ubuntu Server）側は **インバウンドを基本SSHだけ**にする
- 公開は Cloudflare Tunnel
- 認証は Cloudflare Access（Service Token など）
- さらに MCP Gateway 側の `Authorization: Bearer <API_KEY>` も必須（防御を二重化）

## 用語（混同しやすい）

- Tunnel token: `cloudflared` が Cloudflare に接続するためのトークン（**サーバ側**だけで使う）
  - `.env` の `CLOUDFLARE_TUNNEL_TOKEN`
- Service Token（Access）: Cloudflare Access を通過するための Client ID / Secret（**クライアント側**で使う）
  - ヘッダ `CF-Access-Client-Id` / `CF-Access-Client-Secret`
- API key（MCP Gateway）: このMCPサーバが要求する Bearer token（**クライアント側**で使う）
  - `.env` の `API_KEYS`
  - ヘッダ `Authorization: Bearer <API_KEY>`

## 1) Tunnel を作成

Cloudflare Zero Trust の画面で Tunnel を作成し、トークンを取得します。

トークンを `.env` の `CLOUDFLARE_TUNNEL_TOKEN` に設定してください。

### UI が違って見える場合（重要）

Cloudflare の UI は時期・アカウント状態・言語でナビ名が揺れます。よくあるパターン:

- `Networks > Tunnels` が見える
- `コネクタ（Connectors）` から Tunnel 一覧に入る

どちらでも「作成済み Tunnel の詳細画面」まで入れれば、最終的に以下のどこかに “公開ホスト名（Public Hostnames）” が出ます:

- タブ: `Public Hostnames` / `公開ホスト名`
- メニュー: `Routes` / `ルート` 配下に `Public hostnames` がある
- さらに別表記: `公開されたアプリケーション ルート`（= Public Hostname の一覧と同義。ここを編集します）

もしどうしても見当たらない場合は、次の “ローカル管理トンネル” の可能性を確認してください。

### 「ローカル管理トンネル」と表示される場合

Tunnel が “locally managed / ローカル構成” 扱いだと、ダッシュボードから Public Hostname を追加できません。
その場合は以下のいずれかになります:

- `cloudflared` の設定ファイル（`config.yml`）で ingress を定義する
- ダッシュボード管理（remotely managed）へ移行する

（本リポジトリの推奨はダッシュボード管理 + Public Hostname です）

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

補足（よく出てくる別画面）:

- 「Tunnel の IP 範囲を設定する / プライベート ネットワークの IP 範囲を追加」系の画面は **WARP（端末登録）でプライベートIPへ入る用途**です。
- 本リポジトリの推奨（Public Hostname で `mcp.example.com/mcp` を公開）では **不要**です。

## 4) Access（認証）を掛ける

Cloudflare Access の Application を作り、認証方式を選びます（推奨: Service Token）。

Service Token（機械用認証）とは:

- CLI/CI/サーバなど “人間ログインできないクライアント” のための Client ID / Client Secret
- 入口（Cloudflare）で「このトークンを持つクライアントだけ通す」ために使います

### 4.1) Access Application（Self-hosted）を作る

Cloudflare Zero Trust → Access → Applications → Add an application → Self-hosted

推奨設定（例）:

- Application name: `sxng-mcp`
- Application domain: `mcp.example.com`
- Path: `/mcp*`（UIでワイルドカードが使えない場合は `/mcp`）

ここで作った「Application の URL（公開されたアプリケーション ルート）」が、クライアントが叩く入口になります。
（例: `https://mcp.example.com/mcp`）

### 4.2) Policy を “Service Token 許可” にする（重要）

Access Application の Policies で、以下を追加します。

- Action: `Allow`
- Include: `Service Token`
  - ここで 4.0 で発行した Service Token を選択

注意:

- `Deny` が先に効いている、または `WARP必須` / `Device posture必須` などを入れていると、CLI から通らなくなることがあります。
- まずは「Service Token を Allow」だけで動かして、必要なら後から制約を追加してください。

Service Token を使う場合、クライアントからは通常以下のヘッダを送ります:

- `CF-Access-Client-Id: <id>`
- `CF-Access-Client-Secret: <secret>`

よくあるミス（重要）:

- 変数の中に `CF-Access-Client-Id:` / `CF-Access-Client-Secret:` の文字列まで入れてしまう（NG）
  - ヘッダ名はクライアント設定側に書き、値には **ID/Secretそのもの**だけを入れます

加えて、この MCP Gateway は必ず:

- `Authorization: Bearer <API_KEY>`

を要求します。

## 5) 疎通の考え方

1) Cloudflare 側で Access を満たしている（= 入口で弾かれない）  
2) MCP Gateway 側の Bearer token が正しい  
3) `sxng_web_search` などのツール一覧が取得できる  

クライアント別の設定は `docs/clients/README.md` を参照。

## 6) うまくいかないとき（Access 周りの典型）

- 403 / 401 になる:
  - Service Token の Policy が無い / ルートが間違っている / ヘッダが付いていない
- HTML のログイン画面が返る:
  - Service Token を Allow していない（人間ログインのポリシーだけになっている）
- 404 になる:
  - Tunnel の Public Hostname の `Path` が `/mcp` になっていない（例: `mcp` になっている）
  - Tunnel の Service が `https://...` になっている（基本は `http://mcp:8787`）

## 7) トラブルの切り分け（Access Logs を見る）

Cloudflare 側の Access が「どのアプリにマッチして」「なぜ拒否したか」を最短で確認できます。

手順:

1) Cloudflare Zero Trust → Access → Logs
2) 対象のホスト名（例: `mcp.fr3ed.com`）で絞る
3) 可能ならリクエストの `CF-RAY`（レスポンスヘッダに出る）で絞る

ログでよくある原因:

- `No matching policy` / `No policy matched`:
  - アプリの `domain/path` がズレている、または Service Token Allow のポリシーが無い
- `Service token` が認識されていない:
  - ヘッダが付いていない、または別アプリ（ワイルドカード/キャッチオール）に先にマッチしている
