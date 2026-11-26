/**
 * KomoLib Cloud API — Cloudflare Workers + D1
 *
 * Permanent free edge backend (0 ms cold start, never sleeps/suspends):
 * - Google Drive OAuth + persistent per-email refresh_token vault (D1)
 * - Shared Reading Rooms (KOMO-XXXX) & Mutual Shelves (SHELF-XXXX)
 * - Chunked binary file storage inside D1 (512 KB chunks => zero R2/credit-card required)
 * - Optional Gemini AI chat & book identification proxy
 * - Optional Email-only cloud sync fallback
 */

const CHUNK_SIZE = 512 * 1024; // 512 KB per D1 row (well under D1 2 MB row limit)
const MAX_UPLOAD_BYTES = 45 * 1024 * 1024; // 45 MB safety cap for Workers RAM

function corsHeaders(req) {
  const origin = req.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-KomoLib-Space',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(req, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(req),
    },
  });
}

function html(req, body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...corsHeaders(req),
    },
  });
}

function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

function normalizeSpaceId(raw) {
  const clean = String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  return clean.length >= 4 ? clean : 'default';
}

function getRequestSpaceId(req, url, body) {
  const fromHeader = req.headers.get('X-KomoLib-Space');
  const fromQuery = url.searchParams.get('space') || '';
  const fromBody = typeof body?.spaceId === 'string' ? body.spaceId : '';
  return normalizeSpaceId(fromHeader || fromQuery || fromBody || 'default');
}

const CATALOG_UA = 'KomoLib/1.14 (+https://github.com/Pdamg10/komolib)';

const GENRE_ES_MAP = {
  Action: 'Acción',
  Adventure: 'Aventura',
  Comedy: 'Comedia',
  Drama: 'Drama',
  Ecchi: 'Ecchi',
  Fantasy: 'Fantasía',
  Horror: 'Terror',
  Historical: 'Histórico',
  Isekai: 'Isekai',
  Magic: 'Magia',
  'Mahou Shoujo': 'Chicas Mágicas',
  'Martial Arts': 'Artes Marciales',
  Mecha: 'Mecha',
  Monsters: 'Monstruos',
  Music: 'Música',
  Mystery: 'Misterio',
  Psychological: 'Psicológico',
  Reincarnation: 'Reencarnación',
  Romance: 'Romance',
  'School Life': 'Vida Escolar',
  'Sci-Fi': 'Ciencia Ficción',
  'Slice of Life': 'Recuentos de la vida',
  Sports: 'Deportes',
  Supernatural: 'Sobrenatural',
  Survival: 'Supervivencia',
  Thriller: 'Suspenso',
  'Time Travel': 'Viajes en el Tiempo',
  Tragedy: 'Tragedia',
  'Video Games': 'Videojuegos',
  Villainess: 'Villana',
};

const IGNORED_FORMAT_TAGS = new Set([
  'long strip',
  'full color',
  'web comic',
  'adaptation',
  'official colored',
  'fan colored',
  'oneshot',
  'award winning',
  'anthology',
]);

function stripHtmlTags(raw) {
  return String(raw || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1')
    .replace(/\n\s*---[\s\S]*$/m, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\*\*/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildCleanCatalogQuery(raw) {
  return String(raw || '')
    .replace(/\.[^.]+$/, '')
    .replace(/_+/g, ' ')
    .replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, ' ')
    .replace(/\b(cap(?:s|[ií]tulos?)?|ch(?:ap)?|tomo|vol(?:umen)?|parte|pack|pdf|cbz|cbr|epub|mobi|azw3|español|espanol|completo|final|manhwa|manga|manhua|webtoon|scans?|scanlation|fansub|traducci[oó]n(?:es)?|translations?|olympus|ikigai|meian|mango|ajce|amistosas|plot\s*twist|dragon)\b/gi, ' ')
    .replace(/\b\d+\s*[-–—~]\s*\d+\b/g, ' ')
    .replace(/(?:^|\s)#?\d{1,4}\s*$/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 110);
}

function normalizeMatchKey(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function lookupWikipediaEsSummary(query, hint = '') {
  try {
    const sr = encodeURIComponent(hint ? `${query} ${hint}` : query);
    const searchRes = await fetch(
      `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${sr}&format=json&srlimit=3`,
      { headers: { Accept: 'application/json', 'User-Agent': CATALOG_UA } }
    );
    if (!searchRes.ok) return null;
    const sData = await searchRes.json().catch(() => ({}));
    const hits = Array.isArray(sData?.query?.search) ? sData.query.search : [];
    const qKey = normalizeMatchKey(query);
    const best = hits.find((h) => normalizeMatchKey(h.title).includes(qKey) || qKey.includes(normalizeMatchKey(h.title))) || hits[0];
    if (!best?.title) return null;
    const sumRes = await fetch(
      `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(best.title)}`,
      { headers: { Accept: 'application/json', 'User-Agent': CATALOG_UA } }
    );
    if (!sumRes.ok) return null;
    const sumData = await sumRes.json().catch(() => ({}));
    const extract = stripHtmlTags(sumData?.extract || '');
    if (extract.length < 40) return null;
    return {
      title: typeof sumData?.title === 'string' ? sumData.title.replace(/\s*\([^)]*\)\s*$/, '').trim() : '',
      description: extract.slice(0, 950),
    };
  } catch {
    return null;
  }
}

function matchExistingSpanishSeries(candidateTitles, existingSeriesNames = []) {
  if (!Array.isArray(existingSeriesNames) || existingSeriesNames.length === 0) return '';
  const candKeys = Array.from(
    new Set((candidateTitles || []).map(normalizeMatchKey).filter((k) => k.length >= 3))
  );
  if (candKeys.length === 0) return '';

  const normalizedExisting = existingSeriesNames
    .map((name) => ({ raw: String(name || '').trim(), key: normalizeMatchKey(name) }))
    .filter((x) => x.raw.length >= 2 && x.key.length >= 3);

  // 1. Exact normalized match against any title / altTitle (bridges Spanish <-> English <-> Romaji!)
  for (const ex of normalizedExisting) {
    if (candKeys.includes(ex.key)) return ex.raw;
  }
  // 2. Strong prefix match (shorter >= 6 chars, <= 3 extra words)
  for (const ex of normalizedExisting) {
    for (const ck of candKeys) {
      const shorter = ex.key.length <= ck.length ? ex.key : ck;
      const longer = ex.key.length <= ck.length ? ck : ex.key;
      if (shorter.length >= 6 && longer.startsWith(`${shorter} `)) {
        const tail = longer.slice(shorter.length).trim().split(/\s+/).filter(Boolean);
        if (tail.length <= 3) return ex.raw;
      }
    }
  }
  return '';
}

function originTagToKind(originTag) {
  if (originTag === 'comic') return 'comic';
  if (originTag === 'manga') return 'manga';
  return 'manhwa';
}

async function lookupVisualSeriesFallback(queryRaw, existingSeriesNames = [], strictConfidence = false) {
  const query = buildCleanCatalogQuery(queryRaw);
  if (!query || query.length < 2) return null;
  const qKey = normalizeMatchKey(query);
  const catalogHeaders = { Accept: 'application/json', 'User-Agent': CATALOG_UA };

  // 1. MangaDex public API (free, no key, native Spanish titles & altTitles, massive Manhwa/Manga/Manhua catalog)
  try {
    const mdUrl =
      `https://api.mangadex.org/manga?title=${encodeURIComponent(query)}` +
      `&limit=5&includes[]=author&includes[]=artist` +
      `&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`;
    const mdRes = await fetch(mdUrl, { headers: catalogHeaders });
    if (mdRes.ok) {
      const mdData = await mdRes.json().catch(() => ({}));
      const items = Array.isArray(mdData?.data) ? mdData.data : [];
      if (items.length > 0) {
        const scoreItem = (item) => {
          const attrs = item?.attributes || {};
          const titles = [
            ...Object.values(attrs.title || {}),
            ...(Array.isArray(attrs.altTitles) ? attrs.altTitles.flatMap((t) => Object.values(t || {})) : []),
          ]
            .map(normalizeMatchKey)
            .filter((t) => t.length >= 3);
          let titleScore = 0;
          if (titles.some((t) => t === qKey)) titleScore = 100;
          else if (titles.some((t) => t.startsWith(qKey) || qKey.startsWith(t))) titleScore = 60;
          else if (titles.some((t) => t.includes(qKey))) titleScore = 30;
          let bonus = 0;
          if (attrs.description?.es || attrs.description?.['es-la']) bonus += 25;
          else if (attrs.description?.en) bonus += 10;
          if (attrs.originalLanguage === 'ko' || attrs.originalLanguage === 'ja' || attrs.originalLanguage === 'zh') bonus += 5;
          return { titleScore, total: titleScore + bonus };
        };
        const ranked = items.map((item) => ({ item, ...scoreItem(item) })).sort((a, b) => b.total - a.total);
        const top = ranked[0];
        if (!strictConfidence || top.titleScore >= 60) {
          const best = top.item;
          const attrs = best?.attributes || {};
          const allRawTitles = [
            ...Object.values(attrs.title || {}),
            ...(Array.isArray(attrs.altTitles) ? attrs.altTitles.flatMap((t) => Object.values(t || {})) : []),
            query,
          ].filter((x) => typeof x === 'string' && x.trim().length > 0);
          const altEs = Array.isArray(attrs.altTitles)
            ? attrs.altTitles.map((t) => t?.es || t?.['es-la']).find(Boolean)
            : '';
          const matchedExisting = matchExistingSpanishSeries(allRawTitles, existingSeriesNames);
          const mainTitle =
            matchedExisting ||
            attrs.title?.es ||
            attrs.title?.['es-la'] ||
            altEs ||
            query ||
            attrs.title?.en ||
            Object.values(attrs.title || {})[0];
          const lang = String(attrs.originalLanguage || '').toLowerCase();
          const originTag =
            lang === 'ko'
              ? 'manhwa'
              : lang === 'ja'
              ? 'manga'
              : lang.startsWith('zh')
              ? 'manhua'
              : 'comic';
          const statusMap = {
            ongoing: 'ongoing',
            completed: 'completed',
            hiatus: 'hiatus',
            cancelled: 'cancelled',
          };
          const genres = Array.isArray(attrs.tags)
            ? attrs.tags
                .filter((t) => t?.attributes?.group === 'genre' || t?.attributes?.group === 'theme')
                .map((t) => {
                  const enName = String(t?.attributes?.name?.en || '').trim();
                  if (!enName || IGNORED_FORMAT_TAGS.has(enName.toLowerCase())) return '';
                  return t?.attributes?.name?.es || GENRE_ES_MAP[enName] || enName;
                })
                .filter(Boolean)
                .slice(0, 8)
            : [];
          const rels = Array.isArray(best?.relationships) ? best.relationships : [];
          const authorRel = rels.find((r) => r?.type === 'author' && r?.attributes?.name) ||
            rels.find((r) => r?.type === 'artist' && r?.attributes?.name);
          const author = authorRel?.attributes?.name || '';
          const rawDesc =
            attrs.description?.es ||
            attrs.description?.['es-la'] ||
            attrs.description?.en ||
            '';
          let description = stripHtmlTags(rawDesc).slice(0, 950);
          if (!attrs.description?.es && !attrs.description?.['es-la']) {
            const wiki = await lookupWikipediaEsSummary(mainTitle, originTag);
            if (wiki?.description) description = wiki.description;
          }
          const parsedLast = Number(attrs.lastChapter);
          const totalChaptersExpected =
            Number.isFinite(parsedLast) && parsedLast > 0 ? Math.floor(parsedLast) : undefined;
          return {
            model: 'mangadex-catalog',
            detectedKind: originTagToKind(originTag),
            seriesName: mainTitle,
            title: mainTitle,
            author,
            originTag,
            genres,
            seriesStatus: statusMap[String(attrs.status || '').toLowerCase()] || undefined,
            totalChaptersExpected,
            description,
          };
        }
      }
    }
  } catch {
    // fall through to AniList
  }

  // 2. AniList GraphQL (free, no key, covers Manhwa/Manga/Manhua)
  try {
    const gql = `query ($search: String) {
      Media(search: $search, type: MANGA) {
        title { romaji english native }
        synonyms
        countryOfOrigin
        status
        chapters
        genres
        description(asHtml: false)
        staff(perPage: 2) { nodes { name { full } } }
      }
    }`;
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...catalogHeaders },
      body: JSON.stringify({ query: gql, variables: { search: query } }),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const m = data?.data?.Media;
      if (m) {
        const allTitles = [m.title?.english, m.title?.romaji, m.title?.native, ...(Array.isArray(m.synonyms) ? m.synonyms : []), query].filter(Boolean);
        const normTitles = allTitles.map(normalizeMatchKey).filter((t) => t.length >= 3);
        const strongMatch = normTitles.some((t) => t === qKey || (qKey.length >= 5 && (t.startsWith(qKey) || qKey.startsWith(t))));
        if (!strictConfidence || strongMatch) {
          const originTag =
            m.countryOfOrigin === 'KR'
              ? 'manhwa'
              : m.countryOfOrigin === 'CN'
              ? 'manhua'
              : m.countryOfOrigin === 'JP'
              ? 'manga'
              : 'manhwa';
          const statusMap = {
            FINISHED: 'completed',
            RELEASING: 'ongoing',
            HIATUS: 'hiatus',
            CANCELLED: 'cancelled',
          };
          const genres = Array.isArray(m.genres)
            ? m.genres.map((g) => GENRE_ES_MAP[g] || g).filter(Boolean).slice(0, 8)
            : [];
          const author = m.staff?.nodes?.[0]?.name?.full || '';
          const matchedExisting = matchExistingSpanishSeries(allTitles, existingSeriesNames);
          const resolvedName = matchedExisting || query;
          const wiki = await lookupWikipediaEsSummary(m.title?.english || m.title?.romaji || query, originTag);
          return {
            model: 'anilist-catalog',
            detectedKind: originTagToKind(originTag),
            seriesName: resolvedName,
            title: resolvedName,
            author,
            originTag,
            genres,
            seriesStatus: statusMap[m.status] || undefined,
            totalChaptersExpected: typeof m.chapters === 'number' && m.chapters > 0 ? m.chapters : undefined,
            description: wiki?.description || stripHtmlTags(m.description).slice(0, 950),
          };
        }
      }
    }
  } catch {
    // fall through to Jikan
  }

  // 3. Jikan / MyAnimeList public API (free, no key)
  if (!strictConfidence) {
    try {
      const jRes = await fetch(
        `https://api.jikan.moe/v4/manga?q=${encodeURIComponent(query)}&limit=1`,
        { headers: catalogHeaders }
      );
      if (jRes.ok) {
        const jData = await jRes.json().catch(() => ({}));
        const m = jData?.data?.[0];
        if (m) {
          const typeLow = String(m.type || '').toLowerCase();
          const originTag = typeLow.includes('manhwa')
            ? 'manhwa'
            : typeLow.includes('manhua')
            ? 'manhua'
            : 'manga';
          const stLow = String(m.status || '').toLowerCase();
          const seriesStatus = stLow.includes('finish')
            ? 'completed'
            : stLow.includes('hiatus')
            ? 'hiatus'
            : stLow.includes('discontinu')
            ? 'cancelled'
            : stLow.includes('publish')
            ? 'ongoing'
            : undefined;
          const genres = Array.isArray(m.genres)
            ? m.genres.map((g) => GENRE_ES_MAP[g.name] || g.name).filter(Boolean).slice(0, 8)
            : [];
          const author = m.authors?.[0]?.name || '';
          const jTitles = [
            m.title,
            m.title_english,
            ...(Array.isArray(m.titles) ? m.titles.map((t) => t?.title) : []),
            query,
          ].filter(Boolean);
          const matchedExisting = matchExistingSpanishSeries(jTitles, existingSeriesNames);
          return {
            model: 'jikan-catalog',
            detectedKind: originTagToKind(originTag),
            seriesName: matchedExisting || query,
            title: matchedExisting || m.title || query,
            author,
            originTag,
            genres,
            seriesStatus,
            totalChaptersExpected: typeof m.chapters === 'number' && m.chapters > 0 ? m.chapters : undefined,
            description: stripHtmlTags(m.synopsis).slice(0, 950),
          };
        }
      }
    } catch {
      // fall through to Wikipedia ES
    }
  }

  if (!strictConfidence) {
    const wikiOnly = await lookupWikipediaEsSummary(query, 'manhwa manga');
    if (wikiOnly?.description) {
      return {
        model: 'wikipedia-es-catalog',
        seriesName: matchExistingSpanishSeries([wikiOnly.title, query], existingSeriesNames) || wikiOnly.title || query,
        title: wikiOnly.title || query,
        author: '',
        description: wikiOnly.description,
      };
    }
  }
  return null;
}

async function lookupBookCatalogFallback(queryRaw, currentAuthor = '') {
  const query = buildCleanCatalogQuery(queryRaw);
  if (!query || query.length < 2) return null;
  const catalogHeaders = { Accept: 'application/json', 'User-Agent': CATALOG_UA };
  const qWithAuthor =
    currentAuthor && !/desconocido|biblioteca personal/i.test(currentAuthor)
      ? `${query} ${currentAuthor}`
      : query;

  // 1. Google Books public API (Spanish first, then unrestricted; pick best result that actually has a synopsis)
  for (const langParam of ['&langRestrict=es', '']) {
    try {
      const res = await fetch(
        `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(qWithAuthor)}&maxResults=5${langParam}`,
        { headers: catalogHeaders }
      );
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const items = Array.isArray(data?.items) ? data.items : [];
        const best =
          items.find((it) => it?.volumeInfo?.description && String(it.volumeInfo.description).trim().length >= 40) ||
          items[0];
        const info = best?.volumeInfo;
        if (info && (info.title || info.description || info.authors?.length)) {
          let desc = stripHtmlTags(info.description).slice(0, 950);
          if (!desc) {
            const wiki = await lookupWikipediaEsSummary(info.title || query, 'novela libro');
            if (wiki?.description) desc = wiki.description;
          }
          return {
            model: 'google-books-catalog',
            title: typeof info.title === 'string' ? info.title.trim() : '',
            author: Array.isArray(info.authors) ? info.authors.join(', ').trim() : '',
            description: desc,
          };
        }
      }
    } catch {
      // try next
    }
  }

  // 2. Open Library Search + Work Details API
  try {
    const olRes = await fetch(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(qWithAuthor)}&limit=3`,
      { headers: catalogHeaders }
    );
    if (olRes.ok) {
      const olData = await olRes.json().catch(() => ({}));
      const doc = olData?.docs?.[0];
      if (doc) {
        let description = '';
        if (typeof doc.key === 'string' && doc.key.startsWith('/works/')) {
          try {
            const wRes = await fetch(`https://openlibrary.org${doc.key}.json`, { headers: catalogHeaders });
            if (wRes.ok) {
              const wData = await wRes.json().catch(() => ({}));
              const rawWDesc = typeof wData?.description === 'string' ? wData.description : wData?.description?.value || '';
              description = stripHtmlTags(rawWDesc).slice(0, 950);
            }
          } catch {
            // ignore work details error
          }
        }
        if (!description) {
          description = Array.isArray(doc.first_sentence)
            ? String(doc.first_sentence[0] || '').trim()
            : typeof doc.first_sentence === 'string'
            ? doc.first_sentence.trim()
            : '';
        }
        if (!description) {
          const wiki = await lookupWikipediaEsSummary(doc.title || query, 'libro');
          if (wiki?.description) description = wiki.description;
        }
        return {
          model: 'openlibrary-catalog',
          title: typeof doc.title === 'string' ? doc.title.trim() : '',
          author: Array.isArray(doc.author_name) ? doc.author_name[0] || '' : '',
          description,
        };
      }
    }
  } catch {
    // fall through to Wikipedia ES
  }

  // 3. Wikipedia ES fallback
  const wikiBook = await lookupWikipediaEsSummary(query, 'novela libro');
  if (wikiBook?.description) {
    return {
      model: 'wikipedia-es-catalog',
      title: wikiBook.title || query,
      author: '',
      description: wikiBook.description,
    };
  }
  return null;
}

function sanitizeAvatarUrl(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 180000) return '';
  if (/^data:image\/(png|jpeg|jpg|webp|gif|avif);base64,/i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed) && trimmed.length <= 2048) return trimmed;
  return '';
}

function base64UrlEncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecodeUtf8(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(str.length / 4) * 4, '=');
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function randomCode(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  const rand = new Uint8Array(4);
  crypto.getRandomValues(rand);
  for (let i = 0; i < 4; i++) suffix += chars[rand[i] % chars.length];
  return `${prefix}-${suffix}`;
}

function checkBearerAuth(req, url, env) {
  const token = (env.KOMOLIB_TOKEN || '').trim();
  if (!token) return true;
  const auth = req.headers.get('Authorization') || '';
  const queryToken = url.searchParams.get('token') || '';
  return auth === `Bearer ${token}` || queryToken === token;
}

/* ---------- D1 Chunked Binary File Helpers ---------- */

async function saveBinaryFile(db, fileKey, fileName, mimeType, bytes) {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`El archivo excede el límite de ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB`);
  }
  await db.prepare('DELETE FROM file_chunks WHERE file_key = ?').bind(fileKey).run();
  const chunkCount = Math.max(1, Math.ceil(bytes.byteLength / CHUNK_SIZE));
  for (let i = 0; i < chunkCount; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(bytes.byteLength, start + CHUNK_SIZE);
    const slice = bytes.subarray(start, end);
    await db
      .prepare('INSERT INTO file_chunks (file_key, chunk_index, data) VALUES (?, ?, ?)')
      .bind(fileKey, i, slice)
      .run();
  }
  await db
    .prepare(
      'INSERT OR REPLACE INTO files_meta (file_key, file_name, mime_type, size, chunk_count, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(fileKey, fileName, mimeType || 'application/octet-stream', bytes.byteLength, chunkCount, Date.now())
    .run();
}

async function deleteBinaryFile(db, fileKey) {
  if (!fileKey) return;
  await db.batch([
    db.prepare('DELETE FROM file_chunks WHERE file_key = ?').bind(fileKey),
    db.prepare('DELETE FROM files_meta WHERE file_key = ?').bind(fileKey),
  ]);
}

async function serveBinaryFile(req, db, fileKey) {
  const meta = await db
    .prepare('SELECT file_name, mime_type, size, chunk_count FROM files_meta WHERE file_key = ?')
    .bind(fileKey)
    .first();
  if (!meta) return json(req, { error: 'Archivo no encontrado' }, 404);

  const chunksRes = await db
    .prepare('SELECT chunk_index, data FROM file_chunks WHERE file_key = ? ORDER BY chunk_index ASC')
    .bind(fileKey)
    .all();
  const rows = chunksRes.results || [];
  if (!rows.length) return json(req, { error: 'Contenido del archivo ausente' }, 404);

  const parts = rows.map((r) =>
    r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data)
  );
  const totalLen = parts.reduce((acc, p) => acc + p.byteLength, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    combined.set(p, offset);
    offset += p.byteLength;
  }

  return new Response(combined, {
    status: 200,
    headers: {
      'Content-Type': meta.mime_type || 'application/octet-stream',
      'Content-Length': String(combined.byteLength),
      'Content-Disposition': `inline; filename="${String(meta.file_name || 'book').replace(/"/g, '')}"`,
      'Cache-Control': 'private, max-age=3600',
      ...corsHeaders(req),
    },
  });
}

/* ---------- D1 Google Refresh Token Helpers ---------- */

async function getSavedRefreshToken(db, email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean) return '';
  const row = await db
    .prepare('SELECT refresh_token FROM google_tokens WHERE email = ?')
    .bind(clean)
    .first();
  return typeof row?.refresh_token === 'string' ? row.refresh_token.trim() : '';
}

async function saveRefreshToken(db, email, token) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanToken = String(token || '').trim();
  if (!cleanEmail || !cleanToken) return;
  await db
    .prepare('INSERT OR REPLACE INTO google_tokens (email, refresh_token, updated_at) VALUES (?, ?, ?)')
    .bind(cleanEmail, cleanToken, Date.now())
    .run();
}

function isAllowedGoogleReturnUrl(raw, env) {
  if (!raw || typeof raw !== 'string') return false;
  try {
    const u = new URL(raw);
    if (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/i.test(u.hostname)) return true;
    const pubApp = (env.PUBLIC_APP_URL || '').trim();
    if (pubApp) {
      const pub = new URL(pubApp);
      if (u.origin === pub.origin) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/* ---------- D1 Rooms / Shelves Helpers ---------- */

async function getRoom(db, code) {
  const row = await db.prepare('SELECT data FROM rooms WHERE code = ?').bind(code).first();
  return row ? JSON.parse(row.data) : null;
}

async function putRoom(db, room) {
  await db
    .prepare('INSERT OR REPLACE INTO rooms (code, data, updated_at) VALUES (?, ?, ?)')
    .bind(room.code, JSON.stringify(room), room.updatedAt || Date.now())
    .run();
}

async function isRoomDeleted(db, code) {
  const row = await db.prepare('SELECT 1 FROM deleted_rooms WHERE code = ?').bind(code).first();
  return Boolean(row);
}

async function getShelf(db, code) {
  const row = await db.prepare('SELECT data FROM shelves WHERE code = ?').bind(code).first();
  return row ? JSON.parse(row.data) : null;
}

async function putShelf(db, shelf) {
  await db
    .prepare('INSERT OR REPLACE INTO shelves (code, data, updated_at) VALUES (?, ?, ?)')
    .bind(shelf.code, JSON.stringify(shelf), shelf.updatedAt || Date.now())
    .run();
}

async function isShelfDeleted(db, code) {
  const row = await db.prepare('SELECT 1 FROM deleted_shelves WHERE code = ?').bind(code).first();
  return Boolean(row);
}

/* ---------- Sync State Merge Helper (Email fallback) ---------- */

function emptyState() {
  return {
    updatedAt: 0,
    books: {},
    bookmarks: [],
    annotations: [],
    notes: [],
    chatSessions: [],
    customBookmarkDesigns: [],
    customStationery: null,
    customStationeryUpdatedAt: 0,
    categories: null,
    categoriesUpdatedAt: 0,
    collections: null,
    collectionsUpdatedAt: 0,
    readerSettings: null,
    readerSettingsUpdatedAt: 0,
    theme: null,
    themeUpdatedAt: 0,
    profile: null,
    profileUpdatedAt: 0,
    aiProfile: null,
    aiProfileUpdatedAt: 0,
    lastActiveSession: null,
    deletedBookIds: [],
    deletedBookmarkIds: [],
    deletedAnnotationIds: [],
    deletedNoteIds: [],
    deletedBookmarkDesignIds: [],
    deletedChatSessionIds: [],
    sharedRooms: [],
    joinedRoomCodes: [],
    closedRoomCodes: [],
    sharedShelves: [],
    joinedShelfCodes: [],
    closedShelfCodes: [],
  };
}

function mergeById(existing = [], incoming = [], deletedSet = new Set()) {
  const map = new Map();
  for (const item of existing) {
    if (item?.id && !deletedSet.has(item.id)) map.set(item.id, item);
  }
  for (const item of incoming) {
    if (!item?.id || deletedSet.has(item.id)) continue;
    const prev = map.get(item.id);
    if (!prev || (item.updatedAt || item.createdAt || 0) >= (prev.updatedAt || prev.createdAt || 0)) {
      map.set(item.id, item);
    }
  }
  return Array.from(map.values());
}

function isRasterCover(url) {
  return typeof url === 'string' && /^data:image\/(?!svg\+xml)/i.test(url.trim());
}

function mergeStates(currentRaw, incoming) {
  const current = { ...emptyState(), ...(currentRaw || {}) };
  const mergeT = (a = [], b = []) => Array.from(new Set([...a, ...b])).slice(-500);

  const deletedBookIds = mergeT(current.deletedBookIds, incoming.deletedBookIds);
  const deletedBookmarkIds = mergeT(current.deletedBookmarkIds, incoming.deletedBookmarkIds);
  const deletedAnnotationIds = mergeT(current.deletedAnnotationIds, incoming.deletedAnnotationIds);
  const deletedNoteIds = mergeT(current.deletedNoteIds, incoming.deletedNoteIds);
  const deletedBookmarkDesignIds = mergeT(current.deletedBookmarkDesignIds, incoming.deletedBookmarkDesignIds);
  const deletedChatSessionIds = mergeT(current.deletedChatSessionIds, incoming.deletedChatSessionIds);

  const incDelBooks = new Set(incoming.deletedBookIds || []);
  const delBooks = new Set(deletedBookIds);
  const delBm = new Set(deletedBookmarkIds);
  const delAnn = new Set(deletedAnnotationIds);
  const delNotes = new Set(deletedNoteIds);
  const delDesigns = new Set(deletedBookmarkDesignIds);
  const delChats = new Set(deletedChatSessionIds);

  const mergedBooks = {};
  for (const [id, b] of Object.entries(current.books || {})) {
    if (b && !b.isDemo && !incDelBooks.has(id)) mergedBooks[id] = b;
  }
  for (const [id, b] of Object.entries(incoming.books || {})) {
    if (!b || b.isDemo || incDelBooks.has(id)) continue;
    if (delBooks.has(id) && !current.books?.[id]) continue;
    const prev = mergedBooks[id];
    const incomingNewer = !prev || (b.updatedAt || 0) >= (prev.updatedAt || 0);
    if (incomingNewer) {
      let cover =
        b.coverDataUrl === '__KEEP__' ? prev?.coverDataUrl || '' : b.coverDataUrl || prev?.coverDataUrl || '';
      if (isRasterCover(prev?.coverDataUrl) && !isRasterCover(b.coverDataUrl) && b.hasOriginalCover !== false) {
        cover = prev.coverDataUrl;
      }
      mergedBooks[id] = {
        ...prev,
        ...b,
        coverDataUrl: cover,
        driveFileId: b.driveFileId || prev?.driveFileId,
        hasRemoteFile: Boolean(prev?.hasRemoteFile || b.hasRemoteFile || b.driveFileId || prev?.driveFileId),
        remoteFileName: prev?.remoteFileName || b.remoteFileName,
      };
    } else if (prev) {
      mergedBooks[id] = {
        ...prev,
        driveFileId: prev.driveFileId || b.driveFileId,
        hasRemoteFile: Boolean(prev.hasRemoteFile || b.hasRemoteFile || prev.driveFileId || b.driveFileId),
      };
    }
  }
  for (const id of incDelBooks) delete mergedBooks[id];

  const incThemeTs = Number(incoming.themeUpdatedAt || 0);
  const curThemeTs = Number(current.themeUpdatedAt || 0);
  const useIncTheme = Boolean(incoming.theme && (!current.theme || (incThemeTs > 0 && incThemeTs >= curThemeTs)));
  const resolvedTheme =
    incoming.theme?.customWallpaperUrl === '__KEEP__'
      ? { ...incoming.theme, customWallpaperUrl: current.theme?.customWallpaperUrl || '' }
      : incoming.theme;

  const incProfileTs = Number(incoming.profileUpdatedAt || 0);
  const curProfileTs = Number(current.profileUpdatedAt || 0);
  const useIncProfile = Boolean(incoming.profile && (!current.profile || (incProfileTs > 0 && incProfileTs >= curProfileTs)));

  const incReaderTs = Number(incoming.readerSettingsUpdatedAt || 0);
  const curReaderTs = Number(current.readerSettingsUpdatedAt || 0);
  const useIncReader = Boolean(
    incoming.readerSettings && (!current.readerSettings || (incReaderTs > 0 && incReaderTs >= curReaderTs))
  );

  const incStationeryTs = Number(incoming.customStationeryUpdatedAt || 0);
  const curStationeryTs = Number(current.customStationeryUpdatedAt || 0);
  const useIncStationery = Boolean(
    incoming.customStationery &&
      (!current.customStationery || (incStationeryTs > 0 && incStationeryTs >= curStationeryTs))
  );

  const incCategoriesTs = Number(incoming.categoriesUpdatedAt || 0);
  const curCategoriesTs = Number(current.categoriesUpdatedAt || 0);
  const useIncCategories = Boolean(
    Array.isArray(incoming.categories) &&
      incoming.categories.length > 0 &&
      (!Array.isArray(current.categories) ||
        current.categories.length === 0 ||
        (incCategoriesTs > 0 && incCategoriesTs >= curCategoriesTs))
  );

  const incCollectionsTs = Number(incoming.collectionsUpdatedAt || 0);
  const curCollectionsTs = Number(current.collectionsUpdatedAt || 0);
  const useIncCollections = Boolean(
    Array.isArray(incoming.collections) &&
      incoming.collections.length > 0 &&
      (!Array.isArray(current.collections) ||
        current.collections.length === 0 ||
        (incCollectionsTs > 0 && incCollectionsTs >= curCollectionsTs))
  );

  const incAiProfileTs = Number(incoming.aiProfileUpdatedAt || 0);
  const curAiProfileTs = Number(current.aiProfileUpdatedAt || 0);
  const useIncAiProfile = Boolean(
    incoming.aiProfile && (!current.aiProfile || (incAiProfileTs > 0 && incAiProfileTs >= curAiProfileTs))
  );

  const closedRoomCodes = Array.from(
    new Set([...(current.closedRoomCodes || []), ...(incoming.closedRoomCodes || [])].map(normalizeCode).filter(Boolean))
  ).slice(-100);
  const closedRoomSet = new Set(closedRoomCodes);
  const roomsMap = new Map();
  for (const r of [...(current.sharedRooms || []), ...(incoming.sharedRooms || [])]) {
    const c = normalizeCode(r?.code);
    if (!c || closedRoomSet.has(c)) continue;
    const prev = roomsMap.get(c);
    if (!prev || (r.updatedAt || r.createdAt || 0) >= (prev.updatedAt || prev.createdAt || 0)) roomsMap.set(c, r);
  }
  const sharedRooms = Array.from(roomsMap.values())
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
    .slice(0, 40);

  const closedShelfCodes = Array.from(
    new Set([...(current.closedShelfCodes || []), ...(incoming.closedShelfCodes || [])].map(normalizeCode).filter(Boolean))
  ).slice(-100);
  const closedShelfSet = new Set(closedShelfCodes);
  const shelvesMap = new Map();
  for (const sh of [...(current.sharedShelves || []), ...(incoming.sharedShelves || [])]) {
    const c = normalizeCode(sh?.code);
    if (!c || closedShelfSet.has(c)) continue;
    const prev = shelvesMap.get(c);
    if (!prev || (sh.updatedAt || sh.createdAt || 0) >= (prev.updatedAt || prev.createdAt || 0)) shelvesMap.set(c, sh);
  }
  const sharedShelves = Array.from(shelvesMap.values())
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
    .slice(0, 40);

  return {
    updatedAt: Date.now(),
    books: mergedBooks,
    bookmarks: incoming.bookmarks ? mergeById(current.bookmarks, incoming.bookmarks, delBm) : current.bookmarks,
    annotations: incoming.annotations ? mergeById(current.annotations, incoming.annotations, delAnn) : current.annotations,
    notes: incoming.notes ? mergeById(current.notes, incoming.notes, delNotes) : current.notes,
    chatSessions: Array.isArray(incoming.chatSessions)
      ? mergeById(current.chatSessions, incoming.chatSessions, delChats)
          .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
          .slice(0, 60)
      : (current.chatSessions || []).filter((x) => !delChats.has(x?.id)),
    customBookmarkDesigns: incoming.customBookmarkDesigns
      ? mergeById(current.customBookmarkDesigns, incoming.customBookmarkDesigns, delDesigns)
      : (current.customBookmarkDesigns || []).filter((x) => !delDesigns.has(x?.id)),
    customStationery: useIncStationery ? incoming.customStationery : current.customStationery || null,
    customStationeryUpdatedAt: useIncStationery ? incStationeryTs : curStationeryTs,
    categories: useIncCategories ? incoming.categories : current.categories || null,
    categoriesUpdatedAt: useIncCategories ? incCategoriesTs : curCategoriesTs,
    collections: useIncCollections ? incoming.collections : current.collections || null,
    collectionsUpdatedAt: useIncCollections ? incCollectionsTs : curCollectionsTs,
    readerSettings: useIncReader ? incoming.readerSettings : current.readerSettings || null,
    readerSettingsUpdatedAt: useIncReader ? incReaderTs : curReaderTs,
    theme: useIncTheme ? resolvedTheme : current.theme,
    themeUpdatedAt: useIncTheme ? incThemeTs : curThemeTs,
    profile: useIncProfile ? incoming.profile : current.profile,
    profileUpdatedAt: useIncProfile ? incProfileTs : curProfileTs,
    aiProfile: useIncAiProfile ? incoming.aiProfile : current.aiProfile || null,
    aiProfileUpdatedAt: useIncAiProfile ? incAiProfileTs : curAiProfileTs,
    lastActiveSession:
      incoming.lastActiveSession &&
      (!current.lastActiveSession || (incoming.lastActiveSession.updatedAt || 0) >= (current.lastActiveSession.updatedAt || 0))
        ? incoming.lastActiveSession
        : current.lastActiveSession || null,
    deletedBookIds,
    deletedBookmarkIds,
    deletedAnnotationIds,
    deletedNoteIds,
    deletedBookmarkDesignIds,
    deletedChatSessionIds,
    sharedRooms,
    joinedRoomCodes: Array.from(
      new Set([...(current.joinedRoomCodes || []), ...(incoming.joinedRoomCodes || []), ...sharedRooms.map((r) => r.code)].map(normalizeCode).filter((c) => c && !closedRoomSet.has(c)))
    ).slice(0, 40),
    closedRoomCodes,
    sharedShelves,
    joinedShelfCodes: Array.from(
      new Set([...(current.joinedShelfCodes || []), ...(incoming.joinedShelfCodes || []), ...sharedShelves.map((s) => s.code)].map(normalizeCode).filter((c) => c && !closedShelfSet.has(c)))
    ).slice(0, 40),
    closedShelfCodes,
  };
}

/* ---------- Main Router ---------- */

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }

    const url = new URL(req.url);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method.toUpperCase();
    const db = env.DB;

    try {
      // Root status page
      if (method === 'GET' && pathname === '/') {
        return json(req, { ok: true, service: 'komolib-cloudflare-api', version: '2.0.0' });
      }

      // Health check
      if (method === 'GET' && pathname === '/api/health') {
        const roomsRow = await db.prepare('SELECT COUNT(*) AS c FROM rooms').first().catch(() => ({ c: 0 }));
        return json(req, {
          ok: true,
          service: 'komolib-cloudflare-api',
          version: '2.0.0',
          booksCount: 0,
          roomsCount: Number(roomsRow?.c || 0),
          updatedAt: Date.now(),
          authRequired: Boolean((env.KOMOLIB_TOKEN || '').trim()),
          aiConfigured: Boolean((env.GEMINI_API_KEY || '').trim()),
          aiModel: (env.GEMINI_MODEL || 'gemini-2.5-flash').trim(),
          publicUrl: url.origin,
          lanUrls: [],
          uploadUrls: [],
        });
      }

      if (method === 'GET' && pathname === '/api/network-info') {
        return json(req, {
          port: 443,
          lanIps: [],
          lanUrls: [],
          publicUrl: url.origin,
          uploadUrls: [],
          authRequired: Boolean((env.KOMOLIB_TOKEN || '').trim()),
        });
      }

      /* ===== GOOGLE DRIVE OAUTH + PERSISTENT D1 REFRESH VAULT ===== */

      if (method === 'GET' && pathname === '/api/google/status') {
        const clientId = (env.GOOGLE_CLIENT_ID || '').trim();
        const clientSecret = (env.GOOGLE_CLIENT_SECRET || '').trim();
        return json(req, {
          ok: true,
          configured: Boolean(clientId && clientSecret),
          clientId,
        });
      }

      if (method === 'GET' && pathname === '/api/google/start') {
        const clientId = (env.GOOGLE_CLIENT_ID || '').trim();
        const clientSecret = (env.GOOGLE_CLIENT_SECRET || '').trim();
        if (!clientId || !clientSecret) {
          return html(
            req,
            '<html><body style="font-family:sans-serif;padding:24px;max-width:480px;margin:auto;">' +
              '<h2>Google Drive aún no configurado en Cloudflare</h2>' +
              '<p>Ejecuta <code>npx wrangler secret put GOOGLE_CLIENT_ID</code> y <code>GOOGLE_CLIENT_SECRET</code>.</p>' +
              '</body></html>',
            503
          );
        }
        const platformRaw = url.searchParams.get('platform') || 'web';
        const platform =
          platformRaw === 'android' ? 'android' : platformRaw === 'desktop' ? 'desktop' : 'web';
        const rawReturn = url.searchParams.get('returnTo') || '';
        const returnTo = isAllowedGoogleReturnUrl(rawReturn, env)
          ? rawReturn
          : (env.PUBLIC_APP_URL || '').trim();
        const loginHint = (url.searchParams.get('loginHint') || '').trim().toLowerCase();
        const forceConsent = url.searchParams.get('forceConsent') === '1';
        const switchAccount = url.searchParams.get('switchAccount') === '1';
        const redirectUri = `${url.origin}/api/google/callback`;

        const statePayload = base64UrlEncodeUtf8(
          JSON.stringify({ platform, returnTo, ts: Date.now() })
        );

        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: [
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
          ].join(' '),
          access_type: 'offline',
          include_granted_scopes: 'true',
          state: statePayload,
        });

        if (loginHint) params.set('login_hint', loginHint);
        const hasSavedRefresh = loginHint ? Boolean(await getSavedRefreshToken(db, loginHint)) : false;
        if (forceConsent) {
          params.set('prompt', 'consent select_account');
        } else if (switchAccount) {
          params.set('prompt', 'select_account');
        } else if (!hasSavedRefresh) {
          params.set('prompt', 'consent');
        }

        return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302);
      }

      if (method === 'GET' && pathname === '/api/google/callback') {
        const clientId = (env.GOOGLE_CLIENT_ID || '').trim();
        const clientSecret = (env.GOOGLE_CLIENT_SECRET || '').trim();
        let stateObj = { platform: 'web', returnTo: (env.PUBLIC_APP_URL || '').trim() };
        try {
          const rawState = url.searchParams.get('state') || '';
          if (rawState) {
            const parsed = JSON.parse(base64UrlDecodeUtf8(rawState));
            stateObj = {
              platform:
                parsed.platform === 'android'
                  ? 'android'
                  : parsed.platform === 'desktop'
                  ? 'desktop'
                  : 'web',
              returnTo: isAllowedGoogleReturnUrl(parsed.returnTo, env)
                ? parsed.returnTo
                : (env.PUBLIC_APP_URL || '').trim(),
            };
          }
        } catch {
          // ignore invalid state
        }

        const sendBack = (payloadObj) => {
          const encoded = base64UrlEncodeUtf8(JSON.stringify(payloadObj));
          const ok = !payloadObj.error;
          if (stateObj.platform === 'android' || (stateObj.platform === 'desktop' && !stateObj.returnTo)) {
            const scheme = stateObj.platform === 'desktop' ? 'komolib://oauth' : 'com.komolib.reader://oauth';
            const deepLink = `${scheme}#gdrive_auth=${encodeURIComponent(encoded)}`;
            return html(
              req,
              `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
                `<title>Komolib · Google Drive</title>` +
                `<style>body{font-family:system-ui,sans-serif;background:#f3ede4;color:#2e2621;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}.card{background:#fffdf9;border-radius:20px;padding:28px 24px;max-width:420px;box-shadow:0 12px 34px rgba(0,0,0,.08)}.btn{display:inline-block;margin-top:16px;padding:12px 22px;border-radius:999px;background:#e86f68;color:#fff;font-weight:700;text-decoration:none}</style>` +
                `</head><body><div class="card">` +
                `<h2>${ok ? 'Google Drive conectado' : 'No se pudo conectar'}</h2>` +
                `<p>${ok ? 'Volviendo a Komolib...' : String(payloadObj.error || 'Error desconocido')}</p>` +
                `<a class="btn" href="${deepLink}">Abrir Komolib</a>` +
                `</div><script>window.location.replace(${JSON.stringify(deepLink)});</script></body></html>`
            );
          }
          const targetBase = stateObj.returnTo || 'http://localhost:5173';
          return Response.redirect(`${targetBase}#gdrive_auth=${encodeURIComponent(encoded)}`, 302);
        };

        const oauthErr = url.searchParams.get('error');
        if (oauthErr) return sendBack({ error: oauthErr });
        const code = url.searchParams.get('code') || '';
        if (!code || !clientId || !clientSecret) {
          return sendBack({ error: 'Código OAuth faltante o credenciales de Google no configuradas' });
        }

        const redirectUri = `${url.origin}/api/google/callback`;
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }),
        });
        const tokenData = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok || !tokenData.access_token) {
          return sendBack({ error: tokenData.error_description || tokenData.error || 'Error al obtener token de Google' });
        }

        const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const userInfo = await userRes.json().catch(() => ({}));
        const resolvedEmail = String(userInfo.email || '').trim().toLowerCase();
        let effectiveRefreshToken = String(tokenData.refresh_token || '').trim();
        if (resolvedEmail && effectiveRefreshToken) {
          await saveRefreshToken(db, resolvedEmail, effectiveRefreshToken);
        } else if (resolvedEmail && !effectiveRefreshToken) {
          effectiveRefreshToken = await getSavedRefreshToken(db, resolvedEmail);
        }

        return sendBack({
          email: resolvedEmail,
          name: String(userInfo.name || '').trim(),
          picture: String(userInfo.picture || '').trim(),
          accessToken: tokenData.access_token,
          refreshToken: effectiveRefreshToken,
          expiresAt: Date.now() + Math.max(300, Number(tokenData.expires_in || 3600) - 120) * 1000,
        });
      }

      if (method === 'POST' && pathname === '/api/google/refresh') {
        const clientId = (env.GOOGLE_CLIENT_ID || '').trim();
        const clientSecret = (env.GOOGLE_CLIENT_SECRET || '').trim();
        if (!clientId || !clientSecret) {
          return json(req, { error: 'Google Drive OAuth no configurado en Cloudflare' }, 503);
        }
        const body = await req.json().catch(() => ({}));
        const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
        let refreshToken = typeof body?.refreshToken === 'string' ? body.refreshToken.trim() : '';
        if (!refreshToken && email) {
          refreshToken = await getSavedRefreshToken(db, email);
        }
        if (!refreshToken) {
          return json(
            req,
            { error: 'Tu sesión de Google Drive expiró. Vuelve a pulsar "Conectar con Google Drive".' },
            401
          );
        }

        const exchange = async (rt) => {
          const r = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              refresh_token: rt,
              grant_type: 'refresh_token',
            }),
          });
          const d = await r.json().catch(() => ({}));
          return { ok: r.ok && Boolean(d.access_token), data: d };
        };

        let result = await exchange(refreshToken);
        let usedRefresh = refreshToken;
        if (!result.ok && email) {
          const fallbackToken = await getSavedRefreshToken(db, email);
          if (fallbackToken && fallbackToken !== refreshToken) {
            result = await exchange(fallbackToken);
            usedRefresh = fallbackToken;
          }
        }
        if (!result.ok) {
          return json(
            req,
            { error: result.data.error_description || result.data.error || 'Sesión de Google Drive expirada' },
            401
          );
        }
        const finalRefresh = String(result.data.refresh_token || usedRefresh).trim();
        if (email && finalRefresh) {
          await saveRefreshToken(db, email, finalRefresh);
        }
        return json(req, {
          ok: true,
          accessToken: result.data.access_token,
          refreshToken: finalRefresh,
          expiresAt: Date.now() + Math.max(300, Number(result.data.expires_in || 3600) - 120) * 1000,
        });
      }

      /* ===== SHARED READING ROOMS (KOMO-XXXX) ===== */

      if (method === 'GET' && pathname === '/api/rooms') {
        if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
        const participantId = (url.searchParams.get('participantId') || '').trim();
        const resRows = await db.prepare('SELECT data FROM rooms ORDER BY updated_at DESC LIMIT 60').all();
        let list = (resRows.results || []).map((r) => JSON.parse(r.data));
        if (participantId) {
          list = list.filter((rm) => rm?.participants && rm.participants[participantId]);
        }
        return json(req, { rooms: list });
      }

      if (method === 'POST' && pathname === '/api/rooms') {
        if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
        const body = await req.json().catch(() => ({}));
        const { book, participant } = body;
        if (!book?.id || !book?.title) {
          return json(req, { error: 'Faltan los datos del libro para crear la sala' }, 400);
        }
        let code = randomCode('KOMO');
        for (let i = 0; i < 6; i++) {
          const exists = await getRoom(db, code);
          if (!exists) break;
          code = randomCode('KOMO');
        }
        const now = Date.now();
        const hostSpaceId = getRequestSpaceId(req, url, body);
        const pId = String(participant?.id || `user_${now}`).slice(0, 64);
        const room = {
          code,
          hostSpaceId,
          bookId: book.id,
          bookMeta: {
            id: book.id,
            title: book.title,
            author: book.author || 'Desconocido',
            description: book.description || '',
            format: book.format || 'epub',
            kind: book.kind || 'book',
            categories: Array.isArray(book.categories) ? book.categories : [],
            tags: Array.isArray(book.tags) ? book.tags : [],
            coverDataUrl: book.coverDataUrl || '',
            hasOriginalCover: Boolean(book.hasOriginalCover),
            spineColor: book.spineColor || '#4c6c8a',
            ribbonColor: book.ribbonColor || '#f2ba59',
            fileName: book.fileName || `${book.id}.${book.format || 'epub'}`,
            fileSize: book.fileSize || 0,
            mimeType: book.mimeType || 'application/octet-stream',
            pageCount: book.pageCount,
            hasRemoteFile: Boolean(book.hasRemoteFile),
            remoteFileName: book.remoteFileName || '',
            sharedAnnotations: Array.isArray(book.sharedAnnotations) ? book.sharedAnnotations.slice(0, 400) : [],
            sharedBookmarks: Array.isArray(book.sharedBookmarks) ? book.sharedBookmarks.slice(0, 150) : [],
          },
          hostId: pId,
          hostName: participant?.name || 'Lector Komo',
          createdAt: now,
          updatedAt: now,
          participants: {
            [pId]: {
              id: pId,
              name: participant?.name || 'Lector Komo',
              avatarEmoji: participant?.avatarEmoji || '🦊',
              avatarBg: participant?.avatarBg || '#f6d8ae',
              avatarImageUrl: sanitizeAvatarUrl(participant?.avatarImageUrl),
              progress: Number(participant?.progress ?? book.progress ?? 0),
              currentPage: participant?.currentPage ?? book.currentPage ?? 1,
              pageCount: book.pageCount,
              readingStatus: participant?.readingStatus || book.readingStatus || 'reading',
              joinedAt: now,
              lastSeenAt: now,
            },
          },
          comments: [],
        };
        await putRoom(db, room);
        return json(req, { ok: true, room });
      }

      const roomMatch = pathname.match(/^\/api\/rooms\/([^/]+)(?:\/(restore|join|progress|comments|file|leave|kick|stream))?$/);
      if (roomMatch) {
        const code = normalizeCode(decodeURIComponent(roomMatch[1]));
        const action = roomMatch[2] || '';

        if (method === 'GET' && !action) {
          const room = await getRoom(db, code);
          if (!room) {
            if (await isRoomDeleted(db, code)) {
              return json(req, { error: 'Esta sala fue cerrada', deleted: true }, 410);
            }
            return json(req, { error: 'Sala no encontrada' }, 404);
          }
          return json(req, { ok: true, room });
        }

        if (method === 'PUT' && action === 'restore') {
          if (await isRoomDeleted(db, code)) {
            return json(req, { error: 'Esta sala ya fue cerrada', deleted: true }, 410);
          }
          const body = await req.json().catch(() => ({}));
          const incoming = body?.room;
          if (!incoming || !incoming.bookId || !incoming.bookMeta?.title) {
            return json(req, { error: 'Faltan los datos de la sala para restaurarla' }, 400);
          }
          const now = Date.now();
          const existing = await getRoom(db, code);
          const sanitizeP = (id, p) => ({
            id: String(p?.id || id).slice(0, 64),
            name: String(p?.name || 'Lector Komo').slice(0, 40),
            avatarEmoji: p?.avatarEmoji || '🦊',
            avatarBg: p?.avatarBg || '#f6d8ae',
            avatarImageUrl: sanitizeAvatarUrl(p?.avatarImageUrl),
            progress: Math.max(0, Math.min(100, Number(p?.progress || 0))),
            currentPage: p?.currentPage !== undefined ? Number(p.currentPage) : undefined,
            pageCount: p?.pageCount !== undefined ? Number(p.pageCount) : incoming.bookMeta?.pageCount,
            readingStatus: p?.readingStatus || (Number(p?.progress || 0) >= 98 ? 'completed' : 'reading'),
            joinedAt: Number(p?.joinedAt || now),
            lastSeenAt: Number(p?.lastSeenAt || now),
          });

          if (existing) {
            const kickedSet = new Set(Array.isArray(existing.kickedIds) ? existing.kickedIds : []);
            existing.participants = existing.participants || {};
            for (const [rawId, p] of Object.entries(incoming.participants || {})) {
              const pId = String(p?.id || rawId).slice(0, 64);
              if (!pId || kickedSet.has(pId)) continue;
              const prev = existing.participants[pId];
              if (!prev) {
                existing.participants[pId] = sanitizeP(pId, p);
              } else if ((Number(p?.lastSeenAt) || 0) > (Number(prev.lastSeenAt) || 0)) {
                existing.participants[pId] = { ...prev, ...sanitizeP(pId, p), joinedAt: prev.joinedAt || now };
              }
            }
            const cMap = new Map();
            for (const c of [...(existing.comments || []), ...(incoming.comments || [])]) {
              if (c?.id) cMap.set(c.id, c);
            }
            existing.comments = Array.from(cMap.values())
              .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
              .slice(-300);
            existing.updatedAt = Math.max(existing.updatedAt || 0, now);
            await putRoom(db, existing);
            return json(req, { ok: true, room: existing, restored: false });
          }

          const participants = {};
          for (const [rawId, p] of Object.entries(incoming.participants || {})) {
            const pId = String(p?.id || rawId).slice(0, 64);
            if (pId) participants[pId] = sanitizeP(pId, p);
          }
          const restored = {
            ...incoming,
            code,
            participants,
            comments: Array.isArray(incoming.comments) ? incoming.comments.slice(-300) : [],
            kickedIds: Array.isArray(incoming.kickedIds) ? incoming.kickedIds.slice(-50) : [],
            updatedAt: now,
          };
          await putRoom(db, restored);
          return json(req, { ok: true, room: restored, restored: true });
        }

        if (method === 'POST' && action === 'join') {
          const room = await getRoom(db, code);
          if (!room) {
            if (await isRoomDeleted(db, code)) {
              return json(req, { error: 'Esta sala fue cerrada', deleted: true }, 410);
            }
            return json(req, { error: 'Código de sala no encontrado' }, 404);
          }
          const body = await req.json().catch(() => ({}));
          const p = body?.participant || {};
          const now = Date.now();
          const pId = String(p.id || `guest_${now}_${Math.random().toString(36).slice(2, 6)}`).slice(0, 64);
          room.participants = room.participants || {};
          const prev = room.participants[pId];
          room.participants[pId] = {
            id: pId,
            name: String(p.name || prev?.name || 'Lector invitado').slice(0, 40),
            avatarEmoji: p.avatarEmoji || prev?.avatarEmoji || '🦉',
            avatarBg: p.avatarBg || prev?.avatarBg || '#e8dccb',
            avatarImageUrl:
              p.avatarImageUrl !== undefined ? sanitizeAvatarUrl(p.avatarImageUrl) : prev?.avatarImageUrl || '',
            progress: prev ? prev.progress : Number(p.progress || 0),
            currentPage: prev ? prev.currentPage : p.currentPage,
            pageCount: room.bookMeta?.pageCount,
            readingStatus: prev ? prev.readingStatus : p.readingStatus || 'reading',
            joinedAt: prev?.joinedAt || now,
            lastSeenAt: now,
          };
          if (Array.isArray(room.kickedIds)) {
            room.kickedIds = room.kickedIds.filter((id) => id !== pId);
          }
          room.updatedAt = now;
          await putRoom(db, room);
          return json(req, { ok: true, room });
        }

        if (method === 'PATCH' && action === 'progress') {
          const room = await getRoom(db, code);
          if (!room) return json(req, { error: 'Sala no encontrada' }, 404);
          const body = await req.json().catch(() => ({}));
          const pId = String(body?.participantId || '').slice(0, 64);
          if (!pId) return json(req, { error: 'participantId requerido' }, 400);
          if (Array.isArray(room.kickedIds) && room.kickedIds.includes(pId)) {
            return json(req, { error: 'Fuiste eliminado de esta sala' }, 403);
          }
          const now = Date.now();
          const prev = room.participants?.[pId] || {
            id: pId,
            name: body.name || 'Lector',
            avatarEmoji: body.avatarEmoji || '📚',
            avatarBg: body.avatarBg || '#e8dccb',
            joinedAt: now,
          };
          const pct = Math.max(0, Math.min(100, Number(body.progress ?? prev.progress ?? 0)));
          room.participants = room.participants || {};
          room.participants[pId] = {
            ...prev,
            name: body.name ? String(body.name).slice(0, 40) : prev.name,
            avatarEmoji: body.avatarEmoji || prev.avatarEmoji,
            avatarBg: body.avatarBg || prev.avatarBg,
            avatarImageUrl:
              body.avatarImageUrl !== undefined
                ? sanitizeAvatarUrl(body.avatarImageUrl)
                : prev.avatarImageUrl || '',
            progress: pct,
            currentPage: body.currentPage !== undefined ? Number(body.currentPage) : prev.currentPage,
            pageCount: body.pageCount !== undefined ? Number(body.pageCount) : prev.pageCount,
            readingStatus: body.readingStatus || (pct >= 98 ? 'completed' : 'reading'),
            lastSeenAt: now,
          };
          room.updatedAt = now;
          await putRoom(db, room);
          return json(req, { ok: true, room });
        }

        if (method === 'POST' && action === 'comments') {
          const room = await getRoom(db, code);
          if (!room) return json(req, { error: 'Sala no encontrada' }, 404);
          const body = await req.json().catch(() => ({}));
          const text = String(body?.text || '').trim().slice(0, 600);
          if (!text) return json(req, { error: 'Comentario vacío' }, 400);
          const authorId = String(body?.participantId || 'anon').slice(0, 64);
          if (Array.isArray(room.kickedIds) && room.kickedIds.includes(authorId)) {
            return json(req, { error: 'Fuiste eliminado de esta sala' }, 403);
          }
          const now = Date.now();
          const comment = {
            id: `rc_${now}_${Math.random().toString(36).slice(2, 6)}`,
            participantId: authorId,
            authorId,
            authorName: String(body?.authorName || 'Lector').slice(0, 40),
            avatarEmoji: body?.avatarEmoji || '💬',
            avatarImageUrl: sanitizeAvatarUrl(body?.avatarImageUrl),
            text,
            progressAt: Math.max(0, Math.min(100, Number(body?.progressAt || 0))),
            pageAt: body?.pageAt !== undefined ? Number(body.pageAt) : undefined,
            createdAt: now,
          };
          room.comments = [...(room.comments || []), comment].slice(-300);
          room.updatedAt = now;
          await putRoom(db, room);
          return json(req, { ok: true, room, comment });
        }

        if (method === 'GET' && action === 'file') {
          const room = await getRoom(db, code);
          if (!room) return json(req, { error: 'Sala no encontrada' }, 404);
          const fileKey = room.bookMeta?.remoteFileName || `book_${room.hostSpaceId || 'default'}__${room.bookId}`;
          return serveBinaryFile(req, db, fileKey);
        }

        if (method === 'POST' && action === 'leave') {
          const room = await getRoom(db, code);
          if (!room) return json(req, { ok: true });
          const body = await req.json().catch(() => ({}));
          const pId = String(body?.participantId || '').slice(0, 64);
          if (pId && room.participants?.[pId]) {
            delete room.participants[pId];
            room.updatedAt = Date.now();
            await putRoom(db, room);
          }
          return json(req, { ok: true });
        }

        if (method === 'POST' && action === 'kick') {
          const room = await getRoom(db, code);
          if (!room) return json(req, { error: 'Sala no encontrada' }, 404);
          const body = await req.json().catch(() => ({}));
          const requesterId = String(body?.requesterId || '').slice(0, 64);
          const targetId = String(body?.targetParticipantId || '').slice(0, 64);
          if (!requesterId || requesterId !== room.hostId) {
            return json(req, { error: 'Solo el anfitrión puede eliminar miembros' }, 403);
          }
          if (!targetId || targetId === room.hostId) {
            return json(req, { error: 'No puedes eliminar al anfitrión' }, 400);
          }
          if (room.participants?.[targetId]) delete room.participants[targetId];
          room.kickedIds = Array.from(new Set([...(room.kickedIds || []), targetId])).slice(-50);
          room.updatedAt = Date.now();
          await putRoom(db, room);
          return json(req, { ok: true, room });
        }

        if (method === 'DELETE' && !action) {
          if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
          await db.batch([
            db.prepare('DELETE FROM rooms WHERE code = ?').bind(code),
            db.prepare('INSERT OR REPLACE INTO deleted_rooms (code, deleted_at) VALUES (?, ?)').bind(code, Date.now()),
          ]);
          return json(req, { ok: true });
        }
      }

      /* ===== SHARED MUTUAL SHELVES (SHELF-XXXX) ===== */

      if (method === 'GET' && pathname === '/api/shelves') {
        if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
        const memberId = (url.searchParams.get('memberId') || '').trim();
        const resRows = await db.prepare('SELECT data FROM shelves ORDER BY updated_at DESC LIMIT 60').all();
        let list = (resRows.results || []).map((r) => JSON.parse(r.data));
        if (memberId) {
          list = list.filter((sh) => sh?.members && sh.members[memberId]);
        }
        return json(req, { shelves: list });
      }

      if (method === 'POST' && pathname === '/api/shelves') {
        if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
        const body = await req.json().catch(() => ({}));
        const { title, member } = body;
        let code = randomCode('SHELF');
        for (let i = 0; i < 6; i++) {
          const exists = await getShelf(db, code);
          if (!exists) break;
          code = randomCode('SHELF');
        }
        const now = Date.now();
        const mId = String(member?.id || `user_${now}`).slice(0, 64);
        const shelf = {
          code,
          title: String(title || `Estantería de ${member?.name || 'Lector'}`).slice(0, 80),
          hostId: mId,
          hostName: String(member?.name || 'Lector Komo').slice(0, 40),
          createdAt: now,
          updatedAt: now,
          members: {
            [mId]: {
              id: mId,
              name: String(member?.name || 'Lector Komo').slice(0, 40),
              avatarEmoji: member?.avatarEmoji || '🦊',
              avatarBg: member?.avatarBg || '#f6d8ae',
              avatarImageUrl: sanitizeAvatarUrl(member?.avatarImageUrl),
              joinedAt: now,
            },
          },
          books: {},
        };
        await putShelf(db, shelf);
        return json(req, { ok: true, shelf });
      }

      const shelfBookFileMatch = pathname.match(/^\/api\/shelves\/([^/]+)\/books\/([^/]+)\/file$/);
      if (shelfBookFileMatch && method === 'GET') {
        const code = normalizeCode(decodeURIComponent(shelfBookFileMatch[1]));
        const bookId = decodeURIComponent(shelfBookFileMatch[2]).replace(/[^a-zA-Z0-9_-]/g, '');
        const shelf = await getShelf(db, code);
        const entry = shelf?.books?.[bookId];
        if (!entry?.remoteFileName) return json(req, { error: 'Archivo compartido no disponible' }, 404);
        return serveBinaryFile(req, db, entry.remoteFileName);
      }

      const shelfBookDelMatch = pathname.match(/^\/api\/shelves\/([^/]+)\/books\/([^/]+)$/);
      if (shelfBookDelMatch && method === 'DELETE') {
        const code = normalizeCode(decodeURIComponent(shelfBookDelMatch[1]));
        const bookId = decodeURIComponent(shelfBookDelMatch[2]).replace(/[^a-zA-Z0-9_-]/g, '');
        const shelf = await getShelf(db, code);
        if (!shelf) return json(req, { error: 'Estantería no encontrada' }, 404);
        const entry = shelf.books?.[bookId];
        if (entry?.remoteFileName) await deleteBinaryFile(db, entry.remoteFileName);
        if (shelf.books) delete shelf.books[bookId];
        shelf.updatedAt = Date.now();
        await putShelf(db, shelf);
        return json(req, { ok: true, shelf });
      }

      const shelfMatch = pathname.match(/^\/api\/shelves\/([^/]+)(?:\/(restore|join|books|leave|kick|stream))?$/);
      if (shelfMatch) {
        const code = normalizeCode(decodeURIComponent(shelfMatch[1]));
        const action = shelfMatch[2] || '';

        if (method === 'GET' && !action) {
          const shelf = await getShelf(db, code);
          if (!shelf) {
            if (await isShelfDeleted(db, code)) {
              return json(req, { error: 'Esta estantería fue cerrada', deleted: true }, 410);
            }
            return json(req, { error: 'Estantería compartida no encontrada' }, 404);
          }
          return json(req, { ok: true, shelf });
        }

        if (method === 'PUT' && action === 'restore') {
          if (await isShelfDeleted(db, code)) {
            return json(req, { error: 'Esta estantería ya fue cerrada', deleted: true }, 410);
          }
          const body = await req.json().catch(() => ({}));
          const incoming = body?.shelf;
          if (!incoming || !incoming.title) {
            return json(req, { error: 'Faltan los datos de la estantería para restaurarla' }, 400);
          }
          const now = Date.now();
          const existing = await getShelf(db, code);
          if (existing) {
            const kickedSet = new Set(Array.isArray(existing.kickedIds) ? existing.kickedIds : []);
            existing.members = existing.members || {};
            for (const [rawId, m] of Object.entries(incoming.members || {})) {
              const mId = String(m?.id || rawId).slice(0, 64);
              if (!mId || kickedSet.has(mId) || existing.members[mId]) continue;
              existing.members[mId] = {
                id: mId,
                name: String(m?.name || 'Lector Komo').slice(0, 40),
                avatarEmoji: m?.avatarEmoji || '🦊',
                avatarBg: m?.avatarBg || '#f6d8ae',
                avatarImageUrl: sanitizeAvatarUrl(m?.avatarImageUrl),
                joinedAt: Number(m?.joinedAt || now),
              };
            }
            existing.books = { ...(incoming.books || {}), ...(existing.books || {}) };
            existing.updatedAt = Math.max(existing.updatedAt || 0, now);
            await putShelf(db, existing);
            return json(req, { ok: true, shelf: existing, restored: false });
          }
          const restored = { ...incoming, code, updatedAt: now };
          await putShelf(db, restored);
          return json(req, { ok: true, shelf: restored, restored: true });
        }

        if (method === 'POST' && action === 'join') {
          const shelf = await getShelf(db, code);
          if (!shelf) {
            if (await isShelfDeleted(db, code)) {
              return json(req, { error: 'Esta estantería fue cerrada', deleted: true }, 410);
            }
            return json(req, { error: 'Código de estantería no encontrado' }, 404);
          }
          const body = await req.json().catch(() => ({}));
          const m = body?.member || {};
          const now = Date.now();
          const mId = String(m.id || `guest_${now}_${Math.random().toString(36).slice(2, 6)}`).slice(0, 64);
          shelf.members = shelf.members || {};
          const prev = shelf.members[mId];
          shelf.members[mId] = {
            id: mId,
            name: String(m.name || prev?.name || 'Lector invitado').slice(0, 40),
            avatarEmoji: m.avatarEmoji || prev?.avatarEmoji || '🦉',
            avatarBg: m.avatarBg || prev?.avatarBg || '#e8dccb',
            avatarImageUrl:
              m.avatarImageUrl !== undefined ? sanitizeAvatarUrl(m.avatarImageUrl) : prev?.avatarImageUrl || '',
            joinedAt: prev?.joinedAt || now,
          };
          if (Array.isArray(shelf.kickedIds)) {
            shelf.kickedIds = shelf.kickedIds.filter((id) => id !== mId);
          }
          shelf.updatedAt = now;
          await putShelf(db, shelf);
          return json(req, { ok: true, shelf });
        }

        if (method === 'POST' && action === 'books') {
          const shelf = await getShelf(db, code);
          if (!shelf) return json(req, { error: 'Estantería compartida no encontrada' }, 404);

          const form = await req.formData();
          let book = {};
          const metaStr = form.get('meta');
          if (typeof metaStr === 'string' && metaStr.trim()) {
            try { book = JSON.parse(metaStr); } catch { /* ignore */ }
          }
          const rawBookId = String(form.get('bookId') || book.id || book.bookId || `sb_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '');
          if (!book.title) return json(req, { error: 'Falta el título del libro a compartir' }, 400);

          const ownerId = String(form.get('ownerId') || book.ownerId || 'anon').slice(0, 64);
          if (Array.isArray(shelf.kickedIds) && shelf.kickedIds.includes(ownerId)) {
            return json(req, { error: 'Fuiste eliminado de esta estantería' }, 403);
          }
          const ownerName = String(form.get('ownerName') || book.ownerName || 'Lector').slice(0, 40);
          const key = `${ownerId}_${rawBookId}`.slice(0, 96);
          const fileEntry = form.get('file');
          let remoteFileName = book.remoteFileName || '';
          let fileSize = book.fileSize || 0;
          let mimeType = book.mimeType || 'application/octet-stream';

          if (fileEntry && typeof fileEntry === 'object' && typeof fileEntry.arrayBuffer === 'function') {
            const bytes = new Uint8Array(await fileEntry.arrayBuffer());
            remoteFileName = `shelf_${code}_${key}`;
            fileSize = bytes.byteLength;
            mimeType = fileEntry.type || mimeType;
            await saveBinaryFile(db, remoteFileName, fileEntry.name || book.fileName || `${rawBookId}.${book.format || 'epub'}`, mimeType, bytes);
          }

          const now = Date.now();
          shelf.books = shelf.books || {};
          shelf.books[key] = {
            bookId: key,
            ownerId,
            ownerName,
            title: String(book.title).slice(0, 140),
            author: String(book.author || 'Desconocido').slice(0, 80),
            description: String(book.description || '').slice(0, 600),
            format: book.format || 'epub',
            kind: book.kind || 'book',
            categories: Array.isArray(book.categories) ? book.categories : [],
            tags: Array.isArray(book.tags) ? book.tags : [],
            coverDataUrl: typeof book.coverDataUrl === 'string' ? book.coverDataUrl : '',
            hasOriginalCover: Boolean(book.hasOriginalCover),
            spineColor: book.spineColor || '#4c6c8a',
            ribbonColor: book.ribbonColor || '#f2ba59',
            fileName: book.fileName || `${rawBookId}.${book.format || 'epub'}`,
            folderPath: typeof book.folderPath === 'string' && book.folderPath.trim() ? book.folderPath.trim().slice(0, 260) : undefined,
            fileSize,
            mimeType,
            pageCount: book.pageCount,
            hasRemoteFile: Boolean(remoteFileName),
            remoteFileName,
            sharedAnnotations: Array.isArray(book.sharedAnnotations) ? book.sharedAnnotations.slice(0, 400) : [],
            sharedBookmarks: Array.isArray(book.sharedBookmarks) ? book.sharedBookmarks.slice(0, 150) : [],
            sharedAt: now,
          };
          shelf.updatedAt = now;
          await putShelf(db, shelf);
          return json(req, { ok: true, shelf, entry: shelf.books[key] });
        }

        if (method === 'POST' && action === 'leave') {
          const shelf = await getShelf(db, code);
          if (!shelf) return json(req, { ok: true });
          const body = await req.json().catch(() => ({}));
          const mId = String(body?.memberId || '').slice(0, 64);
          if (mId && shelf.members?.[mId]) {
            delete shelf.members[mId];
            shelf.updatedAt = Date.now();
            await putShelf(db, shelf);
          }
          return json(req, { ok: true });
        }

        if (method === 'POST' && action === 'kick') {
          const shelf = await getShelf(db, code);
          if (!shelf) return json(req, { error: 'Estantería no encontrada' }, 404);
          const body = await req.json().catch(() => ({}));
          const requesterId = String(body?.requesterId || '').slice(0, 64);
          const targetId = String(body?.targetMemberId || '').slice(0, 64);
          if (!requesterId || requesterId !== shelf.hostId) {
            return json(req, { error: 'Solo el anfitrión puede eliminar miembros' }, 403);
          }
          if (!targetId || targetId === shelf.hostId) {
            return json(req, { error: 'No puedes eliminar al anfitrión' }, 400);
          }
          if (shelf.members?.[targetId]) delete shelf.members[targetId];
          shelf.kickedIds = Array.from(new Set([...(shelf.kickedIds || []), targetId])).slice(-50);
          shelf.updatedAt = Date.now();
          await putShelf(db, shelf);
          return json(req, { ok: true, shelf });
        }

        if (method === 'DELETE' && !action) {
          if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
          const shelf = await getShelf(db, code);
          if (shelf?.books) {
            for (const entry of Object.values(shelf.books)) {
              if (entry?.remoteFileName) await deleteBinaryFile(db, entry.remoteFileName);
            }
          }
          await db.batch([
            db.prepare('DELETE FROM shelves WHERE code = ?').bind(code),
            db.prepare('INSERT OR REPLACE INTO deleted_shelves (code, deleted_at) VALUES (?, ?)').bind(code, Date.now()),
          ]);
          return json(req, { ok: true });
        }
      }

      /* ===== LIVE PROFILE PROPAGATION ACROSS ALL SHARED ROOMS & SHELVES ===== */

      if (method === 'PATCH' && pathname === '/api/shared/profile') {
        if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
        const body = await req.json().catch(() => ({}));
        const rawIds = Array.isArray(body?.participantIds)
          ? body.participantIds
          : body?.participantId
          ? [body.participantId]
          : [];
        const idList = Array.from(
          new Set(rawIds.map((id) => String(id || '').trim().slice(0, 64)).filter(Boolean))
        );
        if (idList.length === 0) {
          return json(req, { error: 'participantIds requerido' }, 400);
        }
        const idSet = new Set(idList);
        const nextName =
          typeof body?.name === 'string' && body.name.trim()
            ? body.name.trim().slice(0, 40)
            : undefined;
        const nextEmoji =
          typeof body?.avatarEmoji === 'string' && body.avatarEmoji.trim()
            ? body.avatarEmoji.trim().slice(0, 12)
            : undefined;
        const nextBg =
          typeof body?.avatarBg === 'string' && body.avatarBg.trim()
            ? body.avatarBg.trim().slice(0, 32)
            : undefined;
        const hasAvatarUrl = body?.avatarImageUrl !== undefined;
        const nextAvatarUrl = hasAvatarUrl ? sanitizeAvatarUrl(body.avatarImageUrl) : undefined;
        const now = Date.now();

        const updatedRooms = [];
        const roomRows = await db.prepare('SELECT data FROM rooms ORDER BY updated_at DESC LIMIT 120').all();
        for (const row of roomRows.results || []) {
          let room;
          try {
            room = JSON.parse(row.data);
          } catch {
            continue;
          }
          if (!room?.code) continue;
          let changed = false;
          room.participants = room.participants || {};
          for (const pid of idList) {
            const prev = room.participants[pid];
            if (prev) {
              room.participants[pid] = {
                ...prev,
                ...(nextName ? { name: nextName } : {}),
                ...(nextEmoji ? { avatarEmoji: nextEmoji } : {}),
                ...(nextBg ? { avatarBg: nextBg } : {}),
                ...(hasAvatarUrl ? { avatarImageUrl: nextAvatarUrl } : {}),
              };
              changed = true;
            }
          }
          if (idSet.has(room.hostId) && nextName && room.hostName !== nextName) {
            room.hostName = nextName;
            changed = true;
          }
          if (Array.isArray(room.comments)) {
            for (let i = 0; i < room.comments.length; i++) {
              const c = room.comments[i];
              const cPid = c?.participantId || c?.authorId;
              if (cPid && idSet.has(cPid)) {
                room.comments[i] = {
                  ...c,
                  participantId: cPid,
                  ...(nextName ? { authorName: nextName } : {}),
                  ...(nextEmoji ? { avatarEmoji: nextEmoji } : {}),
                  ...(hasAvatarUrl ? { avatarImageUrl: nextAvatarUrl } : {}),
                };
                changed = true;
              }
            }
          }
          if (changed) {
            room.updatedAt = now;
            await putRoom(db, room);
            updatedRooms.push(room);
          }
        }

        const updatedShelves = [];
        const shelfRows = await db.prepare('SELECT data FROM shelves ORDER BY updated_at DESC LIMIT 120').all();
        for (const row of shelfRows.results || []) {
          let shelf;
          try {
            shelf = JSON.parse(row.data);
          } catch {
            continue;
          }
          if (!shelf?.code) continue;
          let changed = false;
          shelf.members = shelf.members || {};
          for (const mid of idList) {
            const prev = shelf.members[mid];
            if (prev) {
              shelf.members[mid] = {
                ...prev,
                ...(nextName ? { name: nextName } : {}),
                ...(nextEmoji ? { avatarEmoji: nextEmoji } : {}),
                ...(nextBg ? { avatarBg: nextBg } : {}),
                ...(hasAvatarUrl ? { avatarImageUrl: nextAvatarUrl } : {}),
              };
              changed = true;
            }
          }
          if (idSet.has(shelf.hostId) && nextName && shelf.hostName !== nextName) {
            shelf.hostName = nextName;
            changed = true;
          }
          if (shelf.books && typeof shelf.books === 'object' && nextName) {
            for (const key of Object.keys(shelf.books)) {
              const entry = shelf.books[key];
              if (entry && idSet.has(entry.ownerId) && entry.ownerName !== nextName) {
                shelf.books[key] = { ...entry, ownerName: nextName };
                changed = true;
              }
            }
          }
          if (changed) {
            shelf.updatedAt = now;
            await putShelf(db, shelf);
            updatedShelves.push(shelf);
          }
        }

        return json(req, { ok: true, rooms: updatedRooms, shelves: updatedShelves });
      }

      /* ===== BOOK BINARY UPLOAD/DOWNLOAD (FOR SHARED ROOMS & SYNC) ===== */

      if (method === 'POST' && pathname === '/api/books/upload') {
        if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
        const form = await req.formData();
        const fileEntry = form.get('file');
        if (!fileEntry || typeof fileEntry !== 'object' || typeof fileEntry.arrayBuffer !== 'function') {
          return json(req, { error: 'Archivo requerido' }, 400);
        }
        const safeId = String(form.get('id') || `book_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '');
        const spaceId = getRequestSpaceId(req, url, null);
        const fileKey = `book_${spaceId}__${safeId}`;
        const bytes = new Uint8Array(await fileEntry.arrayBuffer());
        await saveBinaryFile(db, fileKey, fileEntry.name || `${safeId}.bin`, fileEntry.type || 'application/octet-stream', bytes);
        return json(req, { ok: true, id: safeId, remoteFileName: fileKey, size: bytes.byteLength });
      }

      const bookFileMatch = pathname.match(/^\/api\/books\/([^/]+)\/file$/);
      if (bookFileMatch && method === 'GET') {
        if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
        const safeId = decodeURIComponent(bookFileMatch[1]).replace(/[^a-zA-Z0-9_-]/g, '');
        const spaceId = getRequestSpaceId(req, url, null);
        return serveBinaryFile(req, db, `book_${spaceId}__${safeId}`);
      }

      const bookDelMatch = pathname.match(/^\/api\/books\/([^/]+)$/);
      if (bookDelMatch && method === 'DELETE') {
        if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
        const safeId = decodeURIComponent(bookDelMatch[1]).replace(/[^a-zA-Z0-9_-]/g, '');
        const spaceId = getRequestSpaceId(req, url, null);
        await deleteBinaryFile(db, `book_${spaceId}__${safeId}`);
        return json(req, { ok: true });
      }

      /* ===== EMAIL-ONLY CLOUD SYNC STATE FALLBACK ===== */

      if (pathname === '/api/sync/state') {
        if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
        if (method === 'GET') {
          const spaceId = getRequestSpaceId(req, url, null);
          const row = await db.prepare('SELECT data FROM sync_spaces WHERE space_id = ?').bind(spaceId).first();
          return json(req, row ? JSON.parse(row.data) : emptyState());
        }
        if (method === 'PUT') {
          const body = await req.json().catch(() => ({}));
          const spaceId = getRequestSpaceId(req, url, body);
          const row = await db.prepare('SELECT data FROM sync_spaces WHERE space_id = ?').bind(spaceId).first();
          const current = row ? JSON.parse(row.data) : emptyState();
          const next = mergeStates(current, body);
          await db
            .prepare('INSERT OR REPLACE INTO sync_spaces (space_id, data, updated_at) VALUES (?, ?, ?)')
            .bind(spaceId, JSON.stringify(next), next.updatedAt)
            .run();
          if (url.searchParams.get('partial') === '1') {
            return json(req, { ok: true, partial: true, updatedAt: next.updatedAt });
          }
          return json(req, next);
        }
      }

      /* ===== GEMINI AI ASSISTANT PROXY ===== */

      if (method === 'POST' && pathname === '/api/ai/chat') {
        if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
        const apiKey = (env.GEMINI_API_KEY || '').trim();
        const model = (env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
        if (!apiKey) return json(req, { error: 'GEMINI_API_KEY no configurada en Cloudflare' }, 503);

        const body = await req.json().catch(() => ({}));
        const message = String(body?.message || '').trim();
        if (!message) return json(req, { error: 'Mensaje vacío' }, 400);

        const booksList = Array.isArray(body.books) ? body.books : [];
        const booksSummary = booksList
          .slice(0, 50)
          .map((b) => {
            const ratingTxt = b.rating ? `, ${b.rating}/5` : '';
            const statusTxt = b.readingStatus ? `, estado ${b.readingStatus}` : '';
            const reviewTxt = b.review ? `, reseña: "${String(b.review).slice(0, 80)}"` : '';
            return `• "${b.title}" por ${b.author || 'Desconocido'} (${b.kind || 'book'}, ${b.progress || 0}%${statusTxt}${ratingTxt}${reviewTxt})`;
          })
          .join('\n');

        const notesSummary = (Array.isArray(body.notes) ? body.notes : [])
          .slice(0, 10)
          .map((n) => `• ${n.bookTitle || 'Libro'}: ${String(n.text || '').slice(0, 120)}`)
          .join('\n');

        const annotationsSummary = (Array.isArray(body.annotations) ? body.annotations : [])
          .slice(0, 15)
          .map(
            (a) =>
              `• [${a.bookTitle || 'Libro'}${a.chapter ? ` · ${a.chapter}` : ''}] "${String(a.quote || '').slice(0, 140)}"${
                a.note ? ` (Nota: ${String(a.note).slice(0, 80)})` : ''
              }`
          )
          .join('\n');

        const aiProf = body.aiProfile && typeof body.aiProfile === 'object' ? body.aiProfile : null;
        const styleGuide =
          aiProf?.preferredStyle === 'concise'
            ? 'Responde de forma breve, directa y muy clara (máximo 3 a 5 líneas o 3 puntos cortos).'
            : aiProf?.preferredStyle === 'detailed'
            ? 'Responde con buen nivel de detalle, bien organizado en párrafos cortos y claros.'
            : 'Responde de forma equilibrada, clara y natural, sin relleno.';
        const spoilerRule =
          aiProf?.avoidSpoilers === false
            ? 'Puedes incluir spoilers solo si la consulta lo pide.'
            : 'Evita spoilers de trama a menos que te los pidan explícitamente.';
        const learnedParts = [];
        if (Array.isArray(aiProf?.likedTopics) && aiProf.likedTopics.length) {
          learnedParts.push(`Temas/géneros preferidos: ${aiProf.likedTopics.slice(0, 8).join(', ')}.`);
        }
        if (Array.isArray(aiProf?.dislikedTopics) && aiProf.dislikedTopics.length) {
          learnedParts.push(`Evitar recomendar: ${aiProf.dislikedTopics.slice(0, 8).join(', ')}.`);
        }
        if (Array.isArray(aiProf?.learnedNotes) && aiProf.learnedNotes.length) {
          learnedParts.push(`Preferencias aprendidas: ${aiProf.learnedNotes.slice(0, 6).join(' | ')}`);
        }
        if (typeof body.tasteSummary === 'string' && body.tasteSummary.trim()) {
          learnedParts.push(`Patrón real de lectura: ${body.tasteSummary.trim().slice(0, 400)}`);
        }
        const activeBookLine = body.activeBook?.title
          ? `Libro abierto actualmente: "${body.activeBook.title}" de ${body.activeBook.author || 'Desconocido'} (${body.activeBook.progress || 0}%).\n`
          : '';

        const systemPrompt =
          `Eres el asistente literario personal de KomoLib para ${body.profileName || 'quien lee'}. Responde siempre en español natural y cercano.\n` +
          `REGLAS ESTRICTAS DE FORMATO:\n` +
          `- NUNCA uses asteriscos (*, **, ***) ni almohadillas (#) ni sintaxis Markdown cruda.\n` +
          `- Escribe texto limpio con párrafos cortos. Si haces una lista, usa viñetas con "• " o numeración "1. ", "2. ".\n` +
          `- ${styleGuide}\n` +
          `- ${spoilerRule}\n` +
          `- No inventes títulos que no estén en su biblioteca cuando te pregunten qué tiene guardado.\n` +
          (learnedParts.length ? `\nPerfil aprendido del usuario:\n${learnedParts.join('\n')}\n` : '') +
          (activeBookLine ? `\n${activeBookLine}` : '') +
          (booksSummary ? `\nBiblioteca actual:\n${booksSummary}\n` : '') +
          (annotationsSummary ? `\nFrases marcadas / Post-its:\n${annotationsSummary}\n` : '') +
          (notesSummary ? `\nNotas recientes:\n${notesSummary}\n` : '');

        const contents = [];
        for (const h of (Array.isArray(body.history) ? body.history : []).slice(-10)) {
          if (h?.text) {
            contents.push({ role: h.sender === 'user' ? 'user' : 'model', parts: [{ text: String(h.text).slice(0, 1200) }] });
          }
        }
        contents.push({ role: 'user', parts: [{ text: message }] });

        const chatModelChain = Array.from(new Set([model, 'gemini-2.5-flash-lite']));
        let gRes = null;
        let gData = {};
        let usedChatModel = model;
        for (const candidateModel of chatModelChain) {
          gRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidateModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents,
                generationConfig: {
                  temperature: 0.65,
                  maxOutputTokens: 1100,
                  ...(candidateModel.startsWith('gemini-2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
                },
              }),
            }
          );
          gData = await gRes.json().catch(() => ({}));
          if (gRes.ok) {
            usedChatModel = candidateModel;
            break;
          }
          if (gRes.status !== 429 && gRes.status !== 503 && gRes.status !== 404) {
            break;
          }
        }
        const rawReply = gData?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim() || '';
        const reply = rawReply
          .replace(/^\s{0,3}#{1,6}\s+/gm, '')
          .replace(/^\s*[*+]\s+/gm, '• ')
          .replace(/\*\*\*([^*\n]+?)\*\*\*/g, '$1')
          .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
          .replace(/\*/g, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        if (!gRes?.ok || !reply) {
          return json(req, { error: gData?.error?.message || 'La IA no pudo responder en este momento' }, gRes?.status === 429 ? 429 : 502);
        }
        const lowerCombined = `${message} ${reply}`.toLowerCase();
        const matchedBookIds = booksList
          .filter((b) => b?.id && b?.title && lowerCombined.includes(String(b.title).toLowerCase()))
          .slice(0, 4)
          .map((b) => b.id);
        return json(req, { ok: true, reply, model: usedChatModel, matchedBookIds });
      }

      if (method === 'POST' && pathname === '/api/ai/identify-book') {
        if (!checkBearerAuth(req, url, env)) return json(req, { error: 'Token inválido o faltante' }, 401);
        const apiKey = (env.GEMINI_API_KEY || '').trim();
        const primaryModel = (env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
        const modelChain = Array.from(new Set([primaryModel, 'gemini-2.5-flash-lite']));

        const body = await req.json().catch(() => ({}));
        const fileFormat = String(body.format || '').toLowerCase();
        const currentKind = String(body.currentKind || '').toLowerCase();
        const isVisual = Boolean(body.isVisualSeries);
        const canBeVisual = isVisual || ['pdf', 'cbz', 'cbr', 'images'].includes(fileFormat);
        const existingSeriesNames = Array.isArray(body.existingSeriesNames)
          ? body.existingSeriesNames.map((s) => String(s || '').trim()).filter((s) => s.length >= 2).slice(0, 80)
          : [];

        const promptLines = [
          'Eres un clasificador y catalogador experto de bibliotecas digitales para KomoLib (libros, audiolibros, mangas japoneses, manhwas coreanos, manhuas chinos y cómics).',
          'Analiza la imagen de portada (si se adjunta), el nombre de archivo, carpeta, extracto y la lista de series existentes.',
          'Devuelve ÚNICAMENTE un JSON válido con estas claves:',
          '{"detectedKind":"book|audiobook|manga|manhwa|comic","originTag":"manhwa|manga|manhua|comic|null","seriesName":"nombre canónico en español si es manga/manhwa/manhua/cómic (o vacío si es libro)","title":"título limpio","author":"autor/estudio o vacío","genres":["Acción","Fantasía"],"seriesStatus":"ongoing|completed|hiatus|cancelled|null","totalChaptersExpected":null,"description":"sinopsis limpia en español (2 a 4 frases, sin asteriscos ni spoilers)"}',
          'REGLAS CLAVE:',
          '- Si formato es audio -> detectedKind="audiobook".',
          '- Si formato es epub/mobi/azw3/fb2/docx/txt/html -> normalmente detectedKind="book".',
          '- Si formato es pdf/cbz/cbr/images -> distingue con precisión si es libro de texto/novela ("book"), manhwa coreano ("manhwa" + originTag="manhwa"), manhua chino ("manhwa" + originTag="manhua"), manga japonés ("manga" + originTag="manga") o cómic occidental ("comic" + originTag="comic").',
          '- UNIFICACIÓN DE NOMBRES (MUY IMPORTANTE): Si la obra corresponde a UNA de las series ya existentes en "Series en la biblioteca" (aunque el archivo tenga título en inglés, sinónimo, abreviatura o distinto fansub), devuelve EXACTAMENTE ese mismo nombre en "seriesName". Conserva siempre el nombre en español más conocido.',
          `Formato: ${fileFormat || 'desconocido'} | Tipo actual: ${currentKind || 'desconocido'}`,
          `Archivo: ${String(body.fileName || '').slice(0, 220)}`,
          `Carpeta: ${String(body.folderPath || '').slice(0, 160)}`,
          `Título/Serie actual: ${String(body.seriesName || body.currentTitle || '').slice(0, 200)}`,
          `Autor actual: ${String(body.currentAuthor || '').slice(0, 160)}`,
        ];

        if (existingSeriesNames.length > 0 && canBeVisual) {
          promptLines.push(`Series en la biblioteca (reutiliza el nombre exacto si es la misma obra): ${existingSeriesNames.join(' | ').slice(0, 1600)}`);
        }

        if (body.textExcerpt && typeof body.textExcerpt === 'string' && body.textExcerpt.trim()) {
          promptLines.push(`Extracto:\n${body.textExcerpt.trim().slice(0, 2200)}`);
        }

        const parts = [{ text: promptLines.join('\n') }];
        if (typeof body.coverDataUrl === 'string') {
          const imgMatch = body.coverDataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i);
          if (imgMatch && imgMatch[2].length < 3 * 1024 * 1024) {
            const mimeType = imgMatch[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : imgMatch[1].toLowerCase();
            parts.push({ inlineData: { mimeType, data: imgMatch[2].replace(/\s+/g, '') } });
          }
        }

        let parsed = null;
        let usedModel = primaryModel;
        let lastErrStatus = 502;
        let lastErrDetail = '';

        if (apiKey) {
          for (const candidateModel of modelChain) {
            const gRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidateModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ role: 'user', parts }],
                  generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: 700,
                    responseMimeType: 'application/json',
                    ...(candidateModel.startsWith('gemini-2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
                  },
                }),
              }
            );
            if (!gRes.ok) {
              lastErrStatus = gRes.status;
              lastErrDetail = (await gRes.text().catch(() => '')).slice(0, 220);
              if (gRes.status === 429 || gRes.status === 503 || gRes.status === 404) {
                continue;
              }
              break;
            }
            const gData = await gRes.json().catch(() => ({}));
            const rawText = gData?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim() || '';
            const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
            try {
              parsed = JSON.parse(cleaned);
            } catch {
              const m = cleaned.match(/\{[\s\S]*\}/);
              if (m) {
                try { parsed = JSON.parse(m[0]); } catch { /* ignore */ }
              }
            }
            if (parsed && typeof parsed === 'object') {
              usedModel = candidateModel;
              break;
            }
          }
        }

        // Zero-quota public catalog fallback (MangaDex/AniList/Jikan for Manga/Manhwa/Manhua + altTitle matching,
        // Google Books/OpenLibrary/Wikipedia ES for Books!)
        if (!parsed || typeof parsed !== 'object') {
          if (fileFormat === 'audio' || currentKind === 'audiobook') {
            return json(req, {
              ok: true,
              model: 'format-classifier',
              detectedKind: 'audiobook',
              title: '',
              seriesName: '',
              author: '',
              description: '',
            });
          }
          const querySeed = body.fileName || body.seriesName || body.currentTitle || '';
          let catalogRes = null;
          if (canBeVisual) {
            // Strict confidence when testing a PDF currently marked as 'book' so real novels/textbooks are never misclassified!
            catalogRes = await lookupVisualSeriesFallback(querySeed, existingSeriesNames, !isVisual && fileFormat === 'pdf');
          }
          if (!catalogRes && !isVisual) {
            const bookRes = await lookupBookCatalogFallback(querySeed, body.currentAuthor || '');
            if (bookRes) catalogRes = { ...bookRes, detectedKind: 'book' };
          }
          if (catalogRes) {
            return json(req, { ok: true, ...catalogRes });
          }
          return json(req, {
            ok: true,
            model: 'catalog-checked',
            title: '',
            seriesName: '',
            author: '',
            description: '',
            note: lastErrStatus === 429 ? 'Cuota diaria de Gemini alcanzada; catálogo público sin coincidencias' : lastErrDetail,
          });
        }

        const rawDetected = String(parsed.detectedKind || '').toLowerCase().trim();
        const validDetectedKind = ['book', 'audiobook', 'manga', 'manhwa', 'comic'].includes(rawDetected)
          ? rawDetected
          : rawDetected === 'manhua'
          ? 'manhwa'
          : undefined;
        const validOrigin = ['manga', 'manhwa', 'manhua', 'comic'].includes(String(parsed.originTag || '').toLowerCase())
          ? String(parsed.originTag).toLowerCase()
          : rawDetected === 'manhua'
          ? 'manhua'
          : undefined;
        const validStatus = ['ongoing', 'completed', 'hiatus', 'cancelled'].includes(String(parsed.seriesStatus || '').toLowerCase())
          ? String(parsed.seriesStatus).toLowerCase()
          : undefined;
        const validGenres = Array.isArray(parsed.genres)
          ? parsed.genres.map((g) => String(g || '').replace(/^#/, '').trim()).filter((g) => g.length >= 2 && g.length <= 36).slice(0, 8)
          : undefined;
        const validTotalCaps =
          typeof parsed.totalChaptersExpected === 'number' && Number.isFinite(parsed.totalChaptersExpected) && parsed.totalChaptersExpected > 0
            ? Math.floor(parsed.totalChaptersExpected)
            : undefined;
        const rawSeriesOut = typeof parsed.seriesName === 'string' ? parsed.seriesName.trim() : '';
        const matchedExistingOut =
          canBeVisual && existingSeriesNames.length > 0
            ? matchExistingSpanishSeries([rawSeriesOut, parsed.title, body.seriesName, body.fileName], existingSeriesNames)
            : '';
        return json(req, {
          ok: true,
          model: usedModel,
          detectedKind: validDetectedKind,
          title: typeof parsed.title === 'string' ? parsed.title.trim() : '',
          seriesName: matchedExistingOut || rawSeriesOut,
          author: typeof parsed.author === 'string' ? parsed.author.trim() : '',
          description: typeof parsed.description === 'string' ? parsed.description.replace(/\*/g, '').trim() : '',
          originTag: validOrigin,
          genres: validGenres,
          seriesStatus: validStatus,
          totalChaptersExpected: validTotalCaps,
        });
      }

      return json(req, { error: `Ruta no encontrada: ${method} ${pathname}` }, 404);
    } catch (err) {
      return json(req, { error: err instanceof Error ? err.message : 'Error interno en el servidor' }, 500);
    }
  },
};
