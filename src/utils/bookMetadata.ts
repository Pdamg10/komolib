const GENERIC_AUTHORS = new Set([
  'unknown',
  'unknown author',
  'desconocido',
  'autor desconocido',
  'biblioteca personal',
  'biblioteca mobi',
  'sin autor',
  'anonimo',
  'anónimo',
  'anonymous',
  'calibre',
  'admin',
  'user',
  'usuario',
  'owner',
  'pdf',
  'epub',
  'ebook',
  'default',
  'none',
  'n/a',
  'na',
  'various',
  'varios',
  'varios autores',
]);

const GENERIC_TITLES = new Set([
  'unknown',
  'untitled',
  'sin titulo',
  'sin título',
  'document',
  'documento',
  'book',
  'libro',
  'index',
  'cover',
  'portada',
  'default',
  'none',
  'n/a',
  'calibre',
]);

const TITLE_STOPWORDS = new Set([
  'el',
  'la',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  'de',
  'del',
  'al',
  'en',
  'con',
  'sin',
  'por',
  'para',
  'sobre',
  'entre',
  'hacia',
  'hasta',
  'como',
  'que',
  'cuando',
  'donde',
  'mi',
  'tu',
  'su',
  'mis',
  'tus',
  'sus',
  'the',
  'of',
  'and',
  'in',
  'to',
  'for',
  'with',
  'from',
  'into',
  'about',
  'a',
  'an',
  'my',
  'your',
  'our',
  'this',
  'that',
  'vol',
  'volumen',
  'tomo',
  'libro',
  'parte',
  'saga',
  'trilogia',
  'trilogía',
  'serie',
  'edicion',
  'edición',
  'capitulo',
  'capítulo',
  'historia',
  'cronicas',
  'crónicas',
  'diario',
  'memorias',
  'guia',
  'guía',
  'manual',
  'cuentos',
  'novela',
  'poemas',
  'secretos',
  'sombras',
  'reino',
  'imperio',
  'mundo',
  'amor',
  'noche',
  'corazon',
  'corazón',
]);

function normalizeCompare(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stripDownloadNoise(raw: string): string {
  return raw
    .replace(/_?oceanofpdf\.com_?/gi, ' ')
    .replace(/[\[(]\s*(?:z-?lib(?:rary)?[^)\]]*|annas-?archive[^)\]]*|epublibre[^)\]]*|lectulandia[^)\]]*|libgen[^)\]]*|b-ok[^)\]]*|epl|r\d+(?:\.\d+)?|v\d+(?:\.\d+)?|spanish\s+edition|edici[oó]n\s+espa[nñ]ola|espa[nñ]ol|pdf|epub|mobi|azw3|cbz|cbr|hq|scan|retail|fixed|corregido|\d{4})\s*[\])]/gi, ' ')
    .replace(/\b(?:z-?lib(?:rary)?\.org|annas-?archive\.\w+|epublibre(?:\.org)?|lectulandia|b-ok\.\w+|libgen\.\w+)\b/gi, ' ')
    .replace(/[\[(]\s*[\])]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isGenericAuthor(raw?: string | null): boolean {
  if (!raw) return true;
  const clean = normalizeCompare(raw);
  if (!clean || clean.length < 2) return true;
  if (GENERIC_AUTHORS.has(clean)) return true;
  if (/^(https?:|www\.|microsoft word|adobe|calibre|libreoffice|writer|scan)/i.test(raw.trim())) {
    return true;
  }
  if (/^\d+$/.test(clean)) return true;
  return false;
}

export function isGenericTitle(raw?: string | null): boolean {
  if (!raw) return true;
  const trimmed = raw.trim();
  const clean = normalizeCompare(trimmed);
  if (!clean || clean.length < 2) return true;
  if (GENERIC_TITLES.has(clean)) return true;
  if (/^(microsoft word\s*-?|document\d+|untitled\d*|img_\d+|scan\d*)$/i.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Converts "Sanderson, Brandon" -> "Brandon Sanderson" when it's clearly a single-author
 * "Last, First" string (never touches multi-author lists like "A. Smith, B. Jones").
 */
export function normalizeLastFirstName(raw: string): string {
  const s = raw.trim().replace(/\s+/g, ' ');
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return s;
  const [left, right] = parts;
  const leftWords = left.split(/\s+/).length;
  const rightWords = right.split(/\s+/).length;
  // Single author "Last, First" typically has 1-2 words on each side and no digits/colons
  if (
    leftWords >= 1 &&
    leftWords <= 2 &&
    rightWords >= 1 &&
    rightWords <= 3 &&
    !/[\d:!?()[\]]/.test(s) &&
    !/^(jr\.?|sr\.?|iii|ii|iv|phd|md|ed\.?|trad\.?)$/i.test(right)
  ) {
    return `${right} ${left}`.replace(/\s+/g, ' ').trim();
  }
  return s;
}

export function cleanAuthorName(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  let s = stripDownloadNoise(raw)
    .replace(/^(?:by|por|autor(?:a)?|author)\s*[:\-–—]?\s+/i, '')
    .replace(/^[\s\-–—_.,;:|]+|[\s\-–—_.,;:|]+$/g, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return undefined;
  // Handle semicolon-separated multi-authors ("Last, First; Last2, First2")
  if (s.includes(';')) {
    const cleaned = s
      .split(';')
      .map((p) => normalizeLastFirstName(p))
      .filter((p) => !isGenericAuthor(p));
    if (!cleaned.length) return undefined;
    s = Array.from(new Set(cleaned)).join(', ');
  } else {
    s = normalizeLastFirstName(s);
  }
  if (isGenericAuthor(s)) return undefined;
  return s;
}

export function cleanTitleText(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  let s = raw
    .replace(/\.(epub|pdf|mobi|azw3?|prc|fb2|cbz|cbr|docx|txt|md|html?|mp3|m4b|m4a|aac|ogg|oga|opus|wav|flac|webm|wma|amr|3gp|aiff?|caf|alac|ac3|mp2|mka)$/i, '')
    .replace(/^microsoft\s+word\s*[-–—:]\s*/i, '');
  s = stripDownloadNoise(s)
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:|]+|[\s\-–—:|]+$/g, '')
    .trim();
  if (!s || isGenericTitle(s)) return undefined;
  return s;
}

/**
 * Scores how likely a short phrase is a person's name vs a book title.
 * Higher score = more likely an author name.
 */
function scorePersonNameLikelihood(raw: string): number {
  const s = raw.trim();
  if (!s) return -100;
  let score = 0;

  // "Apellido, Nombre" is an extremely strong author signal
  if (/^[A-ZÁÉÍÓÚÑÜ][^,:\d]{1,24},\s+[A-ZÁÉÍÓÚÑÜ][^,:\d]{1,28}$/.test(s)) {
    score += 12;
  }

  // Initials like "J. K. Rowling", "J.R.R. Tolkien", "G. R. R. Martin", "A. J. Cronin"
  if (/(?:^|\s)[A-ZÁÉÍÓÚÑ]\.(?:\s*[A-ZÁÉÍÓÚÑ]\.)*\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñü]+/.test(s)) {
    score += 7;
  }

  // Digits, colons, question/exclamation marks, quotes, or brackets strongly signal a book title
  if (/[:!?¿¡"'«»#]/.test(s)) score -= 8;
  if (/\d/.test(s)) score -= 7;
  if (/[()[\]]/.test(s)) score -= 3;

  const words = s.split(/\s+/).filter(Boolean);
  if (words.length === 2 || words.length === 3) score += 3;
  else if (words.length === 1) score -= 1;
  else if (words.length === 4) score -= 1;
  else if (words.length >= 5) score -= 5;

  // Check stopwords / title words
  let titleWordHits = 0;
  let capitalizedNameWords = 0;
  for (let i = 0; i < words.length; i++) {
    const cleanW = normalizeCompare(words[i]);
    if (!cleanW) continue;
    if (TITLE_STOPWORDS.has(cleanW)) {
      // "de" / "del" / "la" inside a Spanish surname (e.g. "Gabriel García de la Cruz") is mild
      if (i > 0 && (cleanW === 'de' || cleanW === 'del' || cleanW === 'la' || cleanW === 'van' || cleanW === 'von')) {
        titleWordHits += 0.3;
      } else {
        titleWordHits += 1.5;
      }
    }
    if (/^[A-ZÁÉÍÓÚÑÜ][a-záéíóúñü'-]+$/.test(words[i])) {
      capitalizedNameWords++;
    }
  }

  score -= titleWordHits * 3.2;
  if (words.length >= 2 && words.length <= 3 && capitalizedNameWords === words.length && titleWordHits === 0) {
    score += 5;
  }

  // Multiple authors joined by "&" or " y "
  if (/\s+(?:&|y)\s+/i.test(s) && words.length <= 6 && !/\d/.test(s) && titleWordHits === 0) {
    score += 2;
  }

  return score;
}

function isLikelyPersonName(raw: string): boolean {
  return scorePersonNameLikelihood(raw) >= 4;
}

function splitBySeparator(base: string): [string, string] | null {
  // Prefer clear spaced dash separators: " - ", " – ", " — ", " | "
  const spacedMatch = base.match(/^(.+?)\s+[-–—|]\s+(.+)$/);
  if (spacedMatch) {
    const left = spacedMatch[1].trim();
    const right = spacedMatch[2].trim();
    if (left.length >= 2 && right.length >= 2) return [left, right];
  }
  // Underscore-dash pattern common in downloaded files: "Author_-_Title" or "Title_-_Author"
  const underDash = base.match(/^(.+?)_[-–—]_(.+)$/);
  if (underDash) {
    const left = underDash[1].replace(/_/g, ' ').trim();
    const right = underDash[2].replace(/_/g, ' ').trim();
    if (left.length >= 2 && right.length >= 2) return [left, right];
  }
  return null;
}

function folderMatchesCandidate(folderPath: string | undefined, candidate: string): boolean {
  if (!folderPath || !candidate) return false;
  const candNorm = normalizeCompare(candidate);
  if (candNorm.length < 4) return false;
  const segments = folderPath.split(/[\\/]+/).map((s) => normalizeCompare(s)).filter(Boolean);
  return segments.some((seg) => seg === candNorm || seg.includes(candNorm) || candNorm.includes(seg));
}

export function parseTitleAuthorFromFileName(
  fileName: string,
  folderPath?: string
): { title?: string; author?: string } {
  const withoutExt = fileName
    .replace(/\.(epub|pdf|mobi|azw3?|prc|fb2|cbz|cbr|docx|txt|md|html?|mp3|m4b|m4a|aac|ogg|oga|opus|wav|flac|webm|wma|amr|3gp|aiff?|caf|alac|ac3|mp2|mka)$/i, '')
    .trim();
  const base = stripDownloadNoise(withoutExt)
    .replace(/_{2,}/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return {};

  // Pattern 1: "Title (Author)" or "Title [Author]" at end of filename
  const parenMatch = base.match(/^(.+?)\s*[\[(]([^()[\]]{3,60})[\])]\s*$/);
  if (parenMatch) {
    const mainPart = cleanTitleText(parenMatch[1]);
    const innerRaw = parenMatch[2].replace(/_/g, ' ').trim();
    const innerAuthor = cleanAuthorName(innerRaw);
    if (mainPart && innerAuthor && isLikelyPersonName(innerRaw)) {
      return { title: mainPart, author: innerAuthor };
    }
  }

  // Pattern 2: "Title por Author" / "Title by Author"
  const byMatch = base.match(/^(.+?)\s+(?:por|by)\s+([A-ZÁÉÍÓÚÑÜ].{2,55})$/i);
  if (byMatch) {
    const t = cleanTitleText(byMatch[1]);
    const a = cleanAuthorName(byMatch[2]);
    if (t && a && isLikelyPersonName(byMatch[2])) {
      return { title: t, author: a };
    }
  }

  // Pattern 3: "A - B" (handles multiple dashes too, e.g. "Author - Series 01 - Title" or "Title - Subtitle - Author")
  const allDashParts = base
    .split(/\s+[-–—|]\s+/)
    .map((p) => p.replace(/_/g, ' ').trim())
    .filter(Boolean);

  if (allDashParts.length >= 2) {
    const first = allDashParts[0];
    const last = allDashParts[allDashParts.length - 1];
    const restAfterFirst = allDashParts.slice(1).join(' - ');
    const restBeforeLast = allDashParts.slice(0, -1).join(' - ');

    // Folder hint disambiguates immediately (e.g. folder "Brandon Sanderson/Brandon Sanderson - Elantris.epub")
    if (folderMatchesCandidate(folderPath, first) && !folderMatchesCandidate(folderPath, last)) {
      return {
        title: cleanTitleText(restAfterFirst),
        author: cleanAuthorName(first),
      };
    }
    if (folderMatchesCandidate(folderPath, last) && !folderMatchesCandidate(folderPath, first)) {
      return {
        title: cleanTitleText(restBeforeLast),
        author: cleanAuthorName(last),
      };
    }

    const firstScore = scorePersonNameLikelihood(first);
    const lastScore = scorePersonNameLikelihood(last);

    if (firstScore >= 4 && firstScore >= lastScore + 2) {
      return {
        title: cleanTitleText(restAfterFirst),
        author: cleanAuthorName(first),
      };
    }
    if (lastScore >= 4 && lastScore >= firstScore + 2) {
      return {
        title: cleanTitleText(restBeforeLast),
        author: cleanAuthorName(last),
      };
    }
    // Both look like names or tie: if first is "Last, First", first is author; else Spanish ebooks most often use "Title - Author"
    if (first.includes(',') && !last.includes(',')) {
      return {
        title: cleanTitleText(restAfterFirst),
        author: cleanAuthorName(first),
      };
    }
    if (lastScore >= 3) {
      return {
        title: cleanTitleText(restBeforeLast),
        author: cleanAuthorName(last),
      };
    }
    if (firstScore >= 3) {
      return {
        title: cleanTitleText(restAfterFirst),
        author: cleanAuthorName(first),
      };
    }
  }

  const fallbackPair = splitBySeparator(base);
  if (fallbackPair) {
    const [a, b] = fallbackPair;
    if (scorePersonNameLikelihood(a) > scorePersonNameLikelihood(b) && isLikelyPersonName(a)) {
      return { title: cleanTitleText(b), author: cleanAuthorName(a) };
    }
    if (isLikelyPersonName(b)) {
      return { title: cleanTitleText(a), author: cleanAuthorName(b) };
    }
  }

  return { title: cleanTitleText(base) };
}

function stripAuthorFromTitle(title: string, author: string): string {
  const normAuthor = normalizeCompare(author);
  if (!normAuthor || normAuthor.length < 3) return title;

  // Check "Title - Author" / "Author - Title"
  const parts = title.split(/\s+[-–—|]\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const firstNorm = normalizeCompare(normalizeLastFirstName(parts[0]));
    const lastNorm = normalizeCompare(normalizeLastFirstName(parts[parts.length - 1]));
    if (firstNorm === normAuthor) {
      const rest = parts.slice(1).join(' - ').trim();
      if (rest.length >= 2) return rest;
    }
    if (lastNorm === normAuthor) {
      const rest = parts.slice(0, -1).join(' - ').trim();
      if (rest.length >= 2) return rest;
    }
  }

  // Check "Title (Author)"
  const parenMatch = title.match(/^(.+?)\s*[\[(]([^()[\]]+)[\])]\s*$/);
  if (parenMatch) {
    const innerNorm = normalizeCompare(normalizeLastFirstName(parenMatch[2]));
    if (innerNorm === normAuthor && parenMatch[1].trim().length >= 2) {
      return parenMatch[1].trim();
    }
  }

  return title;
}

/**
 * Resolves clean, non-swapped title and author combining embedded file metadata (EPUB/PDF/MOBI/FB2)
 * with intelligent filename & folder heuristics.
 */
export function resolveBookTitleAndAuthor(input: {
  fileName: string;
  folderPath?: string;
  metaTitle?: string | null;
  metaAuthor?: string | null;
}): { title: string; author: string } {
  let metaTitle = cleanTitleText(input.metaTitle);
  let metaAuthor = cleanAuthorName(input.metaAuthor);
  const fromFile = parseTitleAuthorFromFileName(input.fileName, input.folderPath);

  // If embedded title and author are literally identical, discard duplicate author
  if (metaTitle && metaAuthor && normalizeCompare(metaTitle) === normalizeCompare(metaAuthor)) {
    metaAuthor = undefined;
  }

  // Detect swapped embedded metadata (e.g. dc:title = "Sanderson, Brandon", dc:creator = "El Imperio Final")
  if (metaTitle && metaAuthor) {
    const rawMetaTitle = (input.metaTitle || '').trim();
    const rawMetaAuthor = (input.metaAuthor || '').trim();
    const titleScore = scorePersonNameLikelihood(rawMetaTitle);
    const authorScore = scorePersonNameLikelihood(rawMetaAuthor);
    const matchesSwappedFile =
      (Boolean(fromFile.title && fromFile.author) &&
        normalizeCompare(normalizeLastFirstName(rawMetaTitle)) === normalizeCompare(fromFile.author!) &&
        normalizeCompare(rawMetaAuthor) === normalizeCompare(fromFile.title!)) ||
      (Boolean(fromFile.title) &&
        normalizeCompare(rawMetaAuthor) === normalizeCompare(fromFile.title!) &&
        normalizeCompare(rawMetaTitle) !== normalizeCompare(fromFile.title!) &&
        titleScore >= 4);

    const clearlySwapped =
      matchesSwappedFile ||
      (titleScore >= 8 && authorScore <= 0) ||
      (titleScore >= 6 && authorScore <= -2 && rawMetaAuthor.length >= rawMetaTitle.length);

    if (clearlySwapped) {
      const swappedTitle = cleanTitleText(rawMetaAuthor);
      const swappedAuthor = cleanAuthorName(rawMetaTitle);
      if (swappedTitle && swappedAuthor) {
        metaTitle = swappedTitle;
        metaAuthor = swappedAuthor;
      }
    }
  }

  // If metadata title itself contains "Title - Author" or "Author - Title"
  if (metaTitle && !metaAuthor) {
    const splitMeta = parseTitleAuthorFromFileName(metaTitle, input.folderPath);
    if (splitMeta.title && splitMeta.author) {
      metaTitle = splitMeta.title;
      metaAuthor = splitMeta.author;
    }
  }

  // If we have a valid metadata title, use it to extract the OTHER half of the filename as author!
  if (metaTitle && !metaAuthor) {
    const baseName = stripDownloadNoise(
      input.fileName.replace(/\.[^.]+$/, '')
    ).replace(/_/g, ' ');
    const dashParts = baseName.split(/\s+[-–—|]\s+/).map((p) => p.trim()).filter(Boolean);
    if (dashParts.length === 2) {
      const normMT = normalizeCompare(metaTitle);
      const p0 = normalizeCompare(dashParts[0]);
      const p1 = normalizeCompare(dashParts[1]);
      if (p0 && normMT && (p0 === normMT || normMT.includes(p0) || p0.includes(normMT))) {
        metaAuthor = cleanAuthorName(dashParts[1]);
      } else if (p1 && normMT && (p1 === normMT || normMT.includes(p1) || p1.includes(normMT))) {
        metaAuthor = cleanAuthorName(dashParts[0]);
      }
    }
    if (!metaAuthor && fromFile.author) {
      metaAuthor = fromFile.author;
    }
  }

  // If we have a valid metadata author but no title, strip author from filename!
  if (!metaTitle && metaAuthor) {
    const cleanedBase = cleanTitleText(input.fileName);
    if (cleanedBase) {
      metaTitle = stripAuthorFromTitle(cleanedBase, metaAuthor);
    }
  }

  let finalTitle = metaTitle || fromFile.title || cleanTitleText(input.fileName) || 'Sin título';
  const finalAuthor = metaAuthor || fromFile.author || 'Biblioteca Personal';

  // Ensure the final title never duplicates the author ("Title - Author" when author is already known)
  if (!isGenericAuthor(finalAuthor)) {
    finalTitle = stripAuthorFromTitle(finalTitle, finalAuthor);
  }

  return {
    title: finalTitle || 'Sin título',
    author: finalAuthor,
  };
}

function decodeHtmlEntitiesTwice(raw: string): string {
  const decodeOnce = (str: string) =>
    str
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&apos;|&#39;|&#x27;/gi, "'")
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&mdash;|&#8212;/gi, '—')
      .replace(/&ndash;|&#8211;/gi, '–')
      .replace(/&hellip;|&#8230;/gi, '…')
      .replace(/&laquo;/gi, '«')
      .replace(/&raquo;/gi, '»')
      .replace(/&#(x?[0-9a-fA-F]+);/g, (_m, tok: string) => {
        try {
          const cp = tok.toLowerCase().startsWith('x')
            ? parseInt(tok.slice(1), 16)
            : parseInt(tok, 10);
          if (cp < 32 && cp !== 10 && cp !== 9) return ' ';
          return String.fromCodePoint(cp);
        } catch {
          return '';
        }
      });
  return decodeOnce(decodeOnce(raw));
}

/**
 * Cleans book synopses / descriptions imported from EPUB OPF, FB2, or Moon+/ReadEra backups.
 * Strips double-encoded HTML/CSS, Moon+ internal numeric/symbol headers (e.g. "#123#0#...",
 * "★ 170000000 ★", "0 0 1 123456"), ISBN/UUID/Calibre prefixes, and binary/control noise.
 */
export function cleanSynopsisText(raw?: string | null): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;

  let s = raw
    // Remove ASCII control characters except newline/tab and Unicode replacement chars
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/g, ' ');

  // Decode entities twice so &lt;p&gt; becomes <p>, then strip style/script/XML/HTML blocks
  s = decodeHtmlEntitiesTwice(s)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(?:p|div|li|blockquote|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  // Remove inline CSS rule fragments or JSON metadata blocks leaked into description
  s = s.replace(/[a-z0-9.#_-]+\s*\{[^}]{0,400}\}/gi, ' ');

  // Strip Moon+ / ReadEra / Calibre numeric/symbol metadata headers at the start
  // e.g. "#12345#0#...", "0 1 23456789 ...", "** 1234 **", "<<<1234>>>", "978-84-... :"
  let prev = '';
  let guard = 0;
  while (s !== prev && guard++ < 6) {
    prev = s;
    s = s
      .trim()
      // Leading Moon+ delimited metadata like "#0#1234#..." or "|123|456|" or "@123@"
      .replace(/^(?:[#@|~*•·▪▫◆◇★☆§$%^&+=<>[\](){}/\\]+\s*[\d.,:;_\-\s]*)+(?=[A-ZÁÉÍÓÚÑÜ¡¿"«])/u, '')
      // Leading bare numeric sequences / timestamps / book IDs before real text
      .replace(/^(?:\d[\d\s.,:/\\|#*_\-—–]{2,})(?=[A-ZÁÉÍÓÚÑÜ¡¿"«])/u, '')
      // Leading ISBN / ASIN / UUID / Calibre / Summary labels
      .replace(/^(?:ISBN(?:-1[03])?|ASIN|UUID|OCLC|DOI)\s*[:#]?\s*[0-9A-Za-z\-]{6,}\s*[-–—:|.;]?\s*/i, '')
      .replace(/^(?:sinopsis|resumen|descripci[oó]n|summary|synopsis|description|book\s+description)\s*[:\-–—]+\s*/i, '')
      // Leading stray symbols/punctuation (keep ¡ ¿ " « ( when starting a real sentence)
      .replace(/^[\s.,;:!?*#_|~•·▪▫◆◇★☆§$%^&+=<>/\\\-–—\]})]+/, '');
  }

  // Collapse whitespace cleanly while preserving up to single line breaks
  s = s
    .replace(/[ \t\r]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();

  // Remove trailing Moon+ / tracker numeric tails like "... #12345#0#"
  s = s.replace(/\s*(?:[#|]\s*\d+){2,}[#|]?\s*$/, '').trim();

  if (!s) return undefined;

  // Check if the remaining text is mostly garbage (too few letters or high symbol/digit noise)
  const letters = (s.match(/[A-Za-zÁÉÍÓÚáéíóúÑñÜü]/g) || []).length;
  if (letters < 14) return undefined;
  const nonSpace = s.replace(/\s+/g, '').length;
  if (nonSpace > 0 && letters / nonSpace < 0.45) return undefined;

  // Reject pure file paths or URLs masquerading as synopsis
  if (/^(?:https?:\/\/|file:\/\/|\/storage\/|\/sdcard\/|content:\/\/)/i.test(s)) {
    return undefined;
  }

  return s.length > 1400 ? `${s.slice(0, 1397).trim()}…` : s;
}

/**
 * Checks whether a book is missing clean title, author, or synopsis (or has noisy/corrupted synopsis)
 * and would benefit from AI identification using its cover & opening pages.
 */
export function bookNeedsMetadataEnrichment(book: {
  title?: string;
  author?: string;
  description?: string;
}): boolean {
  if (isGenericTitle(book.title)) return true;
  if (isGenericAuthor(book.author)) return true;
  const cleanedDesc = cleanSynopsisText(book.description);
  if (!cleanedDesc || cleanedDesc.length < 28) return true;
  // Detect if stored description still has raw noise compared to cleaned version
  if (book.description && book.description.trim() !== cleanedDesc && /[<&#\uFFFD]|^\s*[\d#*_|~]{3,}/.test(book.description)) {
    return true;
  }
  return false;
}
