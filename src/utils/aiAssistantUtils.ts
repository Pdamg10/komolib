import type { BookAnnotation, BookItem, NoteItem, UserAiProfile } from '../types/library';

export const DEFAULT_USER_AI_PROFILE: UserAiProfile = {
  preferredStyle: 'balanced',
  avoidSpoilers: true,
  likedTopics: [],
  dislikedTopics: [],
  learnedNotes: [],
  interactionCount: 0,
  updatedAt: 0,
};

/**
 * Strips raw Markdown noise (asterisks, hashes, backticks, decorative rules)
 * while keeping clean paragraph spacing and bullet/numbered readability.
 */
export function sanitizeAiReplyText(raw: string): string {
  if (!raw) return '';
  let text = String(raw).replace(/\r\n/g, '\n');

  // Remove fenced code delimiters while keeping inner text
  text = text.replace(/```[a-zA-Z0-9_-]*\n?/g, '');

  // Convert Markdown headings (### Title) into plain clean lines
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');

  // Remove horizontal rules (---, ***, ___)
  text = text.replace(/^\s*([*\-_])\1{2,}\s*$/gm, '');

  // Convert asterisk/plus/dash markdown bullets at start of line to clean bullet dot
  text = text.replace(/^\s*[*+]\s+/gm, '• ');
  text = text.replace(/^\s*-\s+(?=\S)/gm, '• ');

  // Unwrap bold/italic asterisk & underscore markers cleanly
  text = text.replace(/\*\*\*([^*\n]+?)\*\*\*/g, '$1');
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, '$1');
  text = text.replace(/__([^_\n]+?)__/g, '$1');
  text = text.replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s).,;:!?]|$)/g, '$1$2');
  text = text.replace(/`([^`\n]+)`/g, '$1');

  // Strip any stray leftover asterisks so the UI NEVER displays ugly '*' clutter
  text = text.replace(/\*/g, '');

  // Collapse excessive blank lines
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

export type ChatTextBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'numbered'; index: string; text: string };

/**
 * Parses cleaned assistant text into structured visual blocks for clean rendering
 * without raw '*' characters (works retroactively on older saved messages too).
 */
export function parseCleanAiBlocks(raw: string): ChatTextBlock[] {
  const clean = sanitizeAiReplyText(raw);
  if (!clean) return [];

  const blocks: ChatTextBlock[] = [];
  const lines = clean.split('\n');
  let paragraphBuf: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuf.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraphBuf.join(' ').trim() });
      paragraphBuf = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }

    const bulletMatch = line.match(/^[•·–—]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      blocks.push({ type: 'bullet', text: bulletMatch[1].trim() });
      continue;
    }

    const numMatch = line.match(/^(\d{1,2})[.)]\s+(.+)$/);
    if (numMatch) {
      flushParagraph();
      blocks.push({ type: 'numbered', index: numMatch[1], text: numMatch[2].trim() });
      continue;
    }

    // Separate short header-like lines ending with ":" onto their own paragraph
    if (line.endsWith(':') && line.length <= 72) {
      flushParagraph();
      blocks.push({ type: 'paragraph', text: line });
      continue;
    }

    paragraphBuf.push(line);
  }

  flushParagraph();
  return blocks;
}

/**
 * Summarizes the user's real reading patterns (favorite kinds, categories, top authors,
 * active reads) so the AI gives tailored answers from Day 1.
 */
export function deriveReaderTasteSummary(
  books: BookItem[],
  annotations: BookAnnotation[],
  notes: NoteItem[]
): string {
  const realBooks = books.filter((b) => !b.isDemo);
  if (realBooks.length === 0) return '';

  const kindCounts = new Map<string, number>();
  const catCounts = new Map<string, number>();
  const authorScores = new Map<string, number>();

  for (const b of realBooks) {
    kindCounts.set(b.kind, (kindCounts.get(b.kind) || 0) + 1);
    for (const c of b.categories || []) {
      if (c && c !== 'all') catCounts.set(c, (catCounts.get(c) || 0) + 1);
    }
    const author = (b.author || '').trim();
    if (author && !/^(autor desconocido|unknown|biblioteca personal)$/i.test(author)) {
      const weight = 1 + (b.favorite ? 3 : 0) + (b.rating && b.rating >= 4 ? b.rating : 0);
      authorScores.set(author, (authorScores.get(author) || 0) + weight);
    }
  }

  const topKinds = Array.from(kindCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, n]) => `${k} (${n})`);

  const topCats = Array.from(catCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([c]) => c);

  const topAuthors = Array.from(authorScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([a]) => a);

  const favTitles = realBooks
    .filter((b) => b.favorite || (b.rating || 0) >= 4)
    .slice(0, 5)
    .map((b) => b.title);

  const readingNow = realBooks
    .filter((b) => (b.progress || 0) > 0 && (b.progress || 0) < 98)
    .sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0))
    .slice(0, 3)
    .map((b) => `${b.title} (${Math.round(b.progress)}%)`);

  const parts: string[] = [];
  parts.push(`Total biblioteca: ${realBooks.length} títulos, ${annotations.length} marcas, ${notes.length} notas.`);
  if (topKinds.length) parts.push(`Formatos habituales: ${topKinds.join(', ')}.`);
  if (topCats.length) parts.push(`Categorías frecuentes: ${topCats.join(', ')}.`);
  if (topAuthors.length) parts.push(`Autores destacados: ${topAuthors.join(', ')}.`);
  if (favTitles.length) parts.push(`Títulos mejor valorados/favoritos: ${favTitles.join(', ')}.`);
  if (readingNow.length) parts.push(`Leyendo actualmente: ${readingNow.join(', ')}.`);

  return parts.join(' ');
}

function appendUniqueCapped(list: string[], value: string, max = 10): string[] {
  const clean = value.trim().slice(0, 64);
  if (!clean) return list;
  const low = clean.toLowerCase();
  const filtered = list.filter((item) => item.toLowerCase() !== low);
  return [clean, ...filtered].slice(0, max);
}

/**
 * Incrementally trains the user's personal AI profile from natural conversation cues
 * and explicit quick-feedback clicks (shorter, more detailed, helpful).
 */
export function learnFromInteraction(
  prev: UserAiProfile,
  userMessage: string,
  feedback?: 'shorter' | 'detailed' | 'no-spoilers' | 'helpful'
): { next: UserAiProfile; changed: boolean } {
  const base: UserAiProfile = {
    ...DEFAULT_USER_AI_PROFILE,
    ...prev,
    likedTopics: Array.isArray(prev.likedTopics) ? [...prev.likedTopics] : [],
    dislikedTopics: Array.isArray(prev.dislikedTopics) ? [...prev.dislikedTopics] : [],
    learnedNotes: Array.isArray(prev.learnedNotes) ? [...prev.learnedNotes] : [],
  };

  let changed = false;

  if (feedback === 'shorter') {
    if (base.preferredStyle !== 'concise') {
      base.preferredStyle = 'concise';
      changed = true;
    }
    const nextNotes = appendUniqueCapped(base.learnedNotes, 'Prefiere respuestas breves, claras y directas al punto.', 8);
    if (nextNotes.length !== base.learnedNotes.length || nextNotes[0] !== base.learnedNotes[0]) {
      base.learnedNotes = nextNotes;
      changed = true;
    }
  } else if (feedback === 'detailed') {
    if (base.preferredStyle !== 'detailed') {
      base.preferredStyle = 'detailed';
      changed = true;
    }
    const nextNotes = appendUniqueCapped(base.learnedNotes, 'Prefiere explicaciones detalladas y bien estructuradas.', 8);
    if (nextNotes.length !== base.learnedNotes.length || nextNotes[0] !== base.learnedNotes[0]) {
      base.learnedNotes = nextNotes;
      changed = true;
    }
  } else if (feedback === 'no-spoilers') {
    if (!base.avoidSpoilers) {
      base.avoidSpoilers = true;
      changed = true;
    }
    base.learnedNotes = appendUniqueCapped(base.learnedNotes, 'Evitar spoilers estrictamente.', 8);
    changed = true;
  } else if (feedback === 'helpful') {
    base.interactionCount = (base.interactionCount || 0) + 1;
    changed = true;
  }

  const msg = userMessage.trim();
  if (msg) {
    base.interactionCount = (base.interactionCount || 0) + 1;
    changed = true;

    const lower = msg.toLowerCase();

    // Detect style preferences from natural requests
    if (/\b(m[aá]s corto|m[aá]s breve|resume|resumido|directo al grano|sin rodeos|pocas palabras)\b/i.test(lower)) {
      base.preferredStyle = 'concise';
      base.learnedNotes = appendUniqueCapped(base.learnedNotes, 'Prefiere respuestas breves y directas.', 8);
    } else if (/\b(m[aá]s detalle|profundiza|expl[ií]came bien|an[aá]lisis completo|extenso)\b/i.test(lower)) {
      base.preferredStyle = 'detailed';
      base.learnedNotes = appendUniqueCapped(base.learnedNotes, 'Le gustan explicaciones con buen detalle.', 8);
    }

    if (/\bsin spoilers?\b|\bno me hagas spoiler\b/i.test(lower)) {
      base.avoidSpoilers = true;
    } else if (/\bcon spoilers?\b|\bpuedes hacer spoiler\b/i.test(lower)) {
      base.avoidSpoilers = false;
    }

    // Detect liked topics/genres
    const likeMatch = msg.match(
      /(?:me encanta(?:n)?|me gusta(?:n)? mucho|prefiero|amo leer|busco algo de)\s+([^.,;!?]{3,42})/i
    );
    if (likeMatch?.[1]) {
      base.likedTopics = appendUniqueCapped(base.likedTopics, likeMatch[1], 10);
    }

    // Detect disliked topics/genres
    const dislikeMatch = msg.match(
      /(?:no me gusta(?:n)?|odio|evita(?:r)?|no quiero)\s+([^.,;!?]{3,42})/i
    );
    if (dislikeMatch?.[1] && !/spoilers?|asteriscos?/i.test(dislikeMatch[1])) {
      base.dislikedTopics = appendUniqueCapped(base.dislikedTopics, dislikeMatch[1], 10);
    }

    // Detect explicit personal preference instruction ("recuerda que...", "háblame en...")
    const rememberMatch = msg.match(/(?:recuerda que|ten en cuenta que|siempre resp[oó]ndeme)\s+([^.\n]{4,90})/i);
    if (rememberMatch?.[1]) {
      base.learnedNotes = appendUniqueCapped(base.learnedNotes, rememberMatch[1], 8);
    }
  }

  if (changed) {
    base.updatedAt = Date.now();
  }
  return { next: base, changed };
}
