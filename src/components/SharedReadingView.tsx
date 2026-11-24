import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  BookOpen,
  Check,
  Copy,
  Download,
  Edit3,
  Eye,
  HardDrive,
  Highlighter,
  Layers,
  Library,
  Lock,
  LogOut,
  MessageSquare,
  PenTool,
  Plus,
  QrCode,
  Radio,
  RefreshCw,
  Send,
  Share2,
  ShieldCheck,
  Smile,
  Sparkles,
  StickyNote,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import { PUBLIC_APP_URL } from '../config';
import { TOOL_META } from '../data/bookmarksCatalog';
import {
  subscribeToRoomStream,
  subscribeToShelfStream,
} from '../services/sharedReadingService';
import { resolveServerUrl } from '../services/syncService';
import type {
  AnnotationTool,
  SharedRoom,
  SharedShelf,
  ShareMarksSelection,
} from '../types/library';
import { generateQrSvgPath } from '../utils/qrCodeSvg';
import { copyTextReliably, shareLinkOrText } from '../utils/nativeBridge';
import { STATUS_META } from '../utils/readingStats';
import {
  BookCoverVisual,
  getAdaptiveRibbonCss,
  getAdaptiveSpineCss,
} from './BookCoverVisual';

const ALL_MARK_TOOLS: AnnotationTool[] = [
  'highlighter',
  'pencil',
  'pen',
  'postit',
  'sticker',
  'emoji',
];

function formatRelativeTime(ts?: number): string {
  if (!ts) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 45) return 'En vivo ahora';
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `Hace ${min} min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `Hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `Hace ${days} d`;
}

export const SharedReadingView: React.FC = () => {
  const {
    books,
    bookmarks,
    annotations,
    profile,
    updateProfile,
    deviceId,
    sharedUserId,
    syncConfig,
    serverOnline,
    refreshServerHealth,
    liveConnected,
    applyPairingLink,
    syncStatus,
    triggerSync,
    sharedRooms,
    selectedRoomCode,
    setSelectedRoomCode,
    pendingJoinCode,
    setPendingJoinCode,
    refreshSharedRooms,
    createRoomForBook,
    joinRoomByCode,
    sendRoomComment,
    leaveOrDeleteRoom,
    kickUserFromRoom,
    updateLocalRoom,
    removeLocalRoom,
    sharedShelves,
    selectedShelfCode,
    setSelectedShelfCode,
    pendingShelfCode,
    setPendingShelfCode,
    refreshSharedShelves,
    createMutualShelf,
    joinShelfByCode,
    shareBooksToShelf,
    removeBookFromSharedShelf,
    importBookFromShelf,
    leaveOrDeleteShelf,
    kickUserFromShelf,
    updateLocalShelf,
    removeLocalShelf,
    openBook,
    showToast,
  } = useLibrary();

  // Unified Sharing Studio state
  const [shareScope, setShareScope] = useState<'single' | 'multi' | 'library'>('single');
  const [singleShareMode, setSingleShareMode] = useState<'room' | 'shelf'>('room');
  const [selectedBookId, setSelectedBookId] = useState(books[0]?.id || '');
  const [multiSelectedIds, setMultiSelectedIds] = useState<string[]>([]);
  const [shareTitleDraft, setShareTitleDraft] = useState('');
  const [submittingShare, setSubmittingShare] = useState(false);

  // Optional Shared Marks Selector (Resaltador, Lápiz, Bolígrafo, Post-it, Stickers, Emojis, Marcadores)
  const [shareMarksEnabled, setShareMarksEnabled] = useState(false);
  const [shareTools, setShareTools] = useState<AnnotationTool[]>([...ALL_MARK_TOOLS]);
  const [shareIncludeBookmarks, setShareIncludeBookmarks] = useState(true);

  // Unified Join Input (accepts KOMO-XXXX, SHELF-XXXX, or link)
  const [unifiedCodeInput, setUnifiedCodeInput] = useState(
    pendingJoinCode || pendingShelfCode || ''
  );
  const [importMarksOnJoin, setImportMarksOnJoin] = useState(true);
  const [joiningAny, setJoiningAny] = useState(false);

  // Active spaces switcher
  const [activeListTab, setActiveListTab] = useState<'shelves' | 'rooms'>(
    pendingJoinCode ? 'rooms' : sharedShelves.length > 0 ? 'shelves' : 'rooms'
  );

  // QR, Comments & Sharing state
  const [showQr, setShowQr] = useState(false);
  const [showShelfQr, setShowShelfQr] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');
  const [commentInput, setCommentInput] = useState('');
  const [sendingComment, setSendingComment] = useState(false);
  const [revealedSpoilers, setRevealedSpoilers] = useState<Record<string, boolean>>({});
  const [addingBookToShelfId, setAddingBookToShelfId] = useState(books[0]?.id || '');
  const [sharingBookNow, setSharingBookNow] = useState(false);
  const [importingShelfKey, setImportingShelfKey] = useState('');

  useEffect(() => {
    if (pendingJoinCode) {
      setUnifiedCodeInput(pendingJoinCode);
      setActiveListTab('rooms');
    }
  }, [pendingJoinCode]);

  useEffect(() => {
    if (pendingShelfCode) {
      setUnifiedCodeInput(pendingShelfCode);
      setActiveListTab('shelves');
    }
  }, [pendingShelfCode]);

  useEffect(() => {
    if (!books.some((b) => b.id === selectedBookId) && books[0]?.id) {
      setSelectedBookId(books[0].id);
    }
    if (!books.some((b) => b.id === addingBookToShelfId) && books[0]?.id) {
      setAddingBookToShelfId(books[0].id);
    }
  }, [books, selectedBookId, addingBookToShelfId]);

  useEffect(() => {
    if (!syncConfig.serverUrl.trim()) return;
    void refreshSharedRooms();
    void refreshSharedShelves();
  }, [syncConfig.serverUrl, serverOnline, refreshSharedRooms, refreshSharedShelves]);

  useEffect(() => {
    if (!sharedRooms.some((r) => r.code === selectedRoomCode) && sharedRooms[0]?.code) {
      setSelectedRoomCode(sharedRooms[0].code);
    }
  }, [sharedRooms, selectedRoomCode, setSelectedRoomCode]);

  useEffect(() => {
    if (!sharedShelves.some((s) => s.code === selectedShelfCode) && sharedShelves[0]?.code) {
      setSelectedShelfCode(sharedShelves[0].code);
    }
  }, [sharedShelves, selectedShelfCode, setSelectedShelfCode]);

  const activeRoom: SharedRoom | undefined =
    sharedRooms.find((r) => r.code === selectedRoomCode) || sharedRooms[0];

  const activeShelf: SharedShelf | undefined =
    sharedShelves.find((s) => s.code === selectedShelfCode) || sharedShelves[0];

  const isMyId = useCallback(
    (id?: string) => Boolean(id && (id === sharedUserId || id === deviceId)),
    [sharedUserId, deviceId]
  );

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
          removeLocalRoom(updated.code);
          showToast(`Fuiste eliminado de la sala ${updated.code} por el administrador · Tu progreso se conservó`);
          return;
        }
        updateLocalRoom(updated);
      },
      (deletedCode) => {
        removeLocalRoom(deletedCode);
        showToast(`La sala ${deletedCode} fue cerrada por el anfitrión · Tu progreso se conservó`);
      }
    );
  }, [activeRoom?.code, syncConfig, deviceId, sharedUserId, updateLocalRoom, removeLocalRoom, showToast]);

  useEffect(() => {
    if (!activeShelf?.code || !syncConfig.serverUrl.trim()) return;
    return subscribeToShelfStream(
      syncConfig,
      activeShelf.code,
      (updated) => {
        const myIds = [sharedUserId, deviceId].filter(Boolean);
        const kickedMe = myIds.some((id) => updated.kickedIds?.includes(id));
        const stillMember = myIds.some((id) => Boolean(updated.members?.[id]));
        if (kickedMe && !stillMember) {
          removeLocalShelf(updated.code);
          showToast(`Fuiste eliminado de la estantería ${updated.code} por el administrador`);
          return;
        }
        updateLocalShelf(updated);
      },
      (deletedCode) => {
        removeLocalShelf(deletedCode);
        showToast(`La estantería ${deletedCode} fue cerrada por el anfitrión`);
      }
    );
  }, [activeShelf?.code, syncConfig, deviceId, sharedUserId, updateLocalShelf, removeLocalShelf, showToast]);

  const [shareBookSearch, setShareBookSearch] = useState('');
  const [shelfBookSearch, setShelfBookSearch] = useState('');

  // Precompute marks count once O(M) instead of O(N*M) per book on render
  const marksCountByBook = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of annotations) map.set(a.bookId, (map.get(a.bookId) || 0) + 1);
    for (const bm of bookmarks) map.set(bm.bookId, (map.get(bm.bookId) || 0) + 1);
    return map;
  }, [annotations, bookmarks]);

  const filteredShareBooks = useMemo(() => {
    const q = shareBookSearch.trim().toLowerCase();
    const list = q
      ? books.filter(
          (b) =>
            b.title.toLowerCase().includes(q) ||
            (b.author || '').toLowerCase().includes(q) ||
            (b.folderPath || '').toLowerCase().includes(q)
        )
      : books;
    return list.slice(0, 80);
  }, [books, shareBookSearch]);

  const filteredShelfPickerBooks = useMemo(() => {
    const q = shelfBookSearch.trim().toLowerCase();
    const list = q
      ? books.filter(
          (b) =>
            b.title.toLowerCase().includes(q) ||
            (b.author || '').toLowerCase().includes(q)
        )
      : books;
    return list.slice(0, 80);
  }, [books, shelfBookSearch]);

  // Compute which book IDs are currently targeted by the Sharing Studio
  const targetBookIdsForShare = useMemo(() => {
    if (shareScope === 'single') {
      const target = books.find((b) => b.id === selectedBookId) || books[0];
      return target ? [target.id] : [];
    }
    if (shareScope === 'multi') {
      return multiSelectedIds;
    }
    return books.map((b) => b.id);
  }, [shareScope, selectedBookId, multiSelectedIds, books]);

  // Count how many annotations & bookmarks exist in the currently selected books
  const targetMarksStats = useMemo(() => {
    const idSet = new Set(targetBookIdsForShare);
    const byTool: Record<AnnotationTool, number> = {
      highlighter: 0,
      pencil: 0,
      pen: 0,
      postit: 0,
      sticker: 0,
      emoji: 0,
    };
    let totalAnns = 0;
    for (const a of annotations) {
      if (idSet.has(a.bookId)) {
        byTool[a.tool] = (byTool[a.tool] || 0) + 1;
        totalAnns++;
      }
    }
    const totalBms = bookmarks.filter((bm) => idSet.has(bm.bookId)).length;
    return { byTool, totalAnns, totalBms, total: totalAnns + totalBms };
  }, [targetBookIdsForShare, annotations, bookmarks]);

  const currentMarksSelection: ShareMarksSelection = {
    enabled: shareMarksEnabled,
    tools: shareTools,
    includeBookmarks: shareIncludeBookmarks,
  };

  // Build invite links using configured public app URL or the API base URL.
  const shareBaseUrl = useMemo(() => {
    if (typeof window !== 'undefined') {
      const { protocol, hostname, origin } = window.location;
      if (
        (protocol === 'http:' || protocol === 'https:') &&
        !/^(localhost|127\.0\.0\.1)$/i.test(hostname)
      ) {
        return origin.replace(/\/+$/, '');
      }
    }
    if (PUBLIC_APP_URL) return PUBLIC_APP_URL;
    return resolveServerUrl(syncConfig.serverUrl) || 'http://localhost:4123';
  }, [syncConfig.serverUrl]);

  const buildInviteUrl = useCallback(
    (param: 'join' | 'shelf', code: string) => {
      if (!code) return '';
      const url = new URL(shareBaseUrl);
      url.searchParams.set(param, code);
      const api = resolveServerUrl(syncConfig.serverUrl);
      if (api && /^https?:\/\//i.test(api) && api !== shareBaseUrl) {
        url.searchParams.set('server', api);
      }
      return url.toString();
    },
    [shareBaseUrl, syncConfig.serverUrl]
  );

  const inviteUrl = activeRoom ? buildInviteUrl('join', activeRoom.code) : '';
  const qrSvg = useMemo(() => (inviteUrl ? generateQrSvgPath(inviteUrl) : null), [inviteUrl]);

  const shelfInviteUrl = activeShelf ? buildInviteUrl('shelf', activeShelf.code) : '';
  const shelfQrSvg = useMemo(
    () => (showShelfQr && shelfInviteUrl ? generateQrSvgPath(shelfInviteUrl) : null),
    [showShelfQr, shelfInviteUrl]
  );

  const toggleShareTool = (tool: AnnotationTool) => {
    setShareTools((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]
    );
  };

  const toggleMultiBook = (id: string) => {
    setMultiSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSubmitShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingShare || !targetBookIdsForShare.length) return;
    setSubmittingShare(true);
    try {
      if (shareScope === 'single' && singleShareMode === 'room') {
        const book = books.find((b) => b.id === targetBookIdsForShare[0]);
        if (!book) return;
        const created = await createRoomForBook(book, currentMarksSelection);
        if (created) {
          setSelectedRoomCode(created.code);
          setActiveListTab('rooms');
          setShowQr(true);
        }
      } else {
        const defaultTitle =
          shareScope === 'library'
            ? `Biblioteca de ${profile.name} (${targetBookIdsForShare.length})`
            : shareScope === 'single'
            ? books.find((b) => b.id === targetBookIdsForShare[0])?.title || `Libro de ${profile.name}`
            : `Selección de ${profile.name} (${targetBookIdsForShare.length})`;
        const created = await createMutualShelf(
          shareTitleDraft.trim() || defaultTitle,
          targetBookIdsForShare,
          currentMarksSelection
        );
        if (created) {
          setShareTitleDraft('');
          setSelectedShelfCode(created.code);
          setActiveListTab('shelves');
          setShowShelfQr(true);
        }
      }
    } finally {
      setSubmittingShare(false);
    }
  };

  const handleUnifiedJoin = async (e: React.FormEvent, autoOpen = false) => {
    e.preventDefault();
    const raw = unifiedCodeInput.trim();
    if (!raw || joiningAny) return;
    setJoiningAny(true);
    try {
      // Allow pasting full invite URLs as well as bare codes
      if (/^https?:\/\/|^komolib:\/\//i.test(raw)) {
        const ok = await applyPairingLink(raw);
        if (ok) setUnifiedCodeInput('');
        return;
      }
      const code = raw.toUpperCase();
      if (code.startsWith('SHELF-')) {
        const shelf = await joinShelfByCode(code);
        if (shelf) {
          setSelectedShelfCode(shelf.code);
          setActiveListTab('shelves');
          setUnifiedCodeInput('');
          setPendingShelfCode('');
        }
      } else {
        const result = await joinRoomByCode(code, importMarksOnJoin);
        if (result) {
          setSelectedRoomCode(result.room.code);
          setActiveListTab('rooms');
          setUnifiedCodeInput('');
          setPendingJoinCode('');
          if (autoOpen && result.book) {
            await openBook(result.book);
          }
        }
      }
    } finally {
      setJoiningAny(false);
    }
  };

  const handleCopy = async (text: string, key: string) => {
    const ok = await copyTextReliably(text);
    if (ok) {
      setCopiedKey(key);
      showToast('Copiado al portapapeles');
      window.setTimeout(() => setCopiedKey(''), 1800);
    } else {
      const shared = await shareLinkOrText('Komolib', text);
      if (shared === 'shared') {
        showToast('Enlace listo para compartir');
      } else {
        showToast('No se pudo copiar automáticamente');
      }
    }
  };

  const handleOpenRoomBook = async (room: SharedRoom) => {
    const localBook = books.find((b) => b.id === room.bookId);
    const alreadyParticipant = Boolean(
      room.participants?.[sharedUserId] || room.participants?.[deviceId]
    );
    if (localBook && localBook.hasLocalFile && alreadyParticipant) {
      await openBook(localBook);
      return;
    }
    const joined = await joinRoomByCode(room.code, importMarksOnJoin);
    const target = joined?.book || books.find((b) => b.id === room.bookId);
    if (target) await openBook(target);
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRoom || !commentInput.trim() || sendingComment) return;
    setSendingComment(true);
    try {
      const myBook = books.find((b) => b.id === activeRoom.bookId);
      const myPart = activeRoom.participants?.[sharedUserId] || activeRoom.participants?.[deviceId];
      const progressAt = myBook?.progress ?? myPart?.progress ?? 0;
      const pageAt = myBook?.currentPage ?? myPart?.currentPage;
      await sendRoomComment(activeRoom.code, commentInput.trim(), progressAt, pageAt);
      setCommentInput('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo enviar el comentario');
    } finally {
      setSendingComment(false);
    }
  };

  const handleAddBookToActiveShelf = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShelf || !addingBookToShelfId || sharingBookNow) return;
    setSharingBookNow(true);
    try {
      await shareBooksToShelf(activeShelf.code, [addingBookToShelfId], currentMarksSelection);
    } finally {
      setSharingBookNow(false);
    }
  };

  const renderToolIcon = (tool: AnnotationTool, size = 12) => {
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

  const participants = activeRoom
    ? Object.values(activeRoom.participants || {}).sort((a, b) => (b.progress || 0) - (a.progress || 0))
    : [];
  const isParticipantInActive = Boolean(
    activeRoom?.participants?.[sharedUserId] || activeRoom?.participants?.[deviceId]
  );
  const myProgress = activeRoom
    ? books.find((b) => b.id === activeRoom.bookId)?.progress ??
      activeRoom.participants?.[sharedUserId]?.progress ??
      activeRoom.participants?.[deviceId]?.progress ??
      0
    : 0;
  const activeShelfBooks = activeShelf
    ? Object.values(activeShelf.books || {}).sort((a, b) => (b.sharedAt || 0) - (a.sharedAt || 0))
    : [];

  return (
    <section className="tracker-page" aria-label="Compartir libros y sincronización">
      {/* Header */}
      <div className="tracker-header-card">
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="tracker-kicker">Privacidad Local · Compartir por Código · Sync Web ↔ APK</span>
          <h2 className="tracker-heading">Compartir Libros y Dispositivos</h2>
          <p className="tracker-quote">
            Tu librería es <strong>local e independiente</strong>. Comparte 1 libro, varios o tu biblioteca completa eligiendo qué marcas (resaltador, lápiz, bolígrafo, post-it, stickers, emojis o separadores) quieres incluir — sin afectar nunca el progreso del otro lector.
          </p>
        </div>

        <div className="tracker-header-actions">
          <span
            className="pill-btn"
            style={{
              background:
                syncConfig.liveSync && serverOnline
                  ? 'rgba(124, 154, 110, 0.2)'
                  : 'var(--card-bg)',
              color:
                syncConfig.liveSync && serverOnline ? '#5f874f' : 'var(--text-primary)',
              borderColor: syncConfig.liveSync && serverOnline ? 'transparent' : undefined,
            }}
          >
            {liveConnected ? (
              <Radio size={13} />
            ) : syncConfig.liveSync && serverOnline ? (
              <Wifi size={13} />
            ) : (
              <HardDrive size={13} />
            )}
            {liveConnected
              ? 'Bóveda en vivo Web ↔ APK'
              : syncConfig.liveSync && serverOnline
              ? 'Nube personal lista'
              : serverOnline
              ? 'Solo local (servidor listo)'
              : 'Solo local'}
          </span>

          {syncConfig.serverUrl.trim() && (
            <button
              type="button"
              className="pill-btn"
              style={{ background: 'var(--card-bg)' }}
              onClick={() => triggerSync(false)}
              disabled={syncStatus === 'syncing'}
            >
              <RefreshCw size={13} className={syncStatus === 'syncing' ? 'spin' : ''} />
              {syncStatus === 'syncing' ? 'Sincronizando...' : 'Sync personal'}
            </button>
          )}
        </div>
      </div>

      {/* Pending Invite Banner (Room or Shelf) */}
      {(pendingJoinCode || pendingShelfCode) && (
        <form
          className="tracker-card"
          style={{
            borderColor: 'var(--accent-primary)',
            background: 'color-mix(in srgb, var(--accent-primary) 7%, var(--card-bg))',
          }}
          onSubmit={(e) => handleUnifiedJoin(e, true)}
        >
          <div className="tracker-card-head">
            <h3>
              <UserPlus size={16} style={{ color: 'var(--accent-primary)' }} /> Invitación recibida:{' '}
              {pendingJoinCode || pendingShelfCode}
            </h3>
            <button
              type="button"
              className="pill-btn"
              style={{ height: 26, fontSize: 11 }}
              onClick={() => {
                setPendingJoinCode('');
                setPendingShelfCode('');
              }}
            >
              Descartar
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="studio-input"
              style={{ flex: 1, minWidth: 160 }}
              placeholder="Tu nombre de lector"
              value={profile.name}
              onChange={(e) => updateProfile({ name: e.target.value })}
            />
            <button
              type="submit"
              className="coral-cta-btn"
              style={{ height: 36, padding: '0 18px' }}
              disabled={joiningAny || !serverOnline}
            >
              <BookOpen size={14} />{' '}
              {joiningAny ? 'Conectando...' : `Unirse a ${pendingJoinCode || pendingShelfCode}`}
            </button>
          </div>
        </form>
      )}

      {!serverOnline && (
        <div className="tracker-card">
          <div className="tracker-card-head">
            <h3>
              <WifiOff size={15} /> Servidor de compartir sin conexión
            </h3>
            <button
              type="button"
              className="pill-btn"
              style={{ height: 28, fontSize: 11, padding: '0 10px' }}
              onClick={() => void refreshServerHealth()}
            >
              <RefreshCw size={12} /> Reintentar
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            No se pudo conectar con{' '}
            <strong style={{ wordBreak: 'break-all' }}>
              {syncConfig.serverUrl || 'el servidor configurado'}
            </strong>
            . Verifica tu conexión a internet o que tu servidor API en la nube esté activo.
          </div>
        </div>
      )}

      {/* UNIFIED ORGANIZED SHARING STUDIO (Share 1 book / Several books / Full Library + Choose Marks!) */}
      <div className="share-studio-grid">
        <form className="tracker-card" onSubmit={handleSubmitShare}>
          <div className="tracker-card-head">
            <h3>
              <Share2 size={15} /> ¿Qué deseas compartir?
            </h3>
          </div>

          {/* Step 1: Scope Picker (1 Book | Multiple Books | Full Library) */}
          <div className="share-scope-bar">
            <button
              type="button"
              className={`share-scope-btn ${shareScope === 'single' ? 'active' : ''}`}
              onClick={() => setShareScope('single')}
            >
              <BookOpen size={14} />
              <span>Un libro</span>
            </button>
            <button
              type="button"
              className={`share-scope-btn ${shareScope === 'multi' ? 'active' : ''}`}
              onClick={() => setShareScope('multi')}
            >
              <Layers size={14} />
              <span>Varios libros</span>
            </button>
            <button
              type="button"
              className={`share-scope-btn ${shareScope === 'library' ? 'active' : ''}`}
              onClick={() => setShareScope('library')}
            >
              <Library size={14} />
              <span>Biblioteca ({books.length})</span>
            </button>
          </div>

          {/* Step 2: Dynamic Content based on Selected Scope */}
          {shareScope === 'single' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {books.length > 40 && (
                <input
                  className="studio-input"
                  placeholder={`Buscar entre ${books.length} libros...`}
                  value={shareBookSearch}
                  onChange={(e) => setShareBookSearch(e.target.value)}
                />
              )}
              <select
                className="studio-input"
                value={selectedBookId}
                onChange={(e) => setSelectedBookId(e.target.value)}
              >
                {filteredShareBooks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title} ({b.format.toUpperCase()})
                  </option>
                ))}
              </select>

              <div className="share-mode-pair">
                <button
                  type="button"
                  className={`share-mode-option ${singleShareMode === 'room' ? 'active' : ''}`}
                  onClick={() => setSingleShareMode('room')}
                >
                  <strong>Sala Conjunta (KOMO)</strong>
                  <span>Ver progreso mutuo + notas sin spoilers</span>
                </button>
                <button
                  type="button"
                  className={`share-mode-option ${singleShareMode === 'shelf' ? 'active' : ''}`}
                  onClick={() => setSingleShareMode('shelf')}
                >
                  <strong>Copia Independiente (SHELF)</strong>
                  <span>Cada uno lee sin afectar al otro</span>
                </button>
              </div>
            </div>
          ) : shareScope === 'multi' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <input
                  className="studio-input"
                  style={{ flex: 1 }}
                  placeholder={`Nombre del paquete (ej. Favoritos de ${profile.name})`}
                  value={shareTitleDraft}
                  onChange={(e) => setShareTitleDraft(e.target.value)}
                />
                <button
                  type="button"
                  className="pill-btn"
                  style={{ height: 34, fontSize: 11, flexShrink: 0 }}
                  onClick={() =>
                    setMultiSelectedIds(
                      multiSelectedIds.length === books.length ? [] : books.map((b) => b.id)
                    )
                  }
                >
                  {multiSelectedIds.length === books.length ? 'Limpiar' : 'Todos'}
                </button>
              </div>

              {books.length > 40 && (
                <input
                  className="studio-input"
                  placeholder={`Filtrar libros (${books.length} en biblioteca)...`}
                  value={shareBookSearch}
                  onChange={(e) => setShareBookSearch(e.target.value)}
                />
              )}

              <div className="share-book-checklist">
                {filteredShareBooks.map((b) => {
                  const checked = multiSelectedIds.includes(b.id);
                  const bMarks = marksCountByBook.get(b.id) || 0;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      className={`share-book-chip ${checked ? 'selected' : ''}`}
                      onClick={() => toggleMultiBook(b.id)}
                    >
                      <span className="share-check-dot">{checked ? '✓' : '+'}</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.title}
                      </span>
                      {bMarks > 0 && (
                        <span style={{ fontSize: 9.5, opacity: 0.72, fontWeight: 800 }}>
                          ✨{bMarks}
                        </span>
                      )}
                    </button>
                  );
                })}
                {books.length > filteredShareBooks.length && !shareBookSearch.trim() && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 6px' }}>
                    Mostrando los primeros {filteredShareBooks.length} de {books.length}. Usa el buscador arriba para encontrar cualquier título.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div
              style={{
                background: 'var(--banner-bg)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 13,
                padding: '11px 13px',
                display: 'flex',
                flexDirection: 'column',
                gap: 7,
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 800 }}>
                Compartir tu biblioteca completa ({books.length} libros)
              </div>
              <input
                className="studio-input"
                placeholder={`Nombre (ej. Biblioteca de ${profile.name})`}
                value={shareTitleDraft}
                onChange={(e) => setShareTitleDraft(e.target.value)}
              />
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Se crea un código <strong>SHELF-XXXX</strong> para que el otro usuario vea todos tus libros (y te comparta los suyos) con progreso 100% independiente.
              </div>
            </div>
          )}

          {/* Step 3: Organized Optional Marks & Stationery Inclusion Panel */}
          <div className="share-marks-box">
            <div className="toggle-row">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 12, fontWeight: 800 }}>
                  Incluir mis marcas de lectura ({targetMarksStats.total} disponibles)
                </span>
                <span style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 600 }}>
                  Elige qué herramientas (resaltador, lápiz, bolígrafo, post-it, stickers, emojis, separadores) compartir.
                </span>
              </div>
              <button
                type="button"
                className={`switch ${shareMarksEnabled ? 'on' : ''}`}
                onClick={() => setShareMarksEnabled(!shareMarksEnabled)}
                aria-label="Incluir marcas de lectura al compartir"
              />
            </div>

            {shareMarksEnabled && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {ALL_MARK_TOOLS.map((tool) => {
                    const active = shareTools.includes(tool);
                    const count = targetMarksStats.byTool[tool] || 0;
                    return (
                      <button
                        key={tool}
                        type="button"
                        className={`pill-btn ${active ? 'active' : ''}`}
                        style={{ height: 27, fontSize: 10.5, padding: '0 9px' }}
                        onClick={() => toggleShareTool(tool)}
                      >
                        {renderToolIcon(tool, 11)}
                        {TOOL_META[tool].short} ({count})
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className={`pill-btn ${shareIncludeBookmarks ? 'active' : ''}`}
                    style={{ height: 27, fontSize: 10.5, padding: '0 9px' }}
                    onClick={() => setShareIncludeBookmarks(!shareIncludeBookmarks)}
                  >
                    <Bookmark size={11} /> Separadores ({targetMarksStats.totalBms})
                  </button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-muted)' }}>
                  <span>Tus marcas originales nunca se modifican.</span>
                  <button
                    type="button"
                    style={{ fontWeight: 800, color: 'var(--accent-primary)' }}
                    onClick={() => {
                      const allSelected =
                        shareTools.length === ALL_MARK_TOOLS.length && shareIncludeBookmarks;
                      setShareTools(allSelected ? [] : [...ALL_MARK_TOOLS]);
                      setShareIncludeBookmarks(!allSelected);
                    }}
                  >
                    {shareTools.length === ALL_MARK_TOOLS.length && shareIncludeBookmarks
                      ? 'Desmarcar todo'
                      : 'Marcar todo'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            className="coral-cta-btn"
            style={{ height: 38, justifyContent: 'center' }}
            disabled={submittingShare || !targetBookIdsForShare.length || !serverOnline}
          >
            <Plus size={15} />{' '}
            {submittingShare
              ? 'Generando código y QR...'
              : shareScope === 'single' && singleShareMode === 'room'
              ? 'Crear sala compartida (KOMO)'
              : `Generar código mutuo (${targetBookIdsForShare.length} libro${targetBookIdsForShare.length === 1 ? '' : 's'})`}
          </button>
        </form>

        {/* Right Card: Unified Join by Code (KOMO-XXXX or SHELF-XXXX or Link) */}
        <form className="tracker-card" onSubmit={(e) => handleUnifiedJoin(e, false)}>
          <div className="tracker-card-head">
            <h3>
              <UserPlus size={15} /> Recibir libros con código
            </h3>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.48 }}>
            Ingresa el código que te enviaron — funciona tanto para <strong>estanterías / bibliotecas (`SHELF-XXXX`)</strong> como para <strong>salas de lectura (`KOMO-XXXX`)</strong> o enlaces directos.
          </div>

          <input
            className="studio-input"
            style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800, height: 40 }}
            placeholder="SHELF-XXXX o KOMO-XXXX"
            value={unifiedCodeInput}
            onChange={(e) => setUnifiedCodeInput(e.target.value.toUpperCase())}
          />

          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={importMarksOnJoin}
              onChange={(e) => setImportMarksOnJoin(e.target.checked)}
            />
            Importar resaltados, post-its, stickers y separadores si el libro los incluye
          </label>

          <button
            type="submit"
            className="pill-btn"
            style={{
              height: 38,
              justifyContent: 'center',
              background: 'var(--accent-secondary)',
              color: 'var(--accent-secondary-contrast)',
              borderColor: 'transparent',
            }}
            disabled={joiningAny || !unifiedCodeInput.trim() || !serverOnline}
          >
            {joiningAny ? 'Conectando...' : 'Unirse y ver libros'}
          </button>

          <div
            style={{
              marginTop: 'auto',
              padding: '10px 12px',
              borderRadius: 12,
              background: 'var(--banner-bg)',
              border: '1px solid var(--border-subtle)',
              fontSize: 11,
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              lineHeight: 1.45,
            }}
          >
            <ShieldCheck size={16} style={{ color: '#5f874f', flexShrink: 0, marginTop: 1 }} />
            <span>
              <strong>Progreso 100% independiente:</strong> al descargar un libro compartido, se guarda en tu librería local con tu propio avance, marcadores y anotaciones sin alterar los de la otra persona.
            </span>
          </div>
        </form>
      </div>

      {/* ACTIVE SPACES SWITCHER */}
      <div className="workspace-tab-strip share-space-tabs">
        <button
          type="button"
          className={`workspace-tab-pill ${activeListTab === 'shelves' ? 'active' : ''}`}
          onClick={() => setActiveListTab('shelves')}
        >
          <Library size={14} /> <span>Estanterías ({sharedShelves.length})</span>
        </button>
        <button
          type="button"
          className={`workspace-tab-pill ${activeListTab === 'rooms' ? 'active' : ''}`}
          onClick={() => setActiveListTab('rooms')}
        >
          <Users size={14} /> <span>Salas en Vivo ({sharedRooms.length})</span>
        </button>
      </div>

      {activeListTab === 'shelves' ? (
        sharedShelves.length === 0 ? (
          <div className="tracker-card" style={{ textAlign: 'center', padding: '26px 20px' }}>
            <Library size={28} style={{ color: 'var(--accent-secondary)', margin: '0 auto 6px' }} />
            <div style={{ fontSize: 15, fontWeight: 800 }}>Sin estanterías compartidas todavía</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 480, margin: '0 auto' }}>
              Elige arriba <strong>Un libro</strong>, <strong>Varios libros</strong> o <strong>Biblioteca completa</strong> para generar un código <strong>SHELF-XXXX</strong> con tus marcas opcionales.
            </div>
          </div>
        ) : (
          <div className="shared-rooms-layout">
            <div className="tracker-card">
              <div className="tracker-card-head">
                <h3>
                  <Library size={15} /> Estanterías ({sharedShelves.length})
                </h3>
                <button
                  type="button"
                  className="circle-arrow-btn"
                  style={{ width: 28, height: 28 }}
                  onClick={refreshSharedShelves}
                  title="Actualizar"
                >
                  <RefreshCw size={12} />
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sharedShelves.map((shelf) => {
                  const isActive = activeShelf?.code === shelf.code;
                  const count = Object.keys(shelf.books || {}).length;
                  return (
                    <button
                      key={shelf.code}
                      type="button"
                      className={`shared-room-item ${isActive ? 'active' : ''}`}
                      onClick={() => setSelectedShelfCode(shelf.code)}
                    >
                      <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                        <div className="log-book-title" style={{ maxWidth: '100%' }}>
                          {shelf.title}
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 700 }}>
                          {shelf.code} · {count} libro(s) · {Object.keys(shelf.members || {}).length} usuario(s)
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {activeShelf && (
              <div className="tracker-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: '1 1 200px' }}>
                    <span className="quickstart-badge" style={{ marginBottom: 4 }}>
                      Código {activeShelf.code} · Progreso independiente
                    </span>
                    <div style={{ fontSize: 16.5, fontWeight: 800, overflowWrap: 'anywhere' }}>{activeShelf.title}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                      Admin: <strong>{activeShelf.hostName}</strong> · {Object.keys(activeShelf.members || {}).length} miembro(s)
                    </div>
                  </div>

                  <div className="shared-room-actions">
                    <button
                      type="button"
                      className="pill-btn"
                      style={{ background: 'var(--banner-bg)' }}
                      onClick={() => handleCopy(activeShelf.code, 'shelf-code')}
                    >
                      {copiedKey === 'shelf-code' ? <Check size={12} /> : <Copy size={12} />}
                      {activeShelf.code}
                    </button>
                    <button
                      type="button"
                      className="pill-btn"
                      style={{ background: 'var(--banner-bg)' }}
                      onClick={() => handleCopy(shelfInviteUrl, 'shelf-link')}
                    >
                      {copiedKey === 'shelf-link' ? <Check size={12} /> : <Share2 size={12} />}
                      Enlace
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${showShelfQr ? 'active' : ''}`}
                      onClick={() => setShowShelfQr(!showShelfQr)}
                    >
                      <QrCode size={12} /> QR
                    </button>
                    <button
                      type="button"
                      className="pill-btn"
                      style={{ background: 'var(--banner-bg)', color: '#c84b4e' }}
                      onClick={() => leaveOrDeleteShelf(activeShelf.code, false)}
                      title="Salir de esta estantería compartida"
                    >
                      <LogOut size={12} /> Salir
                    </button>
                    {isMyId(activeShelf.hostId) && (
                      <button
                        type="button"
                        className="pill-btn"
                        style={{
                          background: 'rgba(200, 75, 78, 0.14)',
                          borderColor: 'rgba(200, 75, 78, 0.35)',
                          color: '#c84b4e',
                        }}
                        onClick={() => leaveOrDeleteShelf(activeShelf.code, true)}
                        title="Cerrar estantería para todos (solo admin)"
                      >
                        <Trash2 size={12} /> Cerrar
                      </button>
                    )}
                  </div>
                </div>

                {/* Members List (Admin can kick any other user!) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text-muted)' }}>
                    Miembros en esta estantería ({Object.keys(activeShelf.members || {}).length})
                  </div>
                  <div className="shared-members-list">
                    {Object.values(activeShelf.members || {}).map((m) => {
                      const isMe = isMyId(m.id);
                      const memberPhoto = m.avatarImageUrl || (isMe ? profile.avatarImageUrl : undefined);
                      const isMemberAdmin = m.id === activeShelf.hostId;
                      const iAmAdmin = isMyId(activeShelf.hostId);
                      return (
                        <div key={m.id} className="shared-member-chip">
                          <span
                            className="participant-avatar"
                            style={{ width: 26, height: 26, fontSize: 14, background: m.avatarBg || '#f6d8ae' }}
                          >
                            {memberPhoto ? (
                              <img src={memberPhoto} alt={m.name} />
                            ) : (
                              m.avatarEmoji || '🦊'
                            )}
                          </span>
                          <span style={{ fontSize: 11.5, fontWeight: 800, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {m.name} {isMe ? '(Tú)' : ''}
                          </span>
                          {isMemberAdmin && (
                            <span className="admin-role-pill">Admin</span>
                          )}
                          {iAmAdmin && !isMe && (
                            <button
                              type="button"
                              className="kick-member-btn"
                              onClick={() => kickUserFromShelf(activeShelf.code, m.id, m.name)}
                              title={`Eliminar a ${m.name} de la estantería`}
                            >
                              <UserMinus size={12} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {showShelfQr && shelfQrSvg && (
                  <div className="device-qr-card">
                    <div className="device-qr-box">
                      <svg viewBox={`-2 -2 ${shelfQrSvg.size + 4} ${shelfQrSvg.size + 4}`} width="110" height="110" shapeRendering="crispEdges">
                        <rect x="-2" y="-2" width={shelfQrSvg.size + 4} height={shelfQrSvg.size + 4} fill="#ffffff" />
                        <path d={shelfQrSvg.path} fill="#161616" />
                      </svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                        <div style={{ fontSize: 12.5, fontWeight: 800 }}>
                          QR para compartir — Estantería mutua
                        </div>
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 700, padding: '6px 9px', borderRadius: 10, background: 'var(--card-bg)', border: '1px solid var(--border-subtle)', wordBreak: 'break-all' }}>
                        {shelfInviteUrl}
                      </div>
                    </div>
                  </div>
                )}

                <form onSubmit={handleAddBookToActiveShelf} style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  {books.length > 40 && (
                    <input
                      className="studio-input"
                      style={{ flex: '1 1 140px', minWidth: 0 }}
                      placeholder="Buscar libro para añadir..."
                      value={shelfBookSearch}
                      onChange={(e) => setShelfBookSearch(e.target.value)}
                    />
                  )}
                  <select
                    className="studio-input"
                    style={{ flex: '1 1 160px', minWidth: 0 }}
                    value={addingBookToShelfId}
                    onChange={(e) => setAddingBookToShelfId(e.target.value)}
                  >
                    {filteredShelfPickerBooks.map((b) => (
                      <option key={b.id} value={b.id}>
                        Añadir libro: {b.title} ({b.format.toUpperCase()})
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="pill-btn"
                    style={{ height: 36, background: 'var(--accent-primary)', color: 'var(--accent-contrast)', borderColor: 'transparent' }}
                    disabled={sharingBookNow || !books.length}
                  >
                    <Plus size={13} /> {sharingBookNow ? 'Subiendo...' : 'Añadir'}
                  </button>
                </form>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {activeShelfBooks.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Añade un libro arriba para compartirlo mutuamente.
                    </div>
                  ) : (
                    activeShelfBooks.map((entry) => {
                      const isMine = isMyId(entry.ownerId);
                      const localCopy = books.find((b) => b.id === `shared_${entry.bookId}`);
                      const sharedMarksTotal =
                        (entry.sharedAnnotations?.length || 0) +
                        (entry.sharedBookmarks?.length || 0);
                      return (
                        <div key={entry.bookId} className="inbox-row share-shelf-book-row">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                            <div className="log-mini-thumb" style={{ width: 34, height: 48 }}>
                              <BookCoverVisual
                                book={{
                                  id: entry.bookId,
                                  title: entry.title,
                                  author: entry.author,
                                  format: entry.format,
                                  kind: entry.kind,
                                  coverDataUrl: entry.coverDataUrl,
                                  hasOriginalCover: entry.hasOriginalCover,
                                }}
                                compact
                              />
                            </div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div className="log-book-title" style={{ maxWidth: '100%' }}>
                                {entry.title}
                              </div>
                              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 700 }}>
                                {entry.author} · {entry.format.toUpperCase()} · De {isMine ? 'Ti' : entry.ownerName}
                                {sharedMarksTotal > 0 ? ` · ✨ ${sharedMarksTotal} marcas incluidas` : ''}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                            {!isMine && (
                              <button
                                type="button"
                                className="coral-cta-btn"
                                style={{ height: 31, padding: '0 12px', fontSize: 11 }}
                                disabled={importingShelfKey === entry.bookId}
                                onClick={async () => {
                                  if (localCopy) {
                                    await openBook(localCopy);
                                    return;
                                  }
                                  setImportingShelfKey(entry.bookId);
                                  try {
                                    const added = await importBookFromShelf(
                                      activeShelf.code,
                                      entry,
                                      importMarksOnJoin
                                    );
                                    if (added) await openBook(added);
                                  } finally {
                                    setImportingShelfKey('');
                                  }
                                }}
                              >
                                {localCopy ? (
                                  <>
                                    <BookOpen size={12} /> Leer (mi progreso)
                                  </>
                                ) : (
                                  <>
                                    <Download size={12} />{' '}
                                    {importingShelfKey === entry.bookId ? 'Trayendo...' : 'Guardar y leer'}
                                  </>
                                )}
                              </button>
                            )}
                            {(isMine || isMyId(activeShelf.hostId)) && (
                              <button
                                type="button"
                                className="circle-arrow-btn"
                                style={{ width: 30, height: 30, color: '#c84b4e' }}
                                onClick={() => removeBookFromSharedShelf(activeShelf.code, entry.bookId)}
                                title="Retirar libro de la estantería"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )
      ) : sharedRooms.length === 0 ? (
        <div className="tracker-card" style={{ textAlign: 'center', padding: '26px 20px' }}>
          <Users size={28} style={{ color: 'var(--accent-primary)', margin: '0 auto 6px' }} />
          <div style={{ fontSize: 15, fontWeight: 800 }}>No tienes salas de lectura conjunta aún</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 460, margin: '0 auto' }}>
            Selecciona <strong>Un libro → Sala Conjunta (KOMO)</strong> arriba para leer en compañía viendo su progreso mutuo en vivo y notas sin spoilers.
          </div>
        </div>
      ) : (
        <div className="shared-rooms-layout">
          <div className="tracker-card">
            <div className="tracker-card-head">
              <h3>
                <Users size={15} /> Salas activas ({sharedRooms.length})
              </h3>
              <button
                type="button"
                className="circle-arrow-btn"
                style={{ width: 28, height: 28 }}
                onClick={refreshSharedRooms}
                title="Actualizar salas"
              >
                <RefreshCw size={12} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sharedRooms.map((room) => {
                const count = Object.keys(room.participants || {}).length;
                const isActive = activeRoom?.code === room.code;
                return (
                  <button
                    key={room.code}
                    type="button"
                    className={`shared-room-item ${isActive ? 'active' : ''}`}
                    onClick={() => setSelectedRoomCode(room.code)}
                  >
                    <div className="log-mini-thumb" style={{ width: 36, height: 50 }}>
                      <BookCoverVisual
                        book={{
                          id: room.bookId,
                          title: room.bookMeta.title,
                          author: room.bookMeta.author,
                          format: room.bookMeta.format,
                          kind: room.bookMeta.kind,
                          coverDataUrl: room.bookMeta.coverDataUrl,
                          hasOriginalCover: room.bookMeta.hasOriginalCover,
                        }}
                        compact
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <div className="log-book-title" style={{ maxWidth: '100%' }}>
                        {room.bookMeta.title}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 700 }}>
                        {room.code} · {count} lector(es)
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {activeRoom && (
            <div className="tracker-card">
              <div className="shared-room-hero">
                <div className="book-hardcover-wrap shared-hero-cover">
                  <div
                    className="book-hardcover"
                    style={{
                      backgroundColor:
                        activeRoom.bookMeta.hasOriginalCover !== false
                          ? activeRoom.bookMeta.spineColor
                          : getAdaptiveSpineCss(`${activeRoom.bookId}:${activeRoom.bookMeta.title}`),
                    }}
                  >
                    <div className="book-cover-img-box">
                      <BookCoverVisual
                        book={{
                          id: activeRoom.bookId,
                          title: activeRoom.bookMeta.title,
                          author: activeRoom.bookMeta.author,
                          format: activeRoom.bookMeta.format,
                          kind: activeRoom.bookMeta.kind,
                          coverDataUrl: activeRoom.bookMeta.coverDataUrl,
                          hasOriginalCover: activeRoom.bookMeta.hasOriginalCover,
                        }}
                      />
                    </div>
                    <div className="book-pages-block" />
                    <div
                      className="book-ribbon"
                      style={{
                        backgroundColor:
                          activeRoom.bookMeta.hasOriginalCover !== false
                            ? activeRoom.bookMeta.ribbonColor || '#f2ba59'
                            : getAdaptiveRibbonCss(`${activeRoom.bookId}:${activeRoom.bookMeta.title}`),
                      }}
                    />
                  </div>
                </div>

                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="quickstart-badge" style={{ marginBottom: 0 }}>
                      Sala {activeRoom.code}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>
                      Anfitrión: {activeRoom.hostName}
                    </span>
                    {(activeRoom.bookMeta.sharedAnnotations?.length || 0) +
                      (activeRoom.bookMeta.sharedBookmarks?.length || 0) >
                      0 && (
                      <span className="log-genre-pill" style={{ fontSize: 10 }}>
                        ✨ {(activeRoom.bookMeta.sharedAnnotations?.length || 0) + (activeRoom.bookMeta.sharedBookmarks?.length || 0)} marcas compartidas
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.2 }}>
                    {activeRoom.bookMeta.title}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--author-color)' }}>
                    {activeRoom.bookMeta.author}
                  </div>

                  <div className="shared-room-actions" style={{ marginTop: 4 }}>
                    <button
                      type="button"
                      className="coral-cta-btn"
                      style={{ height: 33, padding: '0 14px', fontSize: 12 }}
                      onClick={() => handleOpenRoomBook(activeRoom)}
                    >
                      <BookOpen size={13} />{' '}
                      {isParticipantInActive ? 'Leer ahora' : 'Unirse y leer'}
                    </button>
                    <button
                      type="button"
                      className="pill-btn"
                      style={{ background: 'var(--card-bg)' }}
                      onClick={() => handleCopy(activeRoom.code, 'code')}
                    >
                      {copiedKey === 'code' ? <Check size={12} /> : <Copy size={12} />}
                      {activeRoom.code}
                    </button>
                    <button
                      type="button"
                      className="pill-btn"
                      style={{ background: 'var(--card-bg)' }}
                      onClick={() => handleCopy(inviteUrl, 'link')}
                    >
                      {copiedKey === 'link' ? <Check size={12} /> : <Share2 size={12} />}
                      Enlace
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${showQr ? 'active' : ''}`}
                      onClick={() => setShowQr(!showQr)}
                    >
                      <QrCode size={12} /> QR
                    </button>
                    <button
                      type="button"
                      className="pill-btn"
                      style={{ background: 'var(--card-bg)', color: '#c84b4e' }}
                      onClick={() => leaveOrDeleteRoom(activeRoom.code, false)}
                      title="Salir de esta sala compartida"
                    >
                      <LogOut size={12} /> Salir
                    </button>
                    {isMyId(activeRoom.hostId) && (
                      <button
                        type="button"
                        className="pill-btn"
                        style={{
                          background: 'rgba(200, 75, 78, 0.14)',
                          borderColor: 'rgba(200, 75, 78, 0.35)',
                          color: '#c84b4e',
                        }}
                        onClick={() => leaveOrDeleteRoom(activeRoom.code, true)}
                        title="Cerrar sala para todos (solo admin)"
                      >
                        <Trash2 size={12} /> Cerrar sala
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {showQr && qrSvg && (
                <div className="device-qr-card">
                  <div className="device-qr-box">
                    <svg viewBox={`-2 -2 ${qrSvg.size + 4} ${qrSvg.size + 4}`} width="110" height="110" shapeRendering="crispEdges">
                      <rect x="-2" y="-2" width={qrSvg.size + 4} height={qrSvg.size + 4} fill="#ffffff" />
                      <path d={qrSvg.path} fill="#161616" />
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800 }}>
                        QR para compartir la sala
                      </div>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, padding: '6px 9px', borderRadius: 10, background: 'var(--card-bg)', border: '1px solid var(--border-subtle)', wordBreak: 'break-all' }}>
                      {inviteUrl}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <div className="tracker-card-head" style={{ marginBottom: 8 }}>
                  <h3>Progreso mutuo en vivo ({participants.length})</h3>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>
                    Actualización automática
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {participants.map((p) => {
                    const isMe = isMyId(p.id);
                    const participantPhoto = p.avatarImageUrl || (isMe ? profile.avatarImageUrl : undefined);
                    const isPartAdmin = p.id === activeRoom.hostId;
                    const iAmAdmin = isMyId(activeRoom.hostId);
                    const st = p.readingStatus || (p.progress >= 98 ? 'completed' : 'reading');
                    return (
                      <div key={p.id} className="participant-progress-row">
                        <div className="participant-avatar" style={{ background: p.avatarBg || '#f6d8ae' }}>
                          {participantPhoto ? (
                            <img src={participantPhoto} alt={p.name} />
                          ) : (
                            p.avatarEmoji || '🦊'
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                              <span>{p.name} {isMe ? '(Tú)' : ''}</span>
                              {isPartAdmin && <span className="admin-role-pill">Admin</span>}
                              {p.lastSeenAt ? (
                                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>
                                  · {formatRelativeTime(p.lastSeenAt)}
                                </span>
                              ) : null}
                            </span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 11, fontWeight: 800, color: STATUS_META[st]?.color || 'var(--accent-primary)' }}>
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
                                  <UserMinus size={12} />
                                </button>
                              )}
                            </span>
                          </div>
                          <div className="goal-track">
                            <div
                              className={`goal-fill ${isMe ? '' : 'secondary'}`}
                              style={{ width: `${Math.min(100, Math.max(2, Math.round(p.progress || 0)))}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="tracker-card-head">
                  <h3>
                    <MessageSquare size={14} /> Notas compartidas sin spoilers ({activeRoom.comments?.length || 0})
                  </h3>
                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 700 }}>
                    Tu avance: {Math.round(myProgress)}%
                  </span>
                </div>

                <form onSubmit={handlePostComment} style={{ display: 'flex', gap: 7 }}>
                  <input
                    className="studio-input"
                    placeholder={`Comentar en tu progreso actual (${Math.round(myProgress)}%)...`}
                    value={commentInput}
                    onChange={(e) => setCommentInput(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="pill-btn"
                    style={{ background: 'var(--accent-primary)', color: 'var(--accent-contrast)', borderColor: 'transparent', height: 36, flexShrink: 0 }}
                    disabled={sendingComment || !commentInput.trim()}
                  >
                    <Send size={13} /> Enviar
                  </button>
                </form>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 240, overflowY: 'auto' }}>
                  {(activeRoom.comments || []).length === 0 ? (
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                      Deja una reacción sobre el capítulo actual; se bloqueará como spoiler para quienes vayan más atrás.
                    </div>
                  ) : (
                    [...(activeRoom.comments || [])].reverse().map((c) => {
                      const isSpoiler =
                        c.participantId !== deviceId &&
                        c.progressAt > myProgress + 2 &&
                        !revealedSpoilers[c.id];
                      const commentPhoto =
                        c.avatarImageUrl ||
                        activeRoom.participants?.[c.participantId]?.avatarImageUrl ||
                        (c.participantId === deviceId ? profile.avatarImageUrl : undefined);
                      return (
                        <div key={c.id} className="shared-comment-card">
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontSize: 11.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              {commentPhoto ? (
                                <img src={commentPhoto} alt={c.authorName} className="participant-mini-avatar" />
                              ) : (
                                <span>{c.avatarEmoji}</span>
                              )}
                              <span>{c.authorName}</span>
                            </span>
                            <span className="log-genre-pill" style={{ fontSize: 10 }}>
                              {c.pageAt ? `Pág. ${c.pageAt} · ` : ''}
                              {Math.round(c.progressAt)}%
                            </span>
                          </div>
                          {isSpoiler ? (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 11.5, color: 'var(--text-muted)' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                <Lock size={12} /> Spoiler bloqueado hasta llegar al {Math.round(c.progressAt)}%
                              </span>
                              <button
                                type="button"
                                className="pill-btn"
                                style={{ height: 24, fontSize: 10.5, padding: '0 8px' }}
                                onClick={() => setRevealedSpoilers((prev) => ({ ...prev, [c.id]: true }))}
                              >
                                <Eye size={11} /> Ver
                              </button>
                            </div>
                          ) : (
                            <div style={{ fontSize: 12, lineHeight: 1.42 }}>{c.text}</div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
