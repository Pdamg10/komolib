import type { BookAnnotation } from '../types/library';

export function hexToRgba(hex: string, alpha: number): string {
  const clean = (hex || '#fff176').trim().replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return `rgba(255, 224, 102, ${alpha})`;
  }
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function getBadgeLabelForAnnotation(ann: BookAnnotation): string | null {
  if (ann.tool === 'sticker') {
    return ann.sticker || '✨ Sticker';
  }
  if (ann.tool === 'emoji') {
    return ann.sticker || '⭐';
  }
  // Post-it & Banderitas use authentic CSS paper/flag shapes instead of emojis
  if (ann.tool === 'postit') {
    return null;
  }
  if (ann.note && ann.note.trim()) {
    return '💬';
  }
  return null;
}

export const READER_MARKS_CSS = `
mark.komo-inline-mark {
  background: transparent;
  color: inherit;
  border-radius: 4px;
  padding: 0 2px;
  cursor: pointer;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  transition: box-shadow 0.2s ease, filter 0.15s ease;
}

mark.komo-inline-mark:hover {
  filter: brightness(0.95);
}

/* Highlighter */
mark.komo-mark-highlighter {
  background: var(--mark-bg, rgba(255, 241, 118, 0.52));
}

mark.komo-mark-highlighter.komo-variant-neon {
  background: var(--mark-strong, rgba(255, 238, 50, 0.78));
  box-shadow: 0 0 0 1px var(--mark-soft, rgba(255, 238, 50, 0.35));
}

mark.komo-mark-highlighter.komo-variant-thick-underline {
  background: transparent;
  border-radius: 0;
  box-shadow: inset 0 -0.46em 0 var(--mark-thick, rgba(255, 241, 118, 0.7));
}

/* Pencil */
mark.komo-mark-pencil {
  background: var(--mark-subtle, rgba(92, 92, 102, 0.1));
  text-decoration: underline wavy var(--mark-color, #5c5c66);
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
}

mark.komo-mark-pencil.komo-variant-dashed {
  background: transparent;
  text-decoration: underline dashed var(--mark-color, #5c5c66);
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
}

mark.komo-mark-pencil.komo-variant-shade {
  text-decoration: none;
  background: repeating-linear-gradient(
    -45deg,
    var(--mark-hatch, rgba(92, 92, 102, 0.2)),
    var(--mark-hatch, rgba(92, 92, 102, 0.2)) 3px,
    transparent 3px,
    transparent 6px
  );
  border-bottom: 1.5px solid var(--mark-mid, rgba(92, 92, 102, 0.6));
}

/* Pen */
mark.komo-mark-pen {
  background: transparent;
  border-bottom: 2px solid var(--mark-color, #1d4ed8);
  border-radius: 0;
  padding-bottom: 1px;
}

mark.komo-mark-pen.komo-variant-double {
  background: transparent;
  border-bottom: 4px double var(--mark-color, #1d4ed8);
  border-radius: 0;
  padding-bottom: 1px;
}

mark.komo-mark-pen.komo-variant-box {
  background: var(--mark-subtle, rgba(29, 78, 216, 0.08));
  border: 1.8px solid var(--mark-color, #1d4ed8);
  border-radius: 5px;
  padding: 0 4px;
}

/* Post-it & Flags — Authentic Paper / Tab Shapes (no emoji!) */
mark.komo-mark-postit {
  position: relative;
  background: linear-gradient(
    180deg,
    var(--mark-strong, rgba(255, 243, 161, 0.72)) 0%,
    var(--mark-bg, rgba(255, 243, 161, 0.56)) 24%,
    var(--mark-bg, rgba(255, 243, 161, 0.52)) 100%
  );
  border-top: 2px solid var(--mark-mid, rgba(224, 180, 34, 0.6));
  border-left: 1px solid var(--mark-soft, rgba(0, 0, 0, 0.1));
  border-right: 1px solid var(--mark-soft, rgba(0, 0, 0, 0.1));
  border-bottom: 1.5px solid var(--mark-mid, rgba(180, 145, 30, 0.45));
  border-radius: 2px 2px 6px 2px;
  padding: 1px 6px 1px 5px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.12);
}

/* Classic Post-it folded dog-ear sticky corner shape */
mark.komo-mark-postit[data-last-slice="true"].komo-variant-classic::after,
mark.komo-mark-postit[data-last-slice="true"]:not([class*="komo-variant-"])::after {
  content: '';
  display: inline-block;
  width: 11px;
  height: 11px;
  margin-left: 5px;
  vertical-align: -1px;
  background: linear-gradient(
    135deg,
    var(--mark-color, #fff3a1) 0%,
    var(--mark-color, #fff3a1) 55%,
    rgba(0, 0, 0, 0.22) 56%,
    rgba(255, 255, 255, 0.65) 100%
  );
  border: 1px solid rgba(0, 0, 0, 0.16);
  border-radius: 1.5px 1.5px 4px 1.5px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
}

/* Banderita / Index Tab pointed flag shape */
mark.komo-mark-postit.komo-variant-tab {
  border: none;
  border-left: 5px solid var(--mark-color, #ffd6e0);
  border-top: 1px solid var(--mark-mid, rgba(255, 180, 198, 0.55));
  border-bottom: 1px solid var(--mark-mid, rgba(255, 180, 198, 0.55));
  padding: 1px 6px 1px 7px;
  background: var(--mark-soft, rgba(255, 214, 224, 0.34));
  border-radius: 2px 0 0 2px;
  box-shadow: none;
}

mark.komo-mark-postit[data-last-slice="true"].komo-variant-tab::after {
  content: '';
  display: inline-block;
  width: 16px;
  height: 10px;
  margin-left: 5px;
  vertical-align: -1px;
  background: var(--mark-color, #ffd6e0);
  clip-path: polygon(0 0, 74% 0, 100% 50%, 74% 100%, 0 100%);
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.22));
}

/* Kraft Paper sticky note shape */
mark.komo-mark-postit.komo-variant-kraft {
  background: repeating-linear-gradient(
      90deg,
      rgba(176, 137, 104, 0.08) 0px,
      rgba(176, 137, 104, 0.08) 2px,
      transparent 2px,
      transparent 5px
    ),
    rgba(230, 204, 178, 0.64);
  border: 1px solid rgba(156, 102, 68, 0.45);
  border-top: 2.5px solid #9c6644;
  border-radius: 2px;
  padding: 1px 6px 1px 5px;
  box-shadow: 0 2px 4px rgba(110, 70, 40, 0.15);
}

mark.komo-mark-postit[data-last-slice="true"].komo-variant-kraft::after {
  content: '';
  display: inline-block;
  width: 12px;
  height: 10px;
  margin-left: 5px;
  vertical-align: -1px;
  background: linear-gradient(135deg, #ddb892 0%, #ddb892 60%, #9c6644 61%, #e6ccb2 100%);
  border: 1px solid #9c6644;
  border-radius: 1px;
}

/* Translucent PET sticky note shape */
mark.komo-mark-postit.komo-variant-translucent {
  background: linear-gradient(
    125deg,
    rgba(255, 255, 255, 0.42) 0%,
    var(--mark-soft, rgba(241, 243, 245, 0.26)) 45%,
    rgba(255, 255, 255, 0.16) 100%
  );
  border: 1.3px solid var(--mark-mid, rgba(140, 148, 158, 0.62));
  border-radius: 4px;
  padding: 1px 6px 1px 5px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6), 0 1px 3px rgba(0, 0, 0, 0.08);
  backdrop-filter: blur(2px);
}

mark.komo-mark-postit[data-last-slice="true"].komo-variant-translucent::after {
  content: '';
  display: inline-block;
  width: 11px;
  height: 11px;
  margin-left: 5px;
  vertical-align: -1px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.65) 0%, var(--mark-soft, rgba(220, 226, 232, 0.4)) 100%);
  border: 1.2px solid var(--mark-mid, rgba(140, 148, 158, 0.65));
  border-radius: 2px 2px 4px 2px;
}

/* Stickers */
mark.komo-mark-sticker {
  background: var(--mark-soft, rgba(232, 111, 104, 0.22));
  border-bottom: 2px dotted var(--mark-color, #e86f68);
  border-radius: 5px;
  padding: 0 3px;
}

mark.komo-mark-sticker.komo-variant-pill {
  background: var(--mark-soft, rgba(232, 111, 104, 0.24));
  border: 1.5px solid var(--mark-color, #e86f68);
  border-radius: 999px;
  padding: 0 6px;
}

/* Emojis */
mark.komo-mark-emoji {
  background: var(--mark-subtle, rgba(245, 184, 85, 0.22));
  border-bottom: 2px dotted var(--mark-color, #f5b855);
  border-radius: 5px;
  padding: 0 2px;
}

/* Floating Inline Badges (Stickers, Emojis, Post-it flags, Notes) */
.komo-inline-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-family: system-ui, -apple-system, sans-serif;
  font-style: normal;
  font-size: 0.72em;
  font-weight: 800;
  line-height: 1.2;
  margin-left: 4px;
  padding: 1px 6px;
  border-radius: 999px;
  vertical-align: middle;
  user-select: none;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.16);
}

.komo-inline-badge.badge-sticker {
  background: var(--mark-color, #e86f68);
  color: #ffffff;
}

.komo-inline-badge.badge-emoji {
  background: var(--mark-soft, rgba(245, 184, 85, 0.28));
  border: 1px solid var(--mark-mid, rgba(245, 184, 85, 0.6));
  font-size: 0.92em;
  padding: 0 5px;
}

.komo-inline-badge.badge-postit {
  background: var(--mark-color, #fff3a1);
  color: #231f1c;
  border: 1px solid rgba(0, 0, 0, 0.14);
}

.komo-inline-badge.badge-note {
  background: var(--mark-soft, rgba(128, 128, 128, 0.24));
  color: inherit;
}

@keyframes komoMarkPulse {
  0% { box-shadow: 0 0 0 0 rgba(232, 111, 104, 0.72); }
  50% { box-shadow: 0 0 0 8px rgba(232, 111, 104, 0.25); }
  100% { box-shadow: 0 0 0 0 rgba(232, 111, 104, 0); }
}

mark.komo-mark-pulse {
  animation: komoMarkPulse 0.9s ease 2;
}
`;

export function injectReaderMarksStyle(doc: Document): void {
  const id = 'komolib-reader-marks-style';
  let styleEl = doc.getElementById(id) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = doc.createElement('style');
    styleEl.id = id;
    (doc.head || doc.documentElement).appendChild(styleEl);
  }
  if (styleEl.textContent !== READER_MARKS_CSS) {
    styleEl.textContent = READER_MARKS_CSS;
  }
}

export function clearDomMarks(root: ParentNode): void {
  const badges = root.querySelectorAll('.komo-inline-badge');
  badges.forEach((b) => b.remove());

  const existing = root.querySelectorAll('mark.komo-inline-mark');
  const touchedParents = new Set<Node>();
  existing.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    touchedParents.add(parent);
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
  });

  touchedParents.forEach((p) => {
    try {
      p.normalize();
    } catch {
      // ignore
    }
  });
}

function normalizeWs(str: string): string {
  return str.replace(/\s+/g, ' ').trim();
}

interface TextSlice {
  node: Text;
  start: number;
  end: number;
}

/**
 * Finds a Range for `quote` across one or multiple Text nodes inside `root`,
 * handling inline elements (<em>, <strong>, <span>) and normalized whitespace.
 */
export function findQuoteRangeInRoot(doc: Document, root: Node, rawQuote: string): Range | null {
  const target = normalizeWs(rawQuote);
  if (target.length < 2) return null;

  // Build normalized string with character-to-(node, offset) index map
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let cur: Text | null;
  while ((cur = walker.nextNode() as Text | null)) {
    const parent = cur.parentElement;
    if (!cur.nodeValue || !parent) continue;
    const tag = parent.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') continue;
    if (parent.closest('.komo-inline-badge')) continue;
    nodes.push(cur);
  }

  let flat = '';
  const mapNode: Text[] = [];
  const mapOffset: number[] = [];
  let lastWasSpace = true;

  for (const textNode of nodes) {
    const val = textNode.nodeValue || '';
    for (let i = 0; i < val.length; i++) {
      const ch = val[i];
      const isWs = /\s/.test(ch);
      if (isWs) {
        if (!lastWasSpace) {
          flat += ' ';
          mapNode.push(textNode);
          mapOffset.push(i);
          lastWasSpace = true;
        }
      } else {
        flat += ch;
        mapNode.push(textNode);
        mapOffset.push(i);
        lastWasSpace = false;
      }
    }
  }

  let matchIdx = flat.indexOf(target);
  let matchLen = target.length;

  // Fallback to case-insensitive or prefix match if exact match wasn't found
  if (matchIdx === -1) {
    const lowerFlat = flat.toLowerCase();
    const lowerTarget = target.toLowerCase();
    matchIdx = lowerFlat.indexOf(lowerTarget);
    if (matchIdx === -1 && lowerTarget.length > 28) {
      const prefix = lowerTarget.slice(0, 28);
      matchIdx = lowerFlat.indexOf(prefix);
      matchLen = prefix.length;
    }
  }

  if (matchIdx === -1 || matchIdx + matchLen - 1 >= mapNode.length) {
    return null;
  }

  try {
    const startNode = mapNode[matchIdx];
    const startOff = mapOffset[matchIdx];
    const endNode = mapNode[matchIdx + matchLen - 1];
    const endOff = Math.min((endNode.nodeValue || '').length, mapOffset[matchIdx + matchLen - 1] + 1);
    const range = doc.createRange();
    range.setStart(startNode, startOff);
    range.setEnd(endNode, endOff);
    return range;
  } catch {
    return null;
  }
}

function collectTextSlicesFromRange(doc: Document, range: Range): TextSlice[] {
  const slices: TextSlice[] = [];
  if (range.collapsed) return slices;

  if (
    range.startContainer === range.endContainer &&
    range.startContainer.nodeType === Node.TEXT_NODE
  ) {
    const t = range.startContainer as Text;
    if (range.endOffset > range.startOffset) {
      slices.push({ node: t, start: range.startOffset, end: range.endOffset });
    }
    return slices;
  }

  const root = range.commonAncestorContainer;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let cur: Text | null;
  while ((cur = walker.nextNode() as Text | null)) {
    if (!cur.nodeValue || !cur.parentElement) continue;
    const tag = cur.parentElement.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') continue;
    if (cur.parentElement.closest('.komo-inline-badge')) continue;
    try {
      if (!range.intersectsNode(cur)) continue;
    } catch {
      continue;
    }
    const start = cur === range.startContainer ? range.startOffset : 0;
    const end = cur === range.endContainer ? range.endOffset : cur.nodeValue.length;
    if (end > start) {
      slices.push({ node: cur, start, end });
    }
  }
  return slices;
}

function createMarkElement(doc: Document, ann: BookAnnotation): HTMLElement {
  const mark = doc.createElement('mark');
  const variantCls = ann.styleVariant ? ` komo-variant-${ann.styleVariant}` : '';
  mark.className = `komo-inline-mark komo-mark-${ann.tool}${variantCls}`;
  mark.dataset.annId = ann.id;
  mark.dataset.annTool = ann.tool;
  mark.style.setProperty('--mark-color', ann.color);
  mark.style.setProperty('--mark-bg', hexToRgba(ann.color, 0.52));
  mark.style.setProperty('--mark-strong', hexToRgba(ann.color, 0.78));
  mark.style.setProperty('--mark-thick', hexToRgba(ann.color, 0.7));
  mark.style.setProperty('--mark-mid', hexToRgba(ann.color, 0.6));
  mark.style.setProperty('--mark-soft', hexToRgba(ann.color, 0.28));
  mark.style.setProperty('--mark-hatch', hexToRgba(ann.color, 0.2));
  mark.style.setProperty('--mark-subtle', hexToRgba(ann.color, 0.14));
  mark.title = ann.note
    ? `${ann.sticker ? `${ann.sticker} · ` : ''}${ann.note}`
    : ann.sticker || ann.quote;
  return mark;
}

function createBadgeElement(doc: Document, ann: BookAnnotation): HTMLElement | null {
  const label = getBadgeLabelForAnnotation(ann);
  if (!label) return null;
  const badge = doc.createElement('span');
  const kind =
    ann.tool === 'sticker'
      ? 'badge-sticker'
      : ann.tool === 'emoji'
      ? 'badge-emoji'
      : ann.tool === 'postit'
      ? 'badge-postit'
      : 'badge-note';
  badge.className = `komo-inline-badge ${kind}`;
  badge.dataset.annId = ann.id;
  badge.style.setProperty('--mark-color', ann.color);
  badge.style.setProperty('--mark-mid', hexToRgba(ann.color, 0.6));
  badge.style.setProperty('--mark-soft', hexToRgba(ann.color, 0.28));
  badge.textContent = label;
  badge.title = ann.note ? `${label} — ${ann.note}` : label;
  return badge;
}

/**
 * Applies annotations cleanly in 2 phases (clean DOM -> resolve all ranges -> wrap newest-first).
 * The newest annotation always takes visual precedence when overlapping an older mark,
 * while deleting an annotation cleanly restores the underlying mark or plain text.
 */
export function applyAnnotationsToRoot(
  doc: Document,
  root: HTMLElement,
  annotations: BookAnnotation[],
  opts?: {
    resolveRange?: (ann: BookAnnotation) => Range | null;
    allowQuoteFallback?: (ann: BookAnnotation) => boolean;
    onAnnotationClick?: (ann: BookAnnotation) => void;
  }
): void {
  // Phase 1: Always restore pristine DOM first so no stale marks/styles remain
  clearDomMarks(root);
  if (!annotations.length) return;

  // Sort NEWEST first so the most recently applied tool/color/variant ALWAYS wins visually!
  const sorted = [...annotations].sort(
    (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
  );

  // Phase 2: Resolve ranges on the pristine clean DOM BEFORE mutating any DOM nodes
  const resolved: Array<{ ann: BookAnnotation; slices: TextSlice[] }> = [];

  for (const ann of sorted) {
    let range: Range | null = null;
    if (opts?.resolveRange) {
      try {
        const candidate = opts.resolveRange(ann);
        if (candidate && !candidate.collapsed) {
          // Verify CFI range text still matches the quote (in case CFI was recorded over a <mark>)
          const rangeText = normalizeWs(candidate.toString());
          const quoteText = normalizeWs(ann.quote || '');
          const probe = quoteText.slice(0, Math.min(14, quoteText.length)).toLowerCase();
          if (!quoteText || !probe || rangeText.toLowerCase().includes(probe)) {
            range = candidate;
          }
        }
      } catch {
        range = null;
      }
    }

    if (!range && (opts?.allowQuoteFallback ? opts.allowQuoteFallback(ann) : true)) {
      range = findQuoteRangeInRoot(doc, root, ann.quote || '');
    }

    if (range) {
      const slices = collectTextSlicesFromRange(doc, range);
      if (slices.length > 0) {
        resolved.push({ ann, slices });
      }
    }
  }

  // Phase 3: Wrap resolved slices newest-first; track covered ranges per original Text node
  // Since splitting a Text node mutates it, process per-node splits carefully by applying
  // non-overlapping segments!
  // Better: map each Text node to the list of (start, end, ann) claims (newest-first wins).
  const nodeClaims = new Map<Text, Array<{ start: number; end: number; ann: BookAnnotation; isLast: boolean }>>();

  for (const { ann, slices } of resolved) {
    const validSlices: Array<{ node: Text; start: number; end: number }> = [];

    for (const sl of slices) {
      const existing = nodeClaims.get(sl.node) || [];
      // Subtract already-claimed intervals (from newer annotations) so newest ALWAYS wins cleanly
      let pieces: Array<{ start: number; end: number }> = [{ start: sl.start, end: sl.end }];
      for (const claim of existing) {
        const nextPieces: Array<{ start: number; end: number }> = [];
        for (const p of pieces) {
          if (claim.end <= p.start || claim.start >= p.end) {
            nextPieces.push(p);
          } else {
            if (claim.start > p.start) nextPieces.push({ start: p.start, end: claim.start });
            if (claim.end < p.end) nextPieces.push({ start: claim.end, end: p.end });
          }
        }
        pieces = nextPieces;
        if (!pieces.length) break;
      }

      for (const p of pieces) {
        if (p.end > p.start) {
          validSlices.push({ node: sl.node, start: p.start, end: p.end });
        }
      }
    }

    if (validSlices.length === 0) continue;

    validSlices.forEach((vs, idx) => {
      const list = nodeClaims.get(vs.node) || [];
      list.push({
        start: vs.start,
        end: vs.end,
        ann,
        isLast: idx === validSlices.length - 1,
      });
      nodeClaims.set(vs.node, list);
    });
  }

  // Now wrap each Text node from END to START so offsets remain 100% valid!
  for (const [textNode, claims] of nodeClaims.entries()) {
    if (!textNode.parentNode) continue;
    claims.sort((a, b) => b.start - a.start);
    for (const claim of claims) {
      try {
        const val = textNode.nodeValue || '';
        const clampedStart = Math.max(0, Math.min(claim.start, val.length));
        const clampedEnd = Math.max(clampedStart, Math.min(claim.end, val.length));
        if (clampedEnd <= clampedStart) continue;

        const range = doc.createRange();
        range.setStart(textNode, clampedStart);
        range.setEnd(textNode, clampedEnd);

        const mark = createMarkElement(doc, claim.ann);
        if (claim.isLast) {
          mark.dataset.lastSlice = 'true';
        }
        range.surroundContents(mark);

        if (opts?.onAnnotationClick) {
          const clickedAnn = claim.ann;
          const handler = (ev: Event) => {
            ev.stopPropagation();
            opts.onAnnotationClick?.(clickedAnn);
          };
          mark.addEventListener('click', handler);
        }

        if (claim.isLast) {
          const badge = createBadgeElement(doc, claim.ann);
          if (badge) {
            if (opts?.onAnnotationClick) {
              const clickedAnn = claim.ann;
              badge.addEventListener('click', (ev) => {
                ev.stopPropagation();
                opts.onAnnotationClick?.(clickedAnn);
              });
            }
            mark.appendChild(badge);
          }
        }
      } catch {
        // skip safely if DOM changed concurrently
      }
    }
  }
}
