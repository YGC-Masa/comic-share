const COMIC_API_BASE = 'https://script.google.com/macros/s/AKfycby-QkkKzQ8N0ofLEaD9iGeDE5HC8eP9WoKmVIOLurJFAMr2zVnDXR47FxmlzR0c01sd/exec';
const COMIC_SITE_URL = 'https://sites.google.com/view/hidamaristore/comic';
const COMIC_CACHE_SECONDS = 300;
const IMAGE_CACHE_SECONDS = 86400;

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';

      if (path === '/health') {
        return json({ ok: true, service: 'comic-share' });
      }

      if (path === '/image') {
        return handleImage(request, ctx);
      }

      const pathMatch = path.match(/^\/comic\/([^/]+)$/);
      const comicId = pathMatch
        ? decodeURIComponent(pathMatch[1])
        : (url.searchParams.get('comic') || '').trim();

      if (!comicId) {
        return new Response(renderIndex(), {
          headers: htmlHeaders(),
        });
      }

      return handleComicPage(request, comicId, ctx);
    } catch (error) {
      return new Response(renderError(error), {
        status: 500,
        headers: htmlHeaders(),
      });
    }
  },
};

async function handleComicPage(request, comicId, ctx) {
  const data = await getComicFromCms(comicId, ctx);

  if (!data || !data.success || !data.comic) {
    return new Response(renderNotFound(comicId), {
      status: 404,
      headers: htmlHeaders(),
    });
  }

  const comic = data.comic;
  const url = new URL(request.url);
  const rev = url.searchParams.get('rev') || '1';
  const origin = url.origin;

  const imageUrl = `${origin}/image?comic=${encodeURIComponent(comicId)}&kind=main&rev=${encodeURIComponent(rev)}`;
  const ogImageUrl = `${origin}/image?comic=${encodeURIComponent(comicId)}&kind=thumb&rev=${encodeURIComponent(rev)}`;
  const canonicalUrl = `${origin}/comic/${encodeURIComponent(comicId)}?rev=${encodeURIComponent(rev)}`;

  return new Response(
    renderComicPage({ comic, comicId, imageUrl, ogImageUrl, canonicalUrl, rev }),
    {
      headers: htmlHeaders({
        'Cache-Control': 'public, max-age=60',
      }),
    },
  );
}

async function handleImage(request, ctx) {
  const url = new URL(request.url);
  const comicId = (url.searchParams.get('comic') || '').trim();
  const kind = (url.searchParams.get('kind') || 'main').trim().toLowerCase();

  if (!comicId) {
    return new Response('comic is required', { status: 400 });
  }

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const data = await getComicFromCms(comicId, ctx);
  if (!data || !data.success || !data.comic) {
    return new Response('comic not found', { status: 404 });
  }

  const comic = data.comic;
  const fileId = kind === 'thumb'
    ? (comic.thumbFileId || comic.imageFileId)
    : (comic.imageFileId || comic.thumbFileId);

  if (!fileId) {
    return new Response('image not found', { status: 404 });
  }

  const imageResponse = await fetchPublicDriveImage(fileId);
  if (!imageResponse) {
    return new Response('image fetch failed', { status: 502 });
  }

  const headers = new Headers(imageResponse.headers);
  headers.set('Cache-Control', `public, max-age=${IMAGE_CACHE_SECONDS}`);
  headers.set('Access-Control-Allow-Origin', '*');

  const response = new Response(imageResponse.body, {
    status: imageResponse.status,
    headers,
  });

  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function getComicFromCms(comicId, ctx) {
  const cache = caches.default;
  const apiUrl = `${COMIC_API_BASE}?api=COMIC&comic=${encodeURIComponent(comicId)}`;
  const cacheKey = new Request(apiUrl, { method: 'GET' });

  const cached = await cache.match(cacheKey);
  if (cached) {
    try {
      return await cached.json();
    } catch (_) {}
  }

  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'hidamari-comic-share/1.0',
      'Accept': 'application/json',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`COMIC API ${response.status}`);
  }

  const data = await response.json();

  if (data && data.success) {
    const cacheResponse = new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${COMIC_CACHE_SECONDS}`,
      },
    });
    ctx.waitUntil(cache.put(cacheKey, cacheResponse));
  }

  return data;
}

async function fetchPublicDriveImage(fileId) {
  const candidates = [
    `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w2000`,
    `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}=w2000`,
  ];

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'hidamari-comic-share/1.0',
          'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
        },
      });

      const type = response.headers.get('content-type') || '';
      if (response.ok && type.startsWith('image/')) {
        return response;
      }
    } catch (_) {}
  }

  return null;
}

function renderComicPage({ comic, comicId, imageUrl, ogImageUrl, canonicalUrl, rev }) {
  const title = escapeHtml(comic.title || 'ひだまり WEB COMIC');
  const description = escapeHtml(comic.description || 'ひだまりストアのWEBコミック');
  const date = escapeHtml(comic.date || '');
  const characters = escapeHtml(comic.characters || '');
  const xPostText = escapeHtml(comic.xPostText || '');

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>${title} | ひだまり WEB COMIC</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${escapeAttr(canonicalUrl)}">

  <meta property="og:type" content="article">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${escapeAttr(canonicalUrl)}">
  <meta property="og:image" content="${escapeAttr(ogImageUrl)}">
  <meta property="og:image:alt" content="${title}">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${escapeAttr(ogImageUrl)}">

  <style>
    :root{--bg:#fffaf3;--paper:#fff;--ink:#44362d;--muted:#8f7967;--line:#eadcca;--accent:#e78328;--deep:#c96a17}
    *{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#fffaf3,#fff6e9);color:var(--ink);font-family:"Noto Sans JP","Yu Gothic",Meiryo,sans-serif}
    .wrap{width:min(900px,100%);margin:0 auto;padding:22px 14px 42px}.card{background:var(--paper);border:1px solid var(--line);border-radius:22px;overflow:hidden;box-shadow:0 16px 40px rgba(80,58,39,.10)}
    .hero img{display:block;width:100%;height:auto;background:#fff3e4}.body{padding:20px}.eyebrow{font-size:11px;font-weight:800;letter-spacing:.15em;color:var(--deep)}h1{margin:6px 0 10px;font-size:clamp(24px,5vw,38px);line-height:1.3}.desc{font-size:14px;line-height:1.8;color:#6f5e50}.meta{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0 0;font-size:12px;color:var(--muted)}
    .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:999px;text-decoration:none;font-weight:800;font-size:13px}.primary{background:var(--accent);color:white}.secondary{border:1px solid var(--line);color:var(--ink);background:#fff}.note{margin-top:18px;padding-top:14px;border-top:1px solid var(--line);font-size:11px;color:var(--muted)}
    @media(max-width:600px){.wrap{padding:10px 8px 28px}.card{border-radius:16px}.body{padding:14px}.actions{display:grid}.btn{width:100%}}
  </style>
</head>
<body>
  <main class="wrap">
    <article class="card">
      <div class="hero"><img src="${escapeAttr(imageUrl)}" alt="${title}"></div>
      <div class="body">
        <div class="eyebrow">HIDAMARI WEB COMIC</div>
        <h1>${title}</h1>
        <div class="desc">${description}</div>
        <div class="meta">
          ${date ? `<span>${date}</span>` : ''}
          ${characters ? `<span>登場：${characters}</span>` : ''}
        </div>
        <div class="actions">
          <a class="btn primary" href="${escapeAttr(COMIC_SITE_URL)}" target="_blank" rel="noopener">WEB COMIC一覧へ</a>
          <a class="btn secondary" href="${escapeAttr(imageUrl)}" target="_blank" rel="noopener">画像を開く</a>
        </div>
        ${xPostText ? `<div class="note">${xPostText}</div>` : ''}
        <div class="note">comic_id: ${escapeHtml(comicId)} / rev: ${escapeHtml(rev)}</div>
      </div>
    </article>
  </main>
</body>
</html>`;
}

function renderIndex() {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>comic-share</title></head><body style="font-family:sans-serif;padding:32px"><h1>comic-share</h1><p>Hidamari WEB COMIC share worker is running.</p><p><a href="${COMIC_SITE_URL}">WEB COMIC</a></p></body></html>`;
}

function renderNotFound(comicId) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>COMIC not found</title></head><body style="font-family:sans-serif;padding:32px"><h1>COMICが見つかりません</h1><p>${escapeHtml(comicId)}</p><p><a href="${COMIC_SITE_URL}">WEB COMIC一覧へ</a></p></body></html>`;
}

function renderError(error) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>comic-share error</title></head><body style="font-family:sans-serif;padding:32px"><h1>comic-share error</h1><pre>${escapeHtml(error?.message || String(error))}</pre></body></html>`;
}

function htmlHeaders(extra = {}) {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}
