import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  BookmarkPlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Eye,
  Highlighter,
  ImagePlus,
  List,
  Lock,
  LogOut,
  MapPin,
  MoreHorizontal,
  PenTool,
  Send,
  Settings2,
  Smile,
  Sparkles,
  StickyNote,
  Sun,
  Trash2,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import {
  READING_EMOJI_GROUPS,
  READING_EMOJIS,
  READING_STICKERS,
  STICKER_GROUPS,
  TOOL_META,
  type ReadingStickerItem,
} from '../../data/bookmarksCatalog';
import { dbGetBookFile } from '../../db/localDb';
import { readNativeUriAsBlob } from '../../utils/nativeBridge';
import { getSeriesNavigationForBook } from '../../utils/mangaSeriesUtils';
import { subscribeToRoomStream } from '../../services/sharedReadingService';
import type {
  AnnotationTool,
  BookAnnotation,
  BookmarkItem,
  ComicReadMode,
  ReaderJumpTarget,
  ReaderSettings,
} from '../../types/library';
import { ComicMangaReader } from './ComicMangaReader';
import { EpubReader } from './EpubReader';
import { PdfReader } from './PdfReader';
import { READER_PALETTES } from './readerThemes';
import { TextRichReader, type ReaderSelectionPayload } from './TextRichReader';

export type ReaderViewportMode = 'phone' | 'tablet' | 'desktop';

function detectReaderViewportMode(width: number): ReaderViewportMode {
  if (width <= 640) return 'phone';
  if (width <= 1024) return 'tablet';
  return 'desktop';
}

const TOOL_LIST: AnnotationTool[] = [
  'highlighter',
  'pencil',
  'pen',
  'postit',
  'sticker',
  'emoji',
];

export const ReaderShell: React.FC = () => {
  const {
    books,
    activeBook,
    activeBookFile,
    openBook,
    setActiveSeriesKey,
    readerJumpTarget,
    clearReaderJumpTarget,
    closeReader,
    readerSettings,
    updateReaderSettings,
    updateBook,
    bookmarks,
    addBookmark,
    deleteBookmark,
    annotations,
    addAnnotation,
    deleteAnnotation,
    allBookmarkDesigns,
    addCustomBookmarkDesign,
    deleteCustomBookmarkDesign,
    customStationery,
    addCustomSwatch,
    addCustomSticker,
    addCustomEmoji,
    deviceId,
    sharedUserId,
    profile,
    syncConfig,
    sharedRooms,
    updateLocalRoom,
    removeLocalRoom,
    sendRoomComment,
    leaveOrDeleteRoom,
    kickUserFromRoom,
    showToast,
  } = useLibrary();

  const [fileData, setFileData] = useState<{ blob: Blob; extraImages?: Blob[] } | null>(null);
  const [toc, setToc] = useState<Array<{ id: string; title: string; href: string }>>([]);
  const [jumpHref, setJumpHref] = useState<string | null>(null);
  const [localJumpTarget, setLocalJumpTarget] = useState<ReaderJumpTarget | null>(null);
  const [drawer, setDrawer] = useState<'none' | 'settings' | 'toc' | 'marks' | 'room'>('none');
  const [viewportMode, setViewportMode] = useState<ReaderViewportMode>(() =>
    detectReaderViewportMode(typeof window !== 'undefined' ? window.innerWidth : 1280)
  );
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [marksTab, setMarksTab] = useState<'separadores' | 'anotaciones' | 'marcadores'>('anotaciones');
  const [annFilter, setAnnFilter] = useState<AnnotationTool | 'all'>('all');
  const [showHangingBookmark, setShowHangingBookmark] = useState(true);
  const [bookmarkTucked, setBookmarkTucked] = useState(false);
  const bookmarkHideTimerRef = useRef<number | null>(null);
  const [pinMode, setPinMode] = useState(false);

  // Active text/page selection annotation composer
  const [pendingSel, setPendingSel] = useState<ReaderSelectionPayload | null>(null);
  const [selTool, setSelTool] = useState<AnnotationTool>('highlighter');
  const [selColor, setSelColor] = useState<string>(TOOL_META.highlighter.defaultColor);
  const [selVariant, setSelVariant] = useState<string>(TOOL_META.highlighter.defaultVariant);
  const [selNote, setSelNote] = useState('');
  const [selQuote, setSelQuote] = useState('');
  const [selStickerGroup, setSelStickerGroup] = useState<ReadingStickerItem['group']>('emociones');
  const [selSticker, setSelSticker] = useState(`${READING_STICKERS[0].emoji} ${READING_STICKERS[0].label}`);
  const [selEmojiGroup, setSelEmojiGroup] = useState<string>(READING_EMOJI_GROUPS[0].id);
  const [selEmoji, setSelEmoji] = useState(READING_EMOJIS[0]);
  const [syncAlsoBookmark, setSyncAlsoBookmark] = useState(false);

  // Inline "+ Agregar" custom stationery inside the reader dock
  const [addingCustomItem, setAddingCustomItem] = useState(false);
  const [newItemColor, setNewItemColor] = useState('#ff8fa3');
  const [newItemName, setNewItemName] = useState('');
  const [newItemMeaning, setNewItemMeaning] = useState('');
  const [newItemEmoji, setNewItemEmoji] = useState('🌟');

  // Custom bookmark upload state
  const [customBmName, setCustomBmName] = useState('');
  const customBmInputRef = useRef<HTMLInputElement>(null);

  // Shared room drawer state
  const [roomCommentDraft, setRoomCommentDraft] = useState('');
  const [revealedSpoilers, setRevealedSpoilers] = useState<Record<string, boolean>>({});
  const [focusedAnnId, setFocusedAnnId] = useState<string | null>(null);
  const [expandedDrawerIds, setExpandedDrawerIds] = useState<Record<string, boolean>>({});
  const [expandAllDrawer, setExpandAllDrawer] = useState(false);

  const [livePos, setLivePos] = useState<{
    page?: number;
    pageCount?: number;
    cfi?: string;
    scrollRatio?: number;
    chapter?: string;
    chapterHref?: string;
    pct: number;
  }>({ pct: 0 });
  const livePosRef = useRef(livePos);
  livePosRef.current = livePos;
  const activeBookRef = useRef(activeBook);
  activeBookRef.current = activeBook;
  const activeReaderFlushRef = useRef<(() => void) | null>(null);
  const registerReaderFlush = useCallback((fn: (() => void) | null) => {
    activeReaderFlushRef.current = fn;
  }, []);
  const [activeJumpedBookmarkDesignId, setActiveJumpedBookmarkDesignId] = useState<string | null>(
    null
  );
  const jumpDesignTimerRef = useRef<number | null>(null);

  const flushCurrentReadingPosition = useCallback(() => {
    try {
      activeReaderFlushRef.current?.();
    } catch {
      // ignore reader flush errors
    }
    const currBook = activeBookRef.current;
    const lp = livePosRef.current;
    if (!currBook) return;
    const patch: Partial<typeof currBook> = {};
    if (lp.page !== undefined) patch.currentPage = lp.page;
    if (lp.pageCount !== undefined) patch.pageCount = lp.pageCount;
    if (lp.cfi) patch.currentCfi = lp.cfi;
    if (lp.scrollRatio !== undefined) patch.scrollRatio = lp.scrollRatio;
    if (lp.chapter) patch.currentChapter = lp.chapter;
    if (lp.pct > 0 || lp.page !== undefined || lp.cfi || lp.scrollRatio !== undefined) {
      patch.progress = lp.pct;
      void updateBook(currBook.id, patch);
    }
  }, [updateBook]);

  const handleCloseReader = useCallback(() => {
    flushCurrentReadingPosition();
    closeReader();
  }, [flushCurrentReadingPosition, closeReader]);

  // Register global flush hook + flush automatically on tab hide / app suspend / window close
  useEffect(() => {
    const win = window as unknown as { __komoFlushReaderProgress?: () => void };
    if (!activeBook) {
      delete win.__komoFlushReaderProgress;
      return;
    }
    win.__komoFlushReaderProgress = flushCurrentReadingPosition;
    const onPageHide = () => flushCurrentReadingPosition();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushCurrentReadingPosition();
      }
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      flushCurrentReadingPosition();
      delete win.__komoFlushReaderProgress;
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [activeBook?.id, flushCurrentReadingPosition]);

  const activeRoom = activeBook
    ? sharedRooms.find((r) => r.bookId === activeBook.id)
    : undefined;

  const seriesNav = useMemo(
    () => getSeriesNavigationForBook(books, activeBook),
    [books, activeBook]
  );

  const handleOpenNextSeriesPack = useCallback(() => {
    if (!activeBook || !seriesNav?.nextEntry) return;
    const nextEntry = seriesNav.nextEntry;
    const now = Date.now();
    // Mark current pack as 100% completed before advancing directly to the next batch (e.g. 1-10 -> 11-20)
    void updateBook(activeBook.id, {
      progress: 100,
      readingStatus: 'completed',
      finishedAt: now,
      lastReadAt: now,
    });
    const nextBook =
      (nextEntry.book.progress || 0) >= 98
        ? { ...nextEntry.book, currentPage: 1 }
        : nextEntry.book;
    if ((nextEntry.book.progress || 0) >= 98) {
      void updateBook(nextEntry.book.id, { currentPage: 1 });
    }
    showToast(`Pasando a ${nextEntry.label}`);
    void openBook(nextBook);
  }, [activeBook, seriesNav, updateBook, showToast, openBook]);

  const bookAnnotations = useMemo(
    () => (activeBook ? annotations.filter((a) => a.bookId === activeBook.id) : []),
    [annotations, activeBook?.id]
  );

  const bookBookmarks = useMemo(
    () => (activeBook ? bookmarks.filter((b) => b.bookId === activeBook.id) : []),
    [bookmarks, activeBook?.id]
  );

  const effectiveBookmarkDesignId =
    activeBook?.activeBookmarkDesignId ?? readerSettings.defaultBookmarkDesignId;

  const activeBookmarkDesign = useMemo(() => {
    const id = effectiveBookmarkDesignId;
    if (id === 'none') return null;
    if (id) {
      return allBookmarkDesigns.find((d) => d.id === id) || allBookmarkDesigns[0] || null;
    }
    return allBookmarkDesigns[0] || null;
  }, [effectiveBookmarkDesignId, allBookmarkDesigns]);

  // Detect whether the user is currently positioned at one of their saved bookmarks in this book
  const matchedBookmarkAtCurrentPos = useMemo(() => {
    if (!activeBook || bookBookmarks.length === 0) return null;
    const fmt = activeBook.format;
    const isPagedMedia = fmt === 'pdf' || fmt === 'cbz' || fmt === 'cbr' || fmt === 'images';
    if (isPagedMedia && livePos.page) {
      return bookBookmarks.find((bm) => bm.page === livePos.page) || null;
    }
    if (fmt === 'epub') {
      return (
        bookBookmarks.find((bm) => {
          if (bm.cfi && livePos.cfi && bm.cfi === livePos.cfi) return true;
          if (
            bm.chapterHref &&
            livePos.chapterHref &&
            bm.chapterHref.split('#')[0] === livePos.chapterHref.split('#')[0] &&
            bm.progress !== undefined &&
            Math.abs(bm.progress - livePos.pct) <= 3
          ) {
            return true;
          }
          if (bm.progress !== undefined && Math.abs(bm.progress - livePos.pct) <= 1) return true;
          return false;
        }) || null
      );
    }
    return (
      bookBookmarks.find((bm) => {
        if (
          bm.scrollRatio !== undefined &&
          livePos.scrollRatio !== undefined &&
          Math.abs(bm.scrollRatio - livePos.scrollRatio) <= 0.025
        ) {
          return true;
        }
        if (bm.progress !== undefined && Math.abs(bm.progress - livePos.pct) <= 1) return true;
        return false;
      }) || null
    );
  }, [activeBook, bookBookmarks, livePos.page, livePos.cfi, livePos.chapterHref, livePos.scrollRatio, livePos.pct]);

  // Always display the EXACT bookmark design chosen for the current saved bookmark (or jumped bookmark),
  // falling back to the book's active separador design! While browsing the gallery, preview activeBookmarkDesign live.
  const displayedHangingDesign = useMemo(() => {
    if (drawer === 'marks' && marksTab === 'separadores') {
      return activeBookmarkDesign;
    }
    const preferredId =
      matchedBookmarkAtCurrentPos?.designId || activeJumpedBookmarkDesignId || undefined;
    if (preferredId) {
      const exact = allBookmarkDesigns.find((d) => d.id === preferredId);
      if (exact) return exact;
    }
    if (matchedBookmarkAtCurrentPos) {
      return activeBookmarkDesign || allBookmarkDesigns[0] || null;
    }
    return activeBookmarkDesign;
  }, [drawer, marksTab, matchedBookmarkAtCurrentPos, activeJumpedBookmarkDesignId, allBookmarkDesigns, activeBookmarkDesign]);

  const shouldRenderHangingBookmark = Boolean(
    displayedHangingDesign && (showHangingBookmark || matchedBookmarkAtCurrentPos || activeJumpedBookmarkDesignId)
  );

  useEffect(() => {
    if (!activeBook) return;
    setShowHangingBookmark(effectiveBookmarkDesignId !== 'none');
  }, [activeBook?.id, effectiveBookmarkDesignId]);

  // Keep the chosen separador clearly revealed when entering the book, when at a bookmarked spot,
  // or when jumping to a bookmark; gently tuck on non-bookmarked pages so it never blocks text.
  useEffect(() => {
    if (bookmarkHideTimerRef.current !== null) {
      window.clearTimeout(bookmarkHideTimerRef.current);
      bookmarkHideTimerRef.current = null;
    }
    if (!activeBook || !displayedHangingDesign) return;
    if (drawer === 'marks' && marksTab === 'separadores') {
      setBookmarkTucked(false);
      return;
    }
    if (matchedBookmarkAtCurrentPos || activeJumpedBookmarkDesignId) {
      setBookmarkTucked(false);
      return;
    }
    setBookmarkTucked(false);
    bookmarkHideTimerRef.current = window.setTimeout(() => {
      setBookmarkTucked(true);
      bookmarkHideTimerRef.current = null;
    }, 2800);
    return () => {
      if (bookmarkHideTimerRef.current !== null) {
        window.clearTimeout(bookmarkHideTimerRef.current);
        bookmarkHideTimerRef.current = null;
      }
    };
  }, [
    activeBook?.id,
    displayedHangingDesign?.id,
    matchedBookmarkAtCurrentPos?.id,
    activeJumpedBookmarkDesignId,
    drawer,
    marksTab,
  ]);

  const tuckBookmarkNow = useCallback(() => {
    if (drawer === 'marks' && marksTab === 'separadores') return;
    if (bookmarkHideTimerRef.current !== null) {
      window.clearTimeout(bookmarkHideTimerRef.current);
      bookmarkHideTimerRef.current = null;
    }
    setBookmarkTucked(true);
  }, [drawer, marksTab]);

  const effectiveJumpTarget = localJumpTarget || (readerJumpTarget?.bookId === activeBook?.id ? readerJumpTarget : null);

  // When jumping to a bookmark from AnnotationsView or Drawer, immediately reveal that exact bookmark's separador design!
  useEffect(() => {
    if (!effectiveJumpTarget) return;
    const designFromJump =
      effectiveJumpTarget.bookmarkDesignId ||
      (effectiveJumpTarget.bookmarkId
        ? bookBookmarks.find((b) => b.id === effectiveJumpTarget.bookmarkId)?.designId
        : undefined);
    if (designFromJump || effectiveJumpTarget.bookmarkId) {
      setActiveJumpedBookmarkDesignId(designFromJump || activeBookmarkDesign?.id || allBookmarkDesigns[0]?.id || null);
      setShowHangingBookmark(true);
      setBookmarkTucked(false);
      if (jumpDesignTimerRef.current) window.clearTimeout(jumpDesignTimerRef.current);
      jumpDesignTimerRef.current = window.setTimeout(() => {
        setActiveJumpedBookmarkDesignId(null);
      }, 4500);
    }
  }, [effectiveJumpTarget?.id]);

  // Automatically detect & adapt reader chrome whenever viewport/orientation changes (phone / tablet / desktop)
  useEffect(() => {
    const updateMode = () => {
      const next = detectReaderViewportMode(window.innerWidth);
      setViewportMode((prev) => (prev === next ? prev : next));
      if (next !== 'phone') setMobileToolsOpen(false);
    };
    updateMode();
    window.addEventListener('resize', updateMode);
    window.addEventListener('orientationchange', updateMode);
    return () => {
      window.removeEventListener('resize', updateMode);
      window.removeEventListener('orientationchange', updateMode);
    };
  }, []);

  // Allow Android / PWA back gesture to close open reader drawers or annotation composer first
  useEffect(() => {
    const win = window as unknown as { __komoCloseReaderDrawer?: () => boolean };
    if (!activeBook) {
      delete win.__komoCloseReaderDrawer;
      return;
    }
    win.__komoCloseReaderDrawer = () => {
      if (pendingSel) {
        setPendingSel(null);
        return true;
      }
      if (drawer !== 'none') {
        setDrawer('none');
        return true;
      }
      if (mobileToolsOpen) {
        setMobileToolsOpen(false);
        return true;
      }
      return false;
    };
    return () => {
      delete win.__komoCloseReaderDrawer;
    };
  }, [activeBook, drawer, pendingSel, mobileToolsOpen]);

  useEffect(() => {
    if (!activeRoom?.code || !syncConfig.serverUrl.trim()) return;
    return subscribeToRoomStream(
      syncConfig,
      activeRoom.code,
      (updated) => {
        const myIds = [sharedUserId, deviceId].filter(Boolean);
        const kickedMe = myIds.some((id) => updated.kickedIds?.includes(id));
        const stillInRoom = myIds.some((id) => Boolean(updated.participants?.[id]));
        if (kickedMe && !stillInRoom) {
          const lp = livePosRef.current;
          if (activeBook && lp.pct > 0) {
            void updateBook(activeBook.id, {
              progress: lp.pct,
              ...(lp.page ? { currentPage: lp.page } : {}),
              ...(lp.cfi ? { currentCfi: lp.cfi } : {}),
              ...(lp.scrollRatio !== undefined ? { scrollRatio: lp.scrollRatio } : {}),
              ...(lp.chapter ? { currentChapter: lp.chapter } : {}),
            });
          }
          removeLocalRoom(updated.code);
          setDrawer((curr) => (curr === 'room' ? 'none' : curr));
          showToast(`Fuiste eliminado de la sala ${updated.code} por el administrador · Tu progreso se conservó`);
          return;
        }
        updateLocalRoom(updated);
      },
      (deletedCode) => {
        const lp = livePosRef.current;
        if (activeBook && lp.pct > 0) {
          void updateBook(activeBook.id, {
            progress: lp.pct,
            ...(lp.page ? { currentPage: lp.page } : {}),
            ...(lp.cfi ? { currentCfi: lp.cfi } : {}),
            ...(lp.scrollRatio !== undefined ? { scrollRatio: lp.scrollRatio } : {}),
            ...(lp.chapter ? { currentChapter: lp.chapter } : {}),
          });
        }
        removeLocalRoom(deletedCode);
        setDrawer((curr) => (curr === 'room' ? 'none' : curr));
        showToast(`La sala ${deletedCode} fue cerrada por el anfitrión · Tu progreso se conservó`);
      }
    );
  }, [activeRoom?.code, activeBook?.id, syncConfig, deviceId, sharedUserId, updateBook, updateLocalRoom, removeLocalRoom, showToast]);

  useEffect(() => {
    if (!activeBook) {
      setFileData(null);
      setToc([]);
      setDrawer('none');
      setPendingSel(null);
      setLocalJumpTarget(null);
      setPinMode(false);
      return;
    }
    setLivePos({
      page: activeBook.currentPage,
      cfi: activeBook.currentCfi,
      scrollRatio: activeBook.scrollRatio,
      chapter: activeBook.currentChapter,
      pct: activeBook.progress || 0,
    });
    let active = true;
    // Fast path: reuse the Blob already loaded by openBook() with ZERO duplicate IndexedDB/SAF read!
    if (activeBookFile && activeBookFile.bookId === activeBook.id) {
      setFileData({ blob: activeBookFile.blob, extraImages: activeBookFile.extraImages });
      return;
    }
    setFileData(null);
    (async () => {
      const rec = await dbGetBookFile(activeBook.id);
      if (rec) {
        if (active) setFileData({ blob: rec.blob, extraImages: rec.extraImages });
        return;
      }
      if (activeBook.nativeFileUri) {
        const nativeBlob = await readNativeUriAsBlob(activeBook.nativeFileUri, activeBook.mimeType);
        if (nativeBlob && active) {
          setFileData({ blob: nativeBlob });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [activeBook?.id, activeBookFile]);

  if (!activeBook) return null;

  const pal = READER_PALETTES[readerSettings.theme];
  const isComicLike =
    activeBook.format === 'cbz' ||
    activeBook.format === 'cbr' ||
    activeBook.format === 'images';
  const isPdf = activeBook.format === 'pdf';
  const isEpub = activeBook.format === 'epub';
  const supportsPinMode = isPdf || isComicLike;

  const handleSelectTool = (tool: AnnotationTool) => {
    setSelTool(tool);
    setAddingCustomItem(false);
    if (tool === 'sticker') {
      const matched = [...customStationery.stickers, ...READING_STICKERS].find(
        (st) => `${st.emoji} ${st.label}` === selSticker
      );
      setSelColor(matched?.color || TOOL_META.sticker.defaultColor);
    } else {
      setSelColor(TOOL_META[tool].defaultColor);
    }
    setSelVariant(TOOL_META[tool].defaultVariant);
  };

  const handleIncomingSelection = (sel: ReaderSelectionPayload) => {
    setPendingSel(sel);
    setSelQuote(sel.quote);
    setSelNote('');
    setSyncAlsoBookmark(false);
  };

  const handleOpenQuickMarkAtCurrentPos = () => {
    setPendingSel({
      quote: '',
      chapter: livePos.chapter,
      chapterHref: livePos.chapterHref,
      page: livePos.page,
      progress: livePos.pct,
      cfi: livePos.cfi,
      scrollRatio: livePos.scrollRatio,
    });
    setSelQuote('');
    setSelNote('');
    setSelTool('postit');
    setSelColor(TOOL_META.postit.defaultColor);
    setSelVariant(TOOL_META.postit.defaultVariant);
  };

  const handleSaveAnnotation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingSel) return;
    const finalQuote =
      selQuote.trim() ||
      pendingSel.quote.trim() ||
      (pendingSel.page ? `Página ${pendingSel.page}` : `Posición ${pendingSel.progress}%`);

    const chosenSticker =
      selTool === 'sticker'
        ? selSticker
        : selTool === 'emoji'
        ? selEmoji
        : undefined;

    await addAnnotation({
      bookId: activeBook.id,
      tool: selTool,
      color: selColor,
      styleVariant: selVariant,
      quote: finalQuote.slice(0, 400),
      note: selNote.trim() || undefined,
      sticker: chosenSticker,
      chapter: pendingSel.chapter || livePos.chapter,
      chapterHref: pendingSel.chapterHref || livePos.chapterHref,
      page: pendingSel.page ?? livePos.page,
      progress: pendingSel.progress ?? livePos.pct,
      cfi: pendingSel.cfi,
      scrollRatio: pendingSel.scrollRatio ?? livePos.scrollRatio,
      pageX: pendingSel.pageX,
      pageY: pendingSel.pageY,
      bookmarkDesignId: activeBookmarkDesign?.id,
    });

    if (syncAlsoBookmark) {
      await addBookmark({
        bookId: activeBook.id,
        label:
          (pendingSel.chapter || livePos.chapter)
            ? `${pendingSel.chapter || livePos.chapter} · ${
                pendingSel.page ? `Pág. ${pendingSel.page}` : `${pendingSel.progress}%`
              }`
            : pendingSel.page
            ? `Página ${pendingSel.page} (${pendingSel.progress}%)`
            : `Posición ${pendingSel.progress}%`,
        chapter: pendingSel.chapter || livePos.chapter,
        chapterHref: pendingSel.chapterHref || livePos.chapterHref,
        page: pendingSel.page ?? livePos.page,
        progress: pendingSel.progress ?? livePos.pct,
        cfi: pendingSel.cfi || livePos.cfi,
        scrollRatio: pendingSel.scrollRatio ?? livePos.scrollRatio,
        excerpt: finalQuote.slice(0, 120),
        designId: activeBookmarkDesign?.id,
      });
    }

    setPendingSel(null);
    setSelNote('');
    setSelQuote('');
    window.getSelection?.()?.removeAllRanges?.();
  };

  const handlePlaceVisualBookmark = async (designId?: string) => {
    // Capture the absolute freshest scroll/page/CFI right before placing the separador!
    try {
      activeReaderFlushRef.current?.();
    } catch {
      // ignore
    }
    const lp = livePosRef.current;
    const fallbackDefaultId =
      readerSettings.defaultBookmarkDesignId && readerSettings.defaultBookmarkDesignId !== 'none'
        ? readerSettings.defaultBookmarkDesignId
        : allBookmarkDesigns[0]?.id;
    const chosenId =
      (designId && designId !== 'none' ? designId : undefined) ||
      activeBookmarkDesign?.id ||
      fallbackDefaultId;
    const chosenDesign = allBookmarkDesigns.find((d) => d.id === chosenId);

    if (chosenId && activeBook.activeBookmarkDesignId !== chosenId) {
      await updateBook(activeBook.id, { activeBookmarkDesignId: chosenId });
    }
    if (chosenId) {
      setShowHangingBookmark(true);
      setBookmarkTucked(false);
    }

    const chPart = lp.chapter ? `${lp.chapter} · ` : '';
    const locPart = lp.page
      ? `Página ${lp.page} (${lp.pct}%)`
      : `Posición ${lp.pct}%`;
    await addBookmark({
      bookId: activeBook.id,
      label: `${chPart}${locPart}`,
      chapter: lp.chapter,
      chapterHref: lp.chapterHref,
      page: lp.page,
      progress: lp.pct,
      cfi: lp.cfi,
      scrollRatio: lp.scrollRatio,
      designId: chosenId,
    });
    if (chosenDesign) {
      showToast(`Separador "${chosenDesign.name}" colocado en ${locPart}`);
    }
  };

  const handleSelectBookmarkDesign = async (designId: string) => {
    await updateBook(activeBook.id, { activeBookmarkDesignId: designId });
    updateReaderSettings({ defaultBookmarkDesignId: designId });
    setShowHangingBookmark(designId !== 'none');
    if (designId !== 'none') {
      setBookmarkTucked(false);
    }
    showToast(designId === 'none' ? 'Separador oculto' : 'Separador elegido');
  };

  const handleUploadCustomBookmark = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const created = await addCustomBookmarkDesign(customBmName, file);
    if (created) {
      setCustomBmName('');
      await updateBook(activeBook.id, { activeBookmarkDesignId: created.id });
      updateReaderSettings({ defaultBookmarkDesignId: created.id });
      setShowHangingBookmark(true);
    }
    e.target.value = '';
  };

  const triggerJump = (target: Omit<ReaderJumpTarget, 'id' | 'bookId'>) => {
    clearReaderJumpTarget();
    setLocalJumpTarget({
      ...target,
      id: `lj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      bookId: activeBook.id,
    });
    setDrawer('none');
  };

  const handleAnnotationClick = (ann: BookAnnotation) => {
    setFocusedAnnId(ann.id);
    setExpandedDrawerIds((prev) => ({ ...prev, [ann.id]: true }));
    setMarksTab('anotaciones');
    setAnnFilter('all');
    setDrawer('marks');
  };

  const handleBookmarkClickInReader = useCallback(
    (bm: BookmarkItem) => {
      // If clicking a bookmark pip on the progress bar from another page, jump straight to it;
      // if already on that bookmark, open the marks drawer focused on bookmarks.
      const samePage = bm.page !== undefined && livePosRef.current.page === bm.page;
      const sameRatio =
        bm.scrollRatio !== undefined &&
        livePosRef.current.scrollRatio !== undefined &&
        Math.abs(bm.scrollRatio - livePosRef.current.scrollRatio) <= 0.03;
      const sameCfi = Boolean(bm.cfi && livePosRef.current.cfi && bm.cfi === livePosRef.current.cfi);
      if (samePage || sameRatio || sameCfi) {
        setMarksTab('marcadores');
        setExpandedDrawerIds((prev) => ({ ...prev, [bm.id]: true }));
        setDrawer('marks');
      } else {
        clearReaderJumpTarget();
        setLocalJumpTarget({
          id: `lj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          bookId: activeBook.id,
          cfi: bm.cfi,
          chapterHref: bm.chapterHref,
          page: bm.page,
          scrollRatio: bm.scrollRatio,
          bookmarkId: bm.id,
          bookmarkDesignId: bm.designId,
        });
      }
    },
    [activeBook.id, clearReaderJumpTarget]
  );

  const hasOpenOverlay = drawer !== 'none' || Boolean(pendingSel) || mobileToolsOpen;

  const filteredAnnotations =
    annFilter === 'all'
      ? bookAnnotations
      : bookAnnotations.filter((a) => a.tool === annFilter);

  const renderToolIcon = (tool: AnnotationTool, size = 13) => {
    switch (tool) {
      case 'highlighter':
        return <Highlighter size={size} />;
      case 'pencil':
        return <Edit3 size={size} />;
      case 'pen':
        return <PenTool size={size} />;
      case 'postit':
        return <StickyNote size={size} />;
      case 'sticker':
        return <Sparkles size={size} />;
      case 'emoji':
        return <Smile size={size} />;
    }
  };

  const isPhone = viewportMode === 'phone';
  const isTablet = viewportMode === 'tablet';
  const totalMarksCount = bookAnnotations.length + bookBookmarks.length;
  const roomParticipantsCount = activeRoom ? Object.keys(activeRoom.participants || {}).length : 0;

  return (
    <div
      className="reader-overlay"
      data-reader-viewport={viewportMode}
      style={
        {
          background: pal.bg,
          color: pal.fg,
          filter: `brightness(${readerSettings.brightness}%)`,
          colorScheme: pal.isDark ? 'dark' : 'light',
          '--reader-bar': pal.bar,
          '--reader-border': pal.border,
          '--shell-bg': pal.bg,
          '--sidebar-bg': pal.surface,
          '--banner-bg': pal.surface,
          '--card-bg': pal.inputBg,
          '--input-bg': pal.inputBg,
          '--text-primary': pal.fg,
          '--text-muted': pal.muted,
          '--border-subtle': pal.border,
          '--border-strong': pal.border,
        } as React.CSSProperties
      }
    >
      {/* Blue-light warmth overlay */}
      {readerSettings.warmth > 0 && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            background: `rgba(255, 175, 70, ${readerSettings.warmth / 260})`,
            zIndex: 120,
          }}
        />
      )}

      {/* Adaptive Top Bar (auto-compacts on phone/tablet/desktop with zero overlap) */}
      <header
        className={`reader-topbar is-${viewportMode}`}
        style={{ background: pal.bar, borderBottom: `1px solid ${pal.border}` }}
      >
        <div className="reader-topbar-left">
          <button
            className="circle-arrow-btn reader-icon-btn"
            style={{ background: 'rgba(128,128,128,0.14)', color: pal.fg }}
            onClick={handleCloseReader}
            title="Volver a la biblioteca"
          >
            <ArrowLeft size={isPhone ? 16 : 17} />
          </button>
          <div className="reader-topbar-meta">
            <div className="reader-topbar-title">
              {seriesNav ? seriesNav.series.seriesName : activeBook.title}
            </div>
            <div className="reader-topbar-sub" style={{ color: pal.muted }}>
              {seriesNav
                ? `${seriesNav.series.chapters[seriesNav.currentIndex]?.label || activeBook.title} · `
                : livePos.chapter
                ? `${livePos.chapter} · `
                : `${activeBook.author} · `}
              {livePos.page ? `Pág. ${livePos.page} · ` : ''}
              {livePos.pct}%
            </div>
          </div>
        </div>

        <div className="reader-topbar-actions">
          {!isPhone && seriesNav && (
            <div className="reader-series-nav" role="group" aria-label="Cambiar capítulo de la serie">
              <button
                type="button"
                className="pill-btn reader-bar-pill"
                disabled={!seriesNav.prevEntry}
                style={{
                  background: 'rgba(128,128,128,0.16)',
                  color: pal.fg,
                  borderColor: 'transparent',
                  opacity: seriesNav.prevEntry ? 1 : 0.4,
                }}
                onClick={() => {
                  if (seriesNav.prevEntry) {
                    flushCurrentReadingPosition();
                    void openBook(seriesNav.prevEntry.book);
                  }
                }}
                title={
                  seriesNav.prevEntry
                    ? `Ir a ${seriesNav.prevEntry.label}`
                    : 'Primer paquete de la serie'
                }
              >
                <ChevronLeft size={13} />
                {!isTablet && <span>Ant.</span>}
              </button>
              <button
                type="button"
                className="pill-btn reader-bar-pill"
                style={{
                  background: 'rgba(128,128,128,0.16)',
                  color: pal.fg,
                  borderColor: 'transparent',
                }}
                onClick={() => {
                  const key = seriesNav.series.seriesKey;
                  closeReader();
                  setActiveSeriesKey(key);
                }}
                title="Ver todos los capítulos de esta serie"
              >
                <span>
                  {seriesNav.currentIndex + 1}/{seriesNav.series.chapters.length}
                </span>
              </button>
              <button
                type="button"
                className="pill-btn reader-bar-pill"
                disabled={!seriesNav.nextEntry}
                style={{
                  background: seriesNav.nextEntry
                    ? 'var(--accent-primary)'
                    : 'rgba(128,128,128,0.16)',
                  color: seriesNav.nextEntry ? 'var(--accent-contrast)' : pal.fg,
                  borderColor: 'transparent',
                  opacity: seriesNav.nextEntry ? 1 : 0.4,
                }}
                onClick={() => {
                  if (seriesNav.nextEntry) {
                    flushCurrentReadingPosition();
                    void openBook(seriesNav.nextEntry.book);
                  }
                }}
                title={
                  seriesNav.nextEntry
                    ? `Siguiente: ${seriesNav.nextEntry.label}`
                    : 'Último paquete disponible'
                }
              >
                {!isTablet && <span>Sig.</span>}
                <ChevronRight size={13} />
              </button>
            </div>
          )}
          {isPhone ? (
            <>
              <button
                type="button"
                className="circle-arrow-btn reader-icon-btn"
                style={{
                  background:
                    mobileToolsOpen || pinMode
                      ? 'var(--accent-primary)'
                      : 'rgba(128,128,128,0.14)',
                  color: mobileToolsOpen || pinMode ? 'var(--accent-contrast)' : pal.fg,
                }}
                onClick={() => {
                  setDrawer('none');
                  setMobileToolsOpen((v) => !v);
                }}
                title="Herramientas de lectura (Índice, Anotar, Nota rápida, Separador)"
              >
                <MoreHorizontal size={16} />
              </button>

              <button
                type="button"
                className="circle-arrow-btn reader-icon-btn"
                style={{
                  background: drawer === 'marks' ? 'var(--accent-primary)' : 'rgba(128,128,128,0.14)',
                  color: drawer === 'marks' ? 'var(--accent-contrast)' : pal.fg,
                }}
                onClick={() => {
                  setMobileToolsOpen(false);
                  setDrawer(drawer === 'marks' ? 'none' : 'marks');
                }}
                title="Separadores, Resaltados, Post-its y Stickers"
              >
                <Bookmark size={15} />
                {totalMarksCount > 0 && (
                  <span className="reader-icon-badge">
                    {totalMarksCount > 99 ? '99+' : totalMarksCount}
                  </span>
                )}
              </button>

              {activeRoom && (
                <button
                  type="button"
                  className="circle-arrow-btn reader-icon-btn"
                  style={{
                    background:
                      drawer === 'room' ? 'var(--accent-secondary)' : 'rgba(128,128,128,0.14)',
                    color: drawer === 'room' ? 'var(--accent-secondary-contrast)' : pal.fg,
                  }}
                  onClick={() => {
                    setMobileToolsOpen(false);
                    setDrawer(drawer === 'room' ? 'none' : 'room');
                  }}
                  title={`Sala compartida ${activeRoom.code}`}
                >
                  <Users size={15} />
                  <span className="reader-icon-badge">{roomParticipantsCount}</span>
                </button>
              )}

              <button
                type="button"
                className="circle-arrow-btn reader-icon-btn"
                style={{
                  background:
                    drawer === 'settings' ? 'var(--accent-primary)' : 'rgba(128,128,128,0.14)',
                  color: drawer === 'settings' ? 'var(--accent-contrast)' : pal.fg,
                }}
                onClick={() => {
                  setMobileToolsOpen(false);
                  setDrawer(drawer === 'settings' ? 'none' : 'settings');
                }}
                title="Ajustes del lector"
              >
                <Settings2 size={15} />
              </button>
            </>
          ) : (
            <>
              {toc.length > 0 && (
                <button
                  type="button"
                  className="circle-arrow-btn reader-icon-btn"
                  style={{
                    background:
                      drawer === 'toc' ? 'var(--accent-secondary)' : 'rgba(128,128,128,0.14)',
                    color: drawer === 'toc' ? 'var(--accent-secondary-contrast)' : pal.fg,
                  }}
                  onClick={() => setDrawer(drawer === 'toc' ? 'none' : 'toc')}
                  title="Índice de capítulos"
                >
                  <List size={16} />
                </button>
              )}

              {supportsPinMode && (
                <button
                  type="button"
                  className="pill-btn reader-bar-pill"
                  style={{
                    background: pinMode ? 'var(--accent-primary)' : 'rgba(128,128,128,0.16)',
                    color: pinMode ? 'var(--accent-contrast)' : pal.fg,
                    borderColor: 'transparent',
                  }}
                  onClick={() => {
                    setPinMode(!pinMode);
                    if (!pinMode) showToast('Toca cualquier parte de la página para fijar un Post-it, sticker o marca');
                  }}
                  title="Activar modo anotar en página (Post-it, stickers, emojis)"
                >
                  <MapPin size={13} />
                  <span>{pinMode ? (isTablet ? 'Tocando' : 'Tocando pág...') : isTablet ? 'Anotar' : 'Anotar pág.'}</span>
                </button>
              )}

              <button
                type="button"
                className="circle-arrow-btn reader-icon-btn"
                style={{ background: 'rgba(128,128,128,0.14)', color: pal.fg }}
                onClick={handleOpenQuickMarkAtCurrentPos}
                title="Añadir Post-it, resaltado, sticker o emoji aquí"
              >
                <Highlighter size={15} />
              </button>

              <button
                type="button"
                className="circle-arrow-btn reader-icon-btn"
                style={{ background: 'rgba(128,128,128,0.14)', color: pal.fg }}
                onClick={() => handlePlaceVisualBookmark()}
                title="Colocar separador de página aquí"
              >
                <BookmarkPlus size={16} />
              </button>

              <button
                type="button"
                className={isTablet ? 'circle-arrow-btn reader-icon-btn' : 'pill-btn reader-bar-pill'}
                style={{
                  background: drawer === 'marks' ? 'var(--accent-primary)' : 'rgba(128,128,128,0.16)',
                  color: drawer === 'marks' ? 'var(--accent-contrast)' : pal.fg,
                  borderColor: 'transparent',
                }}
                onClick={() => setDrawer(drawer === 'marks' ? 'none' : 'marks')}
                title="Separadores, Resaltados, Post-its y Stickers"
              >
                <Bookmark size={isTablet ? 15 : 13} />
                {!isTablet && <span>Marcas</span>}
                {isTablet && totalMarksCount > 0 && (
                  <span className="reader-icon-badge">
                    {totalMarksCount > 99 ? '99+' : totalMarksCount}
                  </span>
                )}
              </button>

              {activeRoom && (
                <button
                  type="button"
                  className="pill-btn reader-bar-pill"
                  style={{
                    background:
                      drawer === 'room' ? 'var(--accent-secondary)' : 'rgba(128,128,128,0.16)',
                    color: drawer === 'room' ? 'var(--accent-secondary-contrast)' : pal.fg,
                    borderColor: 'transparent',
                  }}
                  onClick={() => setDrawer(drawer === 'room' ? 'none' : 'room')}
                  title={`Sala compartida ${activeRoom.code}`}
                >
                  <Users size={13} />
                  <span>{isTablet ? roomParticipantsCount : `Sala (${roomParticipantsCount})`}</span>
                </button>
              )}

              <button
                type="button"
                className="circle-arrow-btn reader-icon-btn"
                style={{
                  background:
                    drawer === 'settings' ? 'var(--accent-primary)' : 'rgba(128,128,128,0.14)',
                  color: drawer === 'settings' ? 'var(--accent-contrast)' : pal.fg,
                }}
                onClick={() => setDrawer(drawer === 'settings' ? 'none' : 'settings')}
                title="Ajustes del lector"
              >
                <Settings2 size={16} />
              </button>
            </>
          )}
        </div>
      </header>

      {/* Compact Secondary Tools Strip on Phone (clean, spacious, zero overlapping) */}
      {isPhone && mobileToolsOpen && (
        <div
          className="reader-subtoolbar"
          style={{ background: pal.bar, borderBottom: `1px solid ${pal.border}` }}
        >
          {toc.length > 0 && (
            <button
              type="button"
              className="pill-btn reader-sub-btn"
              style={{
                background: drawer === 'toc' ? 'var(--accent-secondary)' : 'rgba(128,128,128,0.14)',
                color: drawer === 'toc' ? 'var(--accent-secondary-contrast)' : pal.fg,
                borderColor: 'transparent',
              }}
              onClick={() => {
                setMobileToolsOpen(false);
                setDrawer(drawer === 'toc' ? 'none' : 'toc');
              }}
            >
              <List size={13} /> Índice
            </button>
          )}

          {supportsPinMode && (
            <button
              type="button"
              className="pill-btn reader-sub-btn"
              style={{
                background: pinMode ? 'var(--accent-primary)' : 'rgba(128,128,128,0.14)',
                color: pinMode ? 'var(--accent-contrast)' : pal.fg,
                borderColor: 'transparent',
              }}
              onClick={() => {
                const next = !pinMode;
                setPinMode(next);
                setMobileToolsOpen(false);
                if (next) showToast('Toca cualquier parte de la página para fijar una marca');
              }}
            >
              <MapPin size={13} /> {pinMode ? 'Salir de anotar' : 'Anotar pág.'}
            </button>
          )}

          <button
            type="button"
            className="pill-btn reader-sub-btn"
            style={{ background: 'rgba(128,128,128,0.14)', color: pal.fg, borderColor: 'transparent' }}
            onClick={() => {
              setMobileToolsOpen(false);
              handleOpenQuickMarkAtCurrentPos();
            }}
          >
            <Highlighter size={13} /> Nota rápida
          </button>

          <button
            type="button"
            className="pill-btn reader-sub-btn"
            style={{ background: 'rgba(128,128,128,0.14)', color: pal.fg, borderColor: 'transparent' }}
            onClick={() => {
              setMobileToolsOpen(false);
              void handlePlaceVisualBookmark();
            }}
          >
            <BookmarkPlus size={13} /> Separador
          </button>

          {seriesNav && (
            <>
              {seriesNav.prevEntry && (
                <button
                  type="button"
                  className="pill-btn reader-sub-btn"
                  style={{ background: 'rgba(128,128,128,0.14)', color: pal.fg, borderColor: 'transparent' }}
                  onClick={() => {
                    setMobileToolsOpen(false);
                    if (seriesNav.prevEntry) {
                      flushCurrentReadingPosition();
                      void openBook(seriesNav.prevEntry.book);
                    }
                  }}
                >
                  <ChevronLeft size={13} /> {seriesNav.prevEntry.label}
                </button>
              )}
              {seriesNav.nextEntry && (
                <button
                  type="button"
                  className="pill-btn reader-sub-btn"
                  style={{
                    background: 'var(--accent-primary)',
                    color: 'var(--accent-contrast)',
                    borderColor: 'transparent',
                  }}
                  onClick={() => {
                    setMobileToolsOpen(false);
                    if (seriesNav.nextEntry) {
                      flushCurrentReadingPosition();
                      void openBook(seriesNav.nextEntry.book);
                    }
                  }}
                >
                  {seriesNav.nextEntry.label} <ChevronRight size={13} />
                </button>
              )}
              <button
                type="button"
                className="pill-btn reader-sub-btn"
                style={{ background: 'rgba(128,128,128,0.14)', color: pal.fg, borderColor: 'transparent' }}
                onClick={() => {
                  const key = seriesNav.series.seriesKey;
                  setMobileToolsOpen(false);
                  closeReader();
                  setActiveSeriesKey(key);
                }}
              >
                <List size={13} /> Capítulos ({seriesNav.series.chapters.length})
              </button>
            </>
          )}
        </div>
      )}

      {/* Slim indicator when page-pin mode is active on phone */}
      {isPhone && pinMode && !mobileToolsOpen && (
        <div
          className="reader-pin-banner"
          style={{ background: pal.bar, borderBottom: `1px solid ${pal.border}` }}
        >
          <span>
            <MapPin size={12} /> Toca en la página para fijar una marca
          </span>
          <button
            type="button"
            className="pill-btn"
            style={{
              height: 24,
              padding: '0 10px',
              fontSize: 10.5,
              background: 'var(--accent-primary)',
              color: 'var(--accent-contrast)',
              borderColor: 'transparent',
            }}
            onClick={() => setPinMode(false)}
          >
            Listo
          </button>
        </div>
      )}

      {/* Main Reader Stage */}
      <main
        className="reader-stage"
        onPointerDown={tuckBookmarkNow}
        onWheel={tuckBookmarkNow}
      >
        {/* Visual Hanging Physical Bookmark (Separador de Libro) */}
        {shouldRenderHangingBookmark && displayedHangingDesign && (
          <button
            type="button"
            className={`reader-hanging-bookmark ${bookmarkTucked ? 'reading-tucked' : ''} ${
              matchedBookmarkAtCurrentPos || activeJumpedBookmarkDesignId ? 'is-at-bookmark' : ''
            }`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              setBookmarkTucked(false);
              setMarksTab(matchedBookmarkAtCurrentPos ? 'marcadores' : 'separadores');
              setDrawer('marks');
            }}
            title={
              matchedBookmarkAtCurrentPos
                ? `Separador guardado aquí: ${displayedHangingDesign.name} — Pulsa para ver o cambiar`
                : `Separador: ${displayedHangingDesign.name} — Pulsa para cambiar o marcar página`
            }
          >
            <img src={displayedHangingDesign.imageUrl} alt={displayedHangingDesign.name} />
            {(matchedBookmarkAtCurrentPos || activeJumpedBookmarkDesignId) && !bookmarkTucked && (
              <span className="reader-hanging-bookmark-tag">Aquí</span>
            )}
          </button>
        )}

        {!fileData ? (
          <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>Cargando archivo...</div>
        ) : isComicLike ? (
          <ComicMangaReader
            book={activeBook}
            blob={fileData.blob}
            extraImages={fileData.extraImages}
            settings={readerSettings}
            annotations={bookAnnotations}
            bookmarks={bookBookmarks}
            bookmarkDesigns={allBookmarkDesigns}
            defaultBookmarkDesign={activeBookmarkDesign}
            jumpTarget={effectiveJumpTarget}
            pinMode={pinMode}
            hasOpenOverlay={hasOpenOverlay}
            viewportMode={viewportMode}
            nextSeriesLabel={seriesNav?.nextEntry?.label}
            onOpenNextSeriesPack={seriesNav?.nextEntry ? handleOpenNextSeriesPack : undefined}
            onTextSelect={handleIncomingSelection}
            onAnnotationClick={handleAnnotationClick}
            onBookmarkClick={handleBookmarkClickInReader}
            onUpdateSettings={updateReaderSettings}
            onRegisterFlush={registerReaderFlush}
            onProgress={(page, total, scrollRatio) => {
              const pct = total ? Math.round((page / total) * 100) : 0;
              const nextLive = {
                ...livePosRef.current,
                page,
                pageCount: total,
                pct,
                ...(scrollRatio !== undefined ? { scrollRatio } : {}),
              };
              livePosRef.current = nextLive;
              setLivePos(nextLive);
              updateBook(activeBook.id, {
                currentPage: page,
                pageCount: total,
                progress: pct,
                ...(scrollRatio !== undefined ? { scrollRatio } : {}),
              });
            }}
          />
        ) : isPdf ? (
          <PdfReader
            book={activeBook}
            blob={fileData.blob}
            settings={readerSettings}
            annotations={bookAnnotations}
            bookmarks={bookBookmarks}
            bookmarkDesigns={allBookmarkDesigns}
            defaultBookmarkDesign={activeBookmarkDesign}
            jumpTarget={effectiveJumpTarget}
            pinMode={pinMode}
            hasOpenOverlay={hasOpenOverlay}
            viewportMode={viewportMode}
            nextSeriesLabel={seriesNav?.nextEntry?.label}
            onOpenNextSeriesPack={seriesNav?.nextEntry ? handleOpenNextSeriesPack : undefined}
            onTextSelect={handleIncomingSelection}
            onAnnotationClick={handleAnnotationClick}
            onBookmarkClick={handleBookmarkClickInReader}
            onUpdateSettings={updateReaderSettings}
            onRegisterFlush={registerReaderFlush}
            onProgress={(page, total, scrollRatio) => {
              const pct = total ? Math.round((page / total) * 100) : 0;
              const nextLive = {
                ...livePosRef.current,
                page,
                pageCount: total,
                pct,
                ...(scrollRatio !== undefined ? { scrollRatio } : {}),
              };
              livePosRef.current = nextLive;
              setLivePos(nextLive);
              updateBook(activeBook.id, {
                currentPage: page,
                pageCount: total,
                progress: pct,
                ...(scrollRatio !== undefined ? { scrollRatio } : {}),
              });
            }}
          />
        ) : isEpub ? (
          <EpubReader
            book={activeBook}
            blob={fileData.blob}
            settings={readerSettings}
            annotations={bookAnnotations}
            bookmarks={bookBookmarks}
            onTocLoaded={setToc}
            jumpHref={jumpHref}
            jumpTarget={effectiveJumpTarget}
            hasOpenOverlay={hasOpenOverlay}
            viewportMode={viewportMode}
            onTextSelect={handleIncomingSelection}
            onAnnotationClick={handleAnnotationClick}
            onBookmarkClick={handleBookmarkClickInReader}
            onRegisterFlush={registerReaderFlush}
            onProgress={(pct, cfi, chapter, chapterHref, page) => {
              const nextLive = { cfi, pct, chapter, chapterHref, page };
              livePosRef.current = nextLive;
              setLivePos(nextLive);
              updateBook(activeBook.id, {
                currentCfi: cfi,
                progress: pct,
                currentChapter: chapter,
                currentPage: page,
              });
            }}
          />
        ) : (
          <TextRichReader
            book={activeBook}
            blob={fileData.blob}
            settings={readerSettings}
            annotations={bookAnnotations}
            bookmarks={bookBookmarks}
            bookmarkDesigns={allBookmarkDesigns}
            defaultBookmarkDesign={activeBookmarkDesign}
            onTocLoaded={setToc}
            jumpHref={jumpHref}
            jumpTarget={effectiveJumpTarget}
            hasOpenOverlay={hasOpenOverlay}
            onTextSelect={handleIncomingSelection}
            onAnnotationClick={handleAnnotationClick}
            onBookmarkClick={handleBookmarkClickInReader}
            onRegisterFlush={registerReaderFlush}
            onProgress={(pct, scrollRatio, chapter, chapterHref) => {
              const nextLive = { scrollRatio, pct, chapter, chapterHref };
              livePosRef.current = nextLive;
              setLivePos(nextLive);
              updateBook(activeBook.id, {
                scrollRatio,
                progress: pct,
                currentChapter: chapter,
              });
            }}
          />
        )}

        {/* Floating Selection / Page Annotation Toolkit */}
        {pendingSel && (
          <form
            className="annotation-floating-dock"
            style={{ background: pal.bar, color: pal.fg, border: `1px solid ${pal.border}` }}
            onSubmit={handleSaveAnnotation}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>Marcar lectura</span>
                <span style={{ fontSize: 10.5, opacity: 0.72, fontWeight: 700 }}>
                  {pendingSel.chapter ? `${pendingSel.chapter} · ` : ''}
                  {pendingSel.page ? `Pág. ${pendingSel.page} · ` : ''}
                  {pendingSel.progress}%
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPendingSel(null)}
                style={{ color: pal.fg, display: 'grid', placeItems: 'center' }}
              >
                <X size={15} />
              </button>
            </div>

            {/* 6 Tool Buttons */}
            <div className="annotation-tool-tabs">
              {TOOL_LIST.map((tool) => (
                <button
                  key={tool}
                  type="button"
                  className={`annotation-tool-btn ${selTool === tool ? 'active' : ''}`}
                  onClick={() => handleSelectTool(tool)}
                >
                  {renderToolIcon(tool, 12)}
                  <span>{TOOL_META[tool].short}</span>
                </button>
              ))}
            </div>

            {/* Tool-specific picker (Named Stationery Colors + Variants / Categorized Stickers / Categorized Emojis + Custom Add) */}
            {selTool === 'sticker' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  {STICKER_GROUPS.map((grp) => (
                    <button
                      key={grp.id}
                      type="button"
                      className={`pill-btn ${selStickerGroup === grp.id ? 'active' : ''}`}
                      style={{ height: 24, fontSize: 10, padding: '0 8px' }}
                      onClick={() => setSelStickerGroup(grp.id)}
                    >
                      {grp.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`pill-btn ${addingCustomItem ? 'active' : ''}`}
                    style={{ height: 24, fontSize: 10, padding: '0 8px', marginLeft: 'auto' }}
                    onClick={() => setAddingCustomItem(!addingCustomItem)}
                  >
                    + Agregar sticker
                  </button>
                </div>

                {addingCustomItem && (
                  <div className="custom-stationery-inline">
                    <input
                      className="studio-input"
                      style={{ width: 52, textAlign: 'center', padding: '4px 6px' }}
                      placeholder="🌟"
                      value={newItemEmoji}
                      onChange={(e) => setNewItemEmoji(e.target.value)}
                    />
                    <input
                      className="studio-input"
                      style={{ flex: 1, minWidth: 110, padding: '4px 8px' }}
                      placeholder="Etiqueta (ej. Mi favorito)"
                      value={newItemName}
                      onChange={(e) => setNewItemName(e.target.value)}
                    />
                    <input
                      type="color"
                      value={newItemColor}
                      onChange={(e) => setNewItemColor(e.target.value)}
                      style={{ width: 28, height: 28, border: 'none', background: 'transparent', cursor: 'pointer' }}
                    />
                    <button
                      type="button"
                      className="pill-btn active"
                      style={{ height: 28, fontSize: 10.5, padding: '0 10px' }}
                      onClick={() => {
                        if (!newItemName.trim()) return;
                        addCustomSticker({
                          emoji: newItemEmoji || '✨',
                          label: newItemName.trim(),
                          color: newItemColor,
                          group: selStickerGroup,
                        });
                        setSelSticker(`${newItemEmoji || '✨'} ${newItemName.trim()}`);
                        setSelColor(newItemColor);
                        setNewItemName('');
                        setAddingCustomItem(false);
                      }}
                    >
                      Añadir
                    </button>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', maxHeight: 96, overflowY: 'auto' }}>
                  {[
                    ...customStationery.stickers.filter((st) => st.group === selStickerGroup),
                    ...READING_STICKERS.filter((st) => st.group === selStickerGroup),
                  ].map((st) => {
                    const val = `${st.emoji} ${st.label}`;
                    const active = selSticker === val;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        className="pill-btn"
                        style={{
                          height: 27,
                          fontSize: 11,
                          padding: '0 9px',
                          background: active ? st.color : 'rgba(128,128,128,0.14)',
                          color: active ? '#fff' : pal.fg,
                          borderColor: 'transparent',
                        }}
                        onClick={() => {
                          setSelSticker(val);
                          setSelColor(st.color);
                        }}
                      >
                        {val}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : selTool === 'emoji' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  {READING_EMOJI_GROUPS.map((grp) => (
                    <button
                      key={grp.id}
                      type="button"
                      className={`pill-btn ${selEmojiGroup === grp.id ? 'active' : ''}`}
                      style={{ height: 24, fontSize: 10, padding: '0 8px' }}
                      onClick={() => setSelEmojiGroup(grp.id)}
                    >
                      {grp.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`pill-btn ${addingCustomItem ? 'active' : ''}`}
                    style={{ height: 24, fontSize: 10, padding: '0 8px', marginLeft: 'auto' }}
                    onClick={() => setAddingCustomItem(!addingCustomItem)}
                  >
                    + Agregar emoji
                  </button>
                </div>

                {addingCustomItem && (
                  <div className="custom-stationery-inline">
                    <input
                      className="studio-input"
                      style={{ flex: 1, padding: '4px 8px' }}
                      placeholder="Pega o escribe cualquier emoji (ej. 🦊, 🥀, ⚡)"
                      value={newItemEmoji}
                      onChange={(e) => setNewItemEmoji(e.target.value)}
                    />
                    <button
                      type="button"
                      className="pill-btn active"
                      style={{ height: 28, fontSize: 10.5, padding: '0 10px' }}
                      onClick={() => {
                        if (!newItemEmoji.trim()) return;
                        addCustomEmoji(newItemEmoji.trim());
                        setSelEmoji(newItemEmoji.trim());
                        setAddingCustomItem(false);
                      }}
                    >
                      Añadir
                    </button>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxHeight: 84, overflowY: 'auto' }}>
                  {[
                    ...customStationery.emojis,
                    ...(
                      READING_EMOJI_GROUPS.find((g) => g.id === selEmojiGroup) ||
                      READING_EMOJI_GROUPS[0]
                    ).emojis,
                  ].map((em, idx) => (
                    <button
                      key={`${em}-${idx}`}
                      type="button"
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 9,
                        fontSize: 16,
                        background:
                          selEmoji === em ? 'var(--accent-primary)' : 'rgba(128,128,128,0.14)',
                        display: 'grid',
                        placeItems: 'center',
                      }}
                      onClick={() => setSelEmoji(em)}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {/* Stroke / Paper Style Variant Pills */}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, opacity: 0.72 }}>Estilo:</span>
                  {TOOL_META[selTool].variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className={`pill-btn ${selVariant === v.id ? 'active' : ''}`}
                      style={{ height: 24, fontSize: 10, padding: '0 8px' }}
                      onClick={() => setSelVariant(v.id)}
                    >
                      {v.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`pill-btn ${addingCustomItem ? 'active' : ''}`}
                    style={{ height: 24, fontSize: 10, padding: '0 8px', marginLeft: 'auto' }}
                    onClick={() => setAddingCustomItem(!addingCustomItem)}
                  >
                    + Agregar {TOOL_META[selTool].short.toLowerCase()}
                  </button>
                </div>

                {addingCustomItem && (
                  <div className="custom-stationery-inline">
                    <input
                      type="color"
                      value={newItemColor}
                      onChange={(e) => setNewItemColor(e.target.value)}
                      style={{ width: 28, height: 28, border: 'none', background: 'transparent', cursor: 'pointer' }}
                    />
                    <input
                      className="studio-input"
                      style={{ flex: 1, minWidth: 100, padding: '4px 8px' }}
                      placeholder={`Nombre (ej. ${TOOL_META[selTool].short} Coral)`}
                      value={newItemName}
                      onChange={(e) => setNewItemName(e.target.value)}
                    />
                    <input
                      className="studio-input"
                      style={{ flex: 1, minWidth: 100, padding: '4px 8px' }}
                      placeholder="Uso (ej. Escenas clave)"
                      value={newItemMeaning}
                      onChange={(e) => setNewItemMeaning(e.target.value)}
                    />
                    <button
                      type="button"
                      className="pill-btn active"
                      style={{ height: 28, fontSize: 10.5, padding: '0 10px' }}
                      onClick={() => {
                        addCustomSwatch({
                          tool: selTool as 'highlighter' | 'pencil' | 'pen' | 'postit',
                          color: newItemColor,
                          name: newItemName || `${TOOL_META[selTool].short} personalizado`,
                          meaning: newItemMeaning || 'Color personalizado',
                        });
                        setSelColor(newItemColor);
                        setNewItemName('');
                        setNewItemMeaning('');
                        setAddingCustomItem(false);
                      }}
                    >
                      Añadir
                    </button>
                  </div>
                )}

                {/* Curated + Custom Book Stationery Color Swatches + Active Meaning Legend */}
                {(() => {
                  const combinedSwatches = [
                    ...customStationery.swatches
                      .filter((s) => s.tool === selTool)
                      .map((s) => ({ color: s.color, name: s.name, meaning: s.meaning })),
                    ...TOOL_META[selTool].swatches,
                  ];
                  const activeSwatch = combinedSwatches.find(
                    (s) => s.color.toLowerCase() === selColor.toLowerCase()
                  );
                  return (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {combinedSwatches.map((sw, idx) => (
                          <button
                            key={`${sw.color}-${idx}`}
                            type="button"
                            onClick={() => setSelColor(sw.color)}
                            title={`${sw.name} — ${sw.meaning}`}
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: selTool === 'postit' ? 6 : '50%',
                              background: sw.color,
                              border:
                                selColor.toLowerCase() === sw.color.toLowerCase()
                                  ? `2.5px solid ${pal.fg}`
                                  : '1.5px solid rgba(128,128,128,0.38)',
                              transform:
                                selColor.toLowerCase() === sw.color.toLowerCase()
                                  ? 'scale(1.12)'
                                  : 'none',
                            }}
                            aria-label={sw.name}
                          />
                        ))}
                      </div>
                      {activeSwatch && (
                        <div style={{ fontSize: 10.5, opacity: 0.8, fontWeight: 700 }}>
                          {activeSwatch.name} ·{' '}
                          <span style={{ opacity: 0.8 }}>{activeSwatch.meaning}</span>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {/* Selected phrase preview / editable quote */}
            <input
              className="studio-input"
              placeholder="Frase, oración o palabra marcada..."
              value={selQuote}
              onChange={(e) => setSelQuote(e.target.value)}
            />

            {/* Optional Post-it / comment note */}
            <textarea
              className="studio-input"
              rows={selTool === 'postit' ? 3 : 2}
              placeholder={
                selTool === 'postit'
                  ? 'Escribe tu Post-it adhesivo aquí...'
                  : 'Añade un comentario opcional sobre esta frase...'
              }
              value={selNote}
              onChange={(e) => setSelNote(e.target.value)}
            />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={syncAlsoBookmark}
                  onChange={(e) => setSyncAlsoBookmark(e.target.checked)}
                />
                Sincronizar también como marcador de página
              </label>

              <button type="submit" className="coral-cta-btn" style={{ height: 33, padding: '0 16px', fontSize: 12 }}>
                Guardar {TOOL_META[selTool].short}
              </button>
            </div>
          </form>
        )}
      </main>

      {/* Bookmarks, Separadores & Annotations Drawer */}
      {drawer === 'marks' && (
        <aside
          className="reader-drawer"
          style={{ width: 345, background: pal.bar, color: pal.fg, borderLeft: `1px solid ${pal.border}` }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 14 }}>Separadores y Anotaciones</strong>
            <button onClick={() => setDrawer('none')} style={{ color: pal.fg }}>
              <X size={16} />
            </button>
          </div>

          {/* 3 Sub-tabs */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 4,
              background: 'rgba(128,128,128,0.12)',
              padding: 3,
              borderRadius: 11,
            }}
          >
            {(
              [
                { id: 'separadores', label: 'Separadores' },
                { id: 'anotaciones', label: 'Notas' },
                { id: 'marcadores', label: 'Págs' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setMarksTab(tab.id)}
                style={{
                  padding: '6px 4px',
                  borderRadius: 9,
                  fontSize: 11,
                  fontWeight: 800,
                  background: marksTab === tab.id ? 'var(--accent-primary)' : 'transparent',
                  color: marksTab === tab.id ? 'var(--accent-contrast)' : pal.fg,
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {marksTab === 'separadores' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, maxWidth: '100%' }}>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="coral-cta-btn"
                  style={{ flex: '1 1 130px', height: 31, fontSize: 11, padding: '0 10px', justifyContent: 'center' }}
                  onClick={() => handlePlaceVisualBookmark()}
                >
                  <BookmarkPlus size={13} /> Marcar ({livePos.page ? `P.${livePos.page}` : `${livePos.pct}%`})
                </button>
                <button
                  type="button"
                  className="pill-btn"
                  style={{ height: 31, minHeight: 31, fontSize: 10.5, padding: '0 9px' }}
                  onClick={() =>
                    handleSelectBookmarkDesign(
                      effectiveBookmarkDesignId === 'none'
                        ? allBookmarkDesigns[0]?.id || ''
                        : 'none'
                    )
                  }
                >
                  {showHangingBookmark && activeBookmarkDesign ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>

              {bookBookmarks.length > 0 && (
                <div
                  style={{
                    background: 'rgba(128,128,128,0.1)',
                    borderRadius: 11,
                    padding: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                  }}
                >
                  <div style={{ fontSize: 10.5, fontWeight: 800, opacity: 0.85 }}>
                    Tus separadores en este libro ({bookBookmarks.length})
                  </div>
                  {bookBookmarks.slice(0, 4).map((bm) => {
                    const bmDesign =
                      allBookmarkDesigns.find((d) => d.id === bm.designId) || activeBookmarkDesign;
                    return (
                      <div
                        key={bm.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 7,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          {bmDesign && (
                            <img
                              src={bmDesign.imageUrl}
                              alt={bmDesign.name}
                              style={{
                                width: 13,
                                height: 24,
                                objectFit: 'cover',
                                borderRadius: 3,
                                flexShrink: 0,
                              }}
                            />
                          )}
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {bm.label}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="pill-btn"
                          style={{ height: 22, minHeight: 22, fontSize: 10, padding: '0 8px', flexShrink: 0 }}
                          onClick={() =>
                            triggerJump({
                              cfi: bm.cfi,
                              chapterHref: bm.chapterHref,
                              page: bm.page,
                              scrollRatio: bm.scrollRatio,
                              bookmarkId: bm.id,
                              bookmarkDesignId: bm.designId,
                            })
                          }
                        >
                          Ir
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ fontSize: 11, fontWeight: 800, opacity: 0.8 }}>
                Elige tu separador
              </div>

              <div className="bookmark-design-grid">
                {allBookmarkDesigns.map((design) => {
                  const selected = activeBookmarkDesign?.id === design.id;
                  return (
                    <div
                      key={design.id}
                      className={`bookmark-design-card ${selected ? 'selected' : ''}`}
                      onClick={() => handleSelectBookmarkDesign(design.id)}
                      role="button"
                      tabIndex={0}
                      title={design.name}
                    >
                      <div className="bookmark-design-thumb">
                        <img src={design.imageUrl} alt={design.name} loading="lazy" />
                        {!design.builtin && (
                          <button
                            type="button"
                            className="bookmark-design-del"
                            title="Eliminar separador personalizado"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteCustomBookmarkDesign(design.id);
                            }}
                          >
                            <Trash2 size={10} />
                          </button>
                        )}
                      </div>
                      <span className="bookmark-design-name">{design.name}</span>
                    </div>
                  );
                })}
              </div>

              {/* Add more custom bookmarks */}
              <div
                style={{
                  background: 'rgba(128,128,128,0.1)',
                  borderRadius: 11,
                  padding: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 800 }}>+ Separador personalizado</div>
                <input
                  className="studio-input"
                  style={{ height: 30, fontSize: 11, padding: '0 9px' }}
                  placeholder="Nombre (opcional)"
                  value={customBmName}
                  onChange={(e) => setCustomBmName(e.target.value)}
                />
                <button
                  type="button"
                  className="pill-btn"
                  style={{ justifyContent: 'center', height: 30, minHeight: 30, fontSize: 11 }}
                  onClick={() => customBmInputRef.current?.click()}
                >
                  <ImagePlus size={12} /> Elegir imagen
                </button>
                <input
                  ref={customBmInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={handleUploadCustomBookmark}
                />
              </div>
            </div>
          ) : marksTab === 'anotaciones' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  className={`pill-btn ${annFilter === 'all' ? 'active' : ''}`}
                  style={{ height: 24, fontSize: 10.5, padding: '0 8px' }}
                  onClick={() => setAnnFilter('all')}
                >
                  Todas
                </button>
                {TOOL_LIST.map((tool) => {
                  const hasAny = bookAnnotations.some((a) => a.tool === tool);
                  if (!hasAny) return null;
                  return (
                    <button
                      key={tool}
                      type="button"
                      className={`pill-btn ${annFilter === tool ? 'active' : ''}`}
                      style={{ height: 24, fontSize: 10.5, padding: '0 8px' }}
                      onClick={() => setAnnFilter(tool)}
                    >
                      {TOOL_META[tool].short}
                    </button>
                  );
                })}
                {filteredAnnotations.length > 0 && (
                  <button
                    type="button"
                    className="pill-btn"
                    style={{ height: 24, fontSize: 10, padding: '0 8px', marginLeft: 'auto' }}
                    onClick={() => {
                      const next = !expandAllDrawer;
                      setExpandAllDrawer(next);
                      setExpandedDrawerIds({});
                    }}
                  >
                    {expandAllDrawer ? 'Compactar' : 'Desglosar'}
                  </button>
                )}
              </div>

              <button
                type="button"
                className="pill-btn"
                style={{ justifyContent: 'center', height: 30, fontSize: 11 }}
                onClick={handleOpenQuickMarkAtCurrentPos}
              >
                <Highlighter size={12} /> Nueva nota / post-it / sticker aquí
              </button>

              {filteredAnnotations.length === 0 ? (
                <div style={{ fontSize: 11.5, opacity: 0.75, lineHeight: 1.45 }}>
                  Selecciona cualquier palabra, frase u oración mientras lees (o usa "Anotar pág." en PDF/Manga) para marcar con resaltador, lápiz, bolígrafo, post-it, stickers o emojis.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {filteredAnnotations.map((ann) => {
                    const isOpen = expandAllDrawer || Boolean(expandedDrawerIds[ann.id]);
                    return (
                      <div
                        key={ann.id}
                        className={`compact-mark-row ${isOpen ? 'expanded' : ''} ${focusedAnnId === ann.id ? 'focused' : ''}`}
                        style={{
                          borderLeft: `3.5px solid ${ann.color}`,
                          background:
                            isOpen && ann.tool === 'postit'
                              ? `color-mix(in srgb, ${ann.color} 22%, transparent)`
                              : 'rgba(128,128,128,0.1)',
                        }}
                      >
                        <div className="compact-mark-head">
                          <button
                            type="button"
                            className="compact-mark-toggle"
                            style={{ color: pal.fg }}
                            onClick={() =>
                              setExpandedDrawerIds((prev) => ({
                                ...prev,
                                [ann.id]: !isOpen,
                              }))
                            }
                            title={isOpen ? 'Compactar' : 'Desglosar detalle'}
                          >
                            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            <span className="compact-mark-icon" style={{ color: ann.color }}>
                              {renderToolIcon(ann.tool, 11)}
                            </span>
                            <span className="compact-mark-snippet">
                              {ann.sticker ? `${ann.sticker} · ` : ''}
                              {ann.quote}
                            </span>
                          </button>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                            <span style={{ fontSize: 9.5, opacity: 0.7, fontWeight: 700 }}>
                              {ann.page ? `P.${ann.page}` : `${Math.round(ann.progress)}%`}
                            </span>
                            <button
                              type="button"
                              className="pill-btn"
                              style={{ height: 21, fontSize: 10, padding: '0 6px' }}
                              onClick={() =>
                                triggerJump({
                                  annotationId: ann.id,
                                  cfi: ann.cfi,
                                  chapterHref: ann.chapterHref,
                                  page: ann.page,
                                  scrollRatio: ann.scrollRatio,
                                  quote: ann.quote,
                                })
                              }
                            >
                              Ir
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteAnnotation(ann.id)}
                              style={{ color: pal.muted, display: 'grid', placeItems: 'center' }}
                              title="Eliminar marca"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>

                        {isOpen && (
                          <div className="compact-mark-body">
                            <div style={{ fontSize: 10, opacity: 0.75, fontWeight: 700 }}>
                              {TOOL_META[ann.tool].label}
                              {ann.sticker ? ` · ${ann.sticker}` : ''}
                              {ann.chapter ? ` · ${ann.chapter}` : ''}
                              {ann.page ? ` · Pág. ${ann.page}` : ''} · {Math.round(ann.progress)}%
                            </div>

                            <div
                              className={`ann-quote-preview tool-${ann.tool}${ann.styleVariant ? ` komo-variant-${ann.styleVariant}` : ''}`}
                              style={{ '--mark-color': ann.color } as React.CSSProperties}
                            >
                              “{ann.quote}”
                            </div>

                            {ann.note && (
                              <div style={{ fontSize: 11.5, lineHeight: 1.4 }}>{ann.note}</div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                type="button"
                className="coral-cta-btn"
                style={{ justifyContent: 'center', height: 32, fontSize: 11.5 }}
                onClick={() => handlePlaceVisualBookmark()}
              >
                <BookmarkPlus size={14} /> Guardar marcador en este punto
              </button>

              {bookBookmarks.length === 0 ? (
                <div style={{ fontSize: 11.5, opacity: 0.75 }}>
                  Todavía no guardaste marcadores de página en este libro.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {bookBookmarks.map((bm) => {
                    const design =
                      allBookmarkDesigns.find((d) => d.id === bm.designId) || activeBookmarkDesign;
                    const isOpen = Boolean(expandedDrawerIds[bm.id]);
                    return (
                      <div
                        key={bm.id}
                        className={`compact-mark-row ${isOpen ? 'expanded' : ''}`}
                        style={{ background: 'rgba(128,128,128,0.1)' }}
                      >
                        <div className="compact-mark-head">
                          <button
                            type="button"
                            className="compact-mark-toggle"
                            style={{ color: pal.fg }}
                            onClick={() =>
                              setExpandedDrawerIds((prev) => ({
                                ...prev,
                                [bm.id]: !isOpen,
                              }))
                            }
                          >
                            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            {design && (
                              <img
                                src={design.imageUrl}
                                alt={design.name}
                                style={{
                                  width: 14,
                                  height: 28,
                                  objectFit: 'cover',
                                  borderRadius: 3,
                                  flexShrink: 0,
                                }}
                              />
                            )}
                            <span className="compact-mark-snippet" style={{ fontWeight: 700 }}>
                              {bm.label}
                            </span>
                          </button>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                            <button
                              type="button"
                              className="pill-btn"
                              style={{ height: 21, fontSize: 10, padding: '0 6px' }}
                              onClick={() =>
                                triggerJump({
                                  cfi: bm.cfi,
                                  chapterHref: bm.chapterHref,
                                  page: bm.page,
                                  scrollRatio: bm.scrollRatio,
                                  bookmarkId: bm.id,
                                  bookmarkDesignId: bm.designId,
                                })
                              }
                            >
                              Ir
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteBookmark(bm.id)}
                              style={{ color: pal.muted, display: 'grid', placeItems: 'center' }}
                              title="Eliminar marcador"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>

                        {isOpen && (
                          <div
                            className="compact-mark-body"
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
                          >
                            {design && (
                              <img
                                src={design.imageUrl}
                                alt={design.name}
                                style={{
                                  width: 34,
                                  height: 78,
                                  objectFit: 'cover',
                                  borderRadius: 5,
                                  flexShrink: 0,
                                }}
                              />
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 11.5, fontWeight: 800 }}>{bm.label}</div>
                              {bm.excerpt && (
                                <div style={{ fontSize: 11, opacity: 0.8, marginTop: 3 }}>
                                  “{bm.excerpt}”
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </aside>
      )}

      {/* Settings Drawer */}
      {drawer === 'settings' && (
        <aside
          className="reader-drawer"
          style={{ background: pal.bar, color: pal.fg, borderLeft: `1px solid ${pal.border}` }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 14 }}>Personalizar Lector</strong>
            <button onClick={() => setDrawer('none')} style={{ color: pal.fg }}>
              <X size={16} />
            </button>
          </div>

          {/* Reader Theme */}
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>Tema de lectura</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 5 }}>
              {(['cream', 'paper', 'sepia', 'dark', 'oled'] as ReaderSettings['theme'][]).map(
                (t) => (
                  <button
                    key={t}
                    onClick={() => updateReaderSettings({ theme: t })}
                    style={{
                      height: 34,
                      minWidth: 0,
                      padding: '0 2px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      borderRadius: 10,
                      background: READER_PALETTES[t].bg,
                      color: READER_PALETTES[t].fg,
                      border:
                        readerSettings.theme === t
                          ? '2.5px solid var(--accent-primary)'
                          : '1px solid rgba(128,128,128,0.35)',
                      fontSize: 10,
                      fontWeight: 800,
                      textTransform: 'capitalize',
                    }}
                  >
                    {t}
                  </button>
                )
              )}
            </div>
          </div>

          {/* Comic / Manga / Manhwa Specific Controls */}
          {isComicLike && (
            <>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>
                  Modo Manga / Manhwa / Cómic
                </div>
                <select
                  className="studio-input"
                  value={readerSettings.comicMode}
                  onChange={(e) =>
                    updateReaderSettings({ comicMode: e.target.value as ComicReadMode })
                  }
                >
                  <option value="manhwa-strip">Manhwa / Webtoon (Tira vertical continua)</option>
                  <option value="manga-rtl">Manga (Derecha → Izquierda, 1 pág)</option>
                  <option value="manga-rtl-double">Manga (Doble página RTL)</option>
                  <option value="comic-ltr">Cómic (Izquierda → Derecha, 1 pág)</option>
                  <option value="comic-ltr-double">Cómic (Doble página LTR)</option>
                </select>
              </div>

              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>Ajuste de imagen</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
                  {(['width', 'contain', 'height', 'original'] as const).map((fit) => (
                    <button
                      key={fit}
                      className={`pill-btn ${readerSettings.comicFit === fit ? 'active' : ''}`}
                      style={{ justifyContent: 'center' }}
                      onClick={() => updateReaderSettings({ comicFit: fit })}
                    >
                      {fit === 'width'
                        ? 'Ancho'
                        : fit === 'contain'
                        ? 'Pantalla'
                        : fit === 'height'
                        ? 'Alto'
                        : 'Original'}
                    </button>
                  ))}
                </div>
              </div>

              {readerSettings.comicMode === 'manhwa-strip' && (
                <label style={{ fontSize: 11.5, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span>Separación entre paneles: {readerSettings.comicGap}px</span>
                  <input
                    type="range"
                    min={0}
                    max={24}
                    value={readerSettings.comicGap}
                    onChange={(e) => updateReaderSettings({ comicGap: Number(e.target.value) })}
                  />
                </label>
              )}
            </>
          )}

          {/* PDF Reading Flow & Fit Controls */}
          {isPdf && (
            <>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>Modo de lectura PDF</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
                  <button
                    className={`pill-btn ${(readerSettings.pdfFlow || 'continuous') === 'continuous' ? 'active' : ''}`}
                    style={{ justifyContent: 'center' }}
                    onClick={() => updateReaderSettings({ pdfFlow: 'continuous' })}
                  >
                    Scroll continuo
                  </button>
                  <button
                    className={`pill-btn ${readerSettings.pdfFlow === 'paginated' ? 'active' : ''}`}
                    style={{ justifyContent: 'center' }}
                    onClick={() => updateReaderSettings({ pdfFlow: 'paginated' })}
                  >
                    Página por página
                  </button>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>Ajuste de página PDF</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
                  <button
                    className={`pill-btn ${(readerSettings.pdfFit || 'width') === 'width' ? 'active' : ''}`}
                    style={{ justifyContent: 'center' }}
                    onClick={() => updateReaderSettings({ pdfFit: 'width' })}
                  >
                    Ajustar al ancho
                  </button>
                  <button
                    className={`pill-btn ${readerSettings.pdfFit === 'contain' ? 'active' : ''}`}
                    style={{ justifyContent: 'center' }}
                    onClick={() => updateReaderSettings({ pdfFit: 'contain' })}
                  >
                    Pantalla completa
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Book / EPUB / Text Typography Controls */}
          {!isComicLike && !isPdf && (
            <>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>Tipografía</div>
                <select
                  className="studio-input"
                  value={readerSettings.fontFamily}
                  onChange={(e) =>
                    updateReaderSettings({
                      fontFamily: e.target.value as ReaderSettings['fontFamily'],
                    })
                  }
                >
                  <option value="Lora">Lora (Editorial Serif)</option>
                  <option value="Georgia">Georgia Clásica</option>
                  <option value="Nunito">Nunito (Suave)</option>
                  <option value="Quicksand">Quicksand (Redondeada)</option>
                  <option value="Inter">Inter (Moderna)</option>
                  <option value="monospace">Monospace</option>
                </select>
              </div>

              <label style={{ fontSize: 11.5, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span>Tamaño de texto: {readerSettings.fontSize}px</span>
                <input
                  type="range"
                  min={13}
                  max={30}
                  value={readerSettings.fontSize}
                  onChange={(e) => updateReaderSettings({ fontSize: Number(e.target.value) })}
                />
              </label>

              <label style={{ fontSize: 11.5, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span>Interlineado: {readerSettings.lineHeight}</span>
                <input
                  type="range"
                  min={1.2}
                  max={2.4}
                  step={0.05}
                  value={readerSettings.lineHeight}
                  onChange={(e) => updateReaderSettings({ lineHeight: Number(e.target.value) })}
                />
              </label>

              <label style={{ fontSize: 11.5, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span>Ancho de columna: {readerSettings.maxWidth}px</span>
                <input
                  type="range"
                  min={520}
                  max={1050}
                  step={20}
                  value={readerSettings.maxWidth}
                  onChange={(e) => updateReaderSettings({ maxWidth: Number(e.target.value) })}
                />
              </label>

              {isEpub && (
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>Flujo EPUB</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <button
                      className={`pill-btn ${readerSettings.epubFlow === 'scrolled' ? 'active' : ''}`}
                      style={{ justifyContent: 'center' }}
                      onClick={() => updateReaderSettings({ epubFlow: 'scrolled' })}
                    >
                      Scroll continuo
                    </button>
                    <button
                      className={`pill-btn ${readerSettings.epubFlow === 'paginated' ? 'active' : ''}`}
                      style={{ justifyContent: 'center' }}
                      onClick={() => updateReaderSettings({ epubFlow: 'paginated' })}
                    >
                      Paginado
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Brightness & Blue Light Warmth */}
          <label style={{ fontSize: 11.5, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Sun size={13} /> Brillo: {readerSettings.brightness}%
            </span>
            <input
              type="range"
              min={55}
              max={115}
              value={readerSettings.brightness}
              onChange={(e) => updateReaderSettings({ brightness: Number(e.target.value) })}
            />
          </label>

          <label style={{ fontSize: 11.5, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Filtro luz cálida (noche): {readerSettings.warmth}%</span>
            <input
              type="range"
              min={0}
              max={60}
              value={readerSettings.warmth}
              onChange={(e) => updateReaderSettings({ warmth: Number(e.target.value) })}
            />
          </label>

          {/* Prevent accidental scroll jumps in continuous scroll mode */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              fontSize: 11.5,
              fontWeight: 700,
              padding: '8px 10px',
              borderRadius: 10,
              background: 'rgba(128,128,128,0.1)',
              cursor: 'pointer',
            }}
          >
            <span>Tocar bordes para avanzar en scroll continuo</span>
            <input
              type="checkbox"
              checked={Boolean(readerSettings.tapToScroll)}
              onChange={(e) => updateReaderSettings({ tapToScroll: e.target.checked })}
            />
          </label>
        </aside>
      )}

      {/* TOC Drawer */}
      {drawer === 'toc' && (
        <aside
          className="reader-drawer"
          style={{ background: pal.bar, color: pal.fg, borderLeft: `1px solid ${pal.border}` }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 14 }}>Índice ({toc.length})</strong>
            <button onClick={() => setDrawer('none')} style={{ color: pal.fg }}>
              <X size={16} />
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {toc.map((item, idx) => (
              <button
                key={item.id + idx}
                style={{
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderRadius: 10,
                  background: 'rgba(128,128,128,0.1)',
                  fontSize: 12.5,
                  fontWeight: 700,
                }}
                onClick={() => {
                  setJumpHref(item.href);
                  setDrawer('none');
                }}
              >
                {item.title}
              </button>
            ))}
          </div>
        </aside>
      )}

      {/* Shared Reading Room Live Drawer */}
      {drawer === 'room' && activeRoom && (
        <aside
          className="reader-drawer"
          style={{ background: pal.bar, color: pal.fg, borderLeft: `1px solid ${pal.border}` }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
            <strong style={{ fontSize: 14 }}>Sala {activeRoom.code}</strong>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                className="pill-btn"
                style={{ height: 26, padding: '0 8px', fontSize: 10.5, color: '#c84b4e' }}
                onClick={async () => {
                  await leaveOrDeleteRoom(activeRoom.code, false, {
                    progress: livePos.pct,
                    currentPage: livePos.page,
                    currentCfi: livePos.cfi,
                    scrollRatio: livePos.scrollRatio,
                    currentChapter: livePos.chapter,
                  });
                  setDrawer('none');
                }}
                title="Salir de la sala (tu progreso se conserva)"
              >
                <LogOut size={11} /> Salir
              </button>
              {(activeRoom.hostId === sharedUserId || activeRoom.hostId === deviceId) && (
                <button
                  type="button"
                  className="pill-btn"
                  style={{ height: 26, padding: '0 8px', fontSize: 10.5, color: '#c84b4e' }}
                  onClick={async () => {
                    await leaveOrDeleteRoom(activeRoom.code, true, {
                      progress: livePos.pct,
                      currentPage: livePos.page,
                      currentCfi: livePos.cfi,
                      scrollRatio: livePos.scrollRatio,
                      currentChapter: livePos.chapter,
                    });
                    setDrawer('none');
                  }}
                  title="Cerrar sala para todos (tu progreso se conserva)"
                >
                  <Trash2 size={11} /> Cerrar
                </button>
              )}
              <button onClick={() => setDrawer('none')} style={{ color: pal.fg }}>
                <X size={16} />
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, opacity: 0.8 }}>Progreso mutuo en vivo</div>
            {Object.values(activeRoom.participants || {})
              .sort((a, b) => (b.progress || 0) - (a.progress || 0))
              .map((p) => {
                const isMe = p.id === sharedUserId || p.id === deviceId;
                const displayName = isMe ? profile.name || p.name : p.name;
                const displayEmoji = isMe ? profile.avatarEmoji || p.avatarEmoji : p.avatarEmoji;
                const displayImg = isMe ? profile.avatarImageUrl : p.avatarImageUrl;
                const isPartAdmin = p.id === activeRoom.hostId;
                const iAmAdmin = activeRoom.hostId === sharedUserId || activeRoom.hostId === deviceId;
                return (
                  <div
                    key={p.id}
                    style={{
                      background: 'rgba(128,128,128,0.1)',
                      borderRadius: 10,
                      padding: '8px 10px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 11.5,
                        fontWeight: 800,
                        marginBottom: 4,
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                        {displayImg ? (
                          <img src={displayImg} alt={displayName} className="participant-mini-avatar" />
                        ) : (
                          <span>{displayEmoji || '🦊'}</span>
                        )}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {displayName} {isMe ? '(Tú)' : ''}
                        </span>
                        {isPartAdmin && <span className="admin-role-pill">Admin</span>}
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                        <span>
                          {p.currentPage ? `Pág. ${p.currentPage} · ` : ''}
                          {Math.round(p.progress || 0)}%
                        </span>
                        {iAmAdmin && !isMe && (
                          <button
                            type="button"
                            className="kick-member-btn"
                            onClick={() => kickUserFromRoom(activeRoom.code, p.id, p.name)}
                            title={`Eliminar a ${p.name} de la sala`}
                          >
                            <UserMinus size={11} />
                          </button>
                        )}
                      </span>
                    </div>
                    <div className="goal-track">
                      <div
                        className={`goal-fill ${isMe ? '' : 'secondary'}`}
                        style={{ width: `${Math.min(100, Math.max(3, Math.round(p.progress || 0)))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, opacity: 0.8 }}>
              Comentarios sin spoilers ({activeRoom.comments?.length || 0})
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!roomCommentDraft.trim()) return;
                await sendRoomComment(
                  activeRoom.code,
                  roomCommentDraft.trim(),
                  livePos.pct,
                  livePos.page
                );
                setRoomCommentDraft('');
              }}
              style={{ display: 'flex', gap: 6 }}
            >
              <input
                className="studio-input"
                placeholder={`Nota en ${livePos.pct}%...`}
                value={roomCommentDraft}
                onChange={(e) => setRoomCommentDraft(e.target.value)}
              />
              <button
                type="submit"
                className="circle-arrow-btn"
                style={{
                  width: 36,
                  height: 36,
                  flexShrink: 0,
                  background: 'var(--accent-primary)',
                  color: 'var(--accent-contrast)',
                  borderColor: 'transparent',
                }}
              >
                <Send size={13} />
              </button>
            </form>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[...(activeRoom.comments || [])].reverse().map((c) => {
                const cAuthorId =
                  c.participantId || (c as unknown as { authorId?: string }).authorId || '';
                const isMyComment = Boolean(
                  cAuthorId && (cAuthorId === sharedUserId || cAuthorId === deviceId)
                );
                const liveAuthor = activeRoom.participants?.[cAuthorId];
                const cName = isMyComment
                  ? profile.name || liveAuthor?.name || c.authorName
                  : liveAuthor?.name || c.authorName;
                const cEmoji = isMyComment
                  ? profile.avatarEmoji || liveAuthor?.avatarEmoji || c.avatarEmoji
                  : liveAuthor?.avatarEmoji || c.avatarEmoji;
                const cImg = isMyComment
                  ? profile.avatarImageUrl
                  : liveAuthor
                  ? liveAuthor.avatarImageUrl
                  : c.avatarImageUrl;
                const isSpoiler =
                  !isMyComment &&
                  c.progressAt > livePos.pct + 2 &&
                  !revealedSpoilers[c.id];
                return (
                  <div
                    key={c.id}
                    style={{
                      background: 'rgba(128,128,128,0.1)',
                      borderRadius: 10,
                      padding: '8px 10px',
                      fontSize: 11.5,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontWeight: 800,
                        fontSize: 10.5,
                        marginBottom: 3,
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        {cImg ? (
                          <img src={cImg} alt={cName} className="participant-mini-avatar" />
                        ) : (
                          <span>{cEmoji}</span>
                        )}
                        <span>{cName}</span>
                      </span>
                      <span style={{ opacity: 0.7 }}>{Math.round(c.progressAt)}%</span>
                    </div>
                    {isSpoiler ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, opacity: 0.75, fontSize: 10.5 }}>
                          <Lock size={11} /> Spoiler ({Math.round(c.progressAt)}%)
                        </span>
                        <button
                          type="button"
                          onClick={() => setRevealedSpoilers((prev) => ({ ...prev, [c.id]: true }))}
                          style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--accent-primary)', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                        >
                          <Eye size={11} /> Ver
                        </button>
                      </div>
                    ) : (
                      <div style={{ lineHeight: 1.4 }}>{c.text}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      )}
    </div>
  );
};
