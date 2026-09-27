# comic-share

ひだまりストア `WEB COMIC` の公開共有用 Cloudflare Worker。

このリポジトリを **Cloudflare Worker `comic-share` のコード正本** として扱う。
Cloudflare ダッシュボード上で直接修正した場合も、最終的にはこのリポジトリへ戻して履歴を残す。

## Production

- Worker name: `comic-share`
- workers.dev: `https://comic-share.game-hidamari-store.workers.dev`
- COMIC public site: `https://sites.google.com/view/hidamaristore/comic`
- CMS API: Apps Script `?api=COMIC&comic=<COMIC_ID>`

## Routes

### Share page

```text
/comic/<COMIC_ID>
```

例:

```text
https://comic-share.game-hidamari-store.workers.dev/comic/2026-09-23-460
```

旧互換:

```text
/?comic=<COMIC_ID>
```

### X cache bust

Xカードが表示されない場合は `rev` を1つ上げる。

```text
/comic/2026-09-23-460?rev=1
/comic/2026-09-23-460?rev=2
```

`rev` はコンテンツの意味を変えず、共有URLおよび画像URLのキャッシュキーを変えるために使用する。

### Image proxy

```text
/image?comic=<COMIC_ID>&kind=main
/image?comic=<COMIC_ID>&kind=thumb
```

CMS APIからDrive File IDを取得し、Cloudflare経由で公開画像を返す。

### Health

```text
/health
```

## Data flow

```text
ひだまりWeb_CMS / COMIC
        ↓
Apps Script COMIC JSON API
        ↓
comic-share Worker
        ├─ /comic/<id>  OGP / X share page
        └─ /image       Drive image proxy
```

## Important

- Cloudflare AccessをWorkerの前に置かない。X crawlerが読めなくなるため。
- COMIC画像のDrive側は公開読み取り可能であること。
- X向けOGPはWorkerのトップレベルHTMLで返す。
- Apps Script iframe内のOGPをX共有用として頼らない。
- CMS取得成功データは短時間キャッシュする。
- 画像は長めにキャッシュする。

## Deploy by dashboard

CloudflareをGit連携していない場合:

1. GitHubの `worker.js` を開く
2. 全文コピー
3. Cloudflare Workers & Pages → `comic-share`
4. Edit code
5. 全文置換
6. Deploy
7. `/health` を確認
8. 既知のCOMIC IDで `/comic/<id>?rev=<n>` を確認
9. Xでカードを確認。出なければ `rev` を+1

## Wrangler

Wranglerを利用する場合:

```bash
npx wrangler deploy
```

`wrangler.toml` はリポジトリ直下に置く。
