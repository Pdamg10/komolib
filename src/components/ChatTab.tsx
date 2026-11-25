import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  History,
  MessageSquarePlus,
  Paperclip,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import { parseCleanAiBlocks, sanitizeAiReplyText } from '../utils/aiAssistantUtils';
import { BookCoverVisual } from './BookCoverVisual';

const FormattedChatMessage: React.FC<{ text: string; isAssistant: boolean }> = React.memo(
  ({ text, isAssistant }) => {
    const blocks = useMemo(() => (isAssistant ? parseCleanAiBlocks(text) : []), [text, isAssistant]);
    if (!isAssistant) {
      return <div className="chat-msg-p">{text}</div>;
    }
    if (blocks.length === 0) return null;
    return (
      <div className="chat-msg-blocks">
        {blocks.map((block, idx) => {
          if (block.type === 'bullet') {
            return (
              <div key={idx} className="chat-msg-list-item">
                <span className="chat-msg-bullet" aria-hidden="true">•</span>
                <span>{block.text}</span>
              </div>
            );
          }
          if (block.type === 'numbered') {
            return (
              <div key={idx} className="chat-msg-list-item">
                <span className="chat-msg-num">{block.index}.</span>
                <span>{block.text}</span>
              </div>
            );
          }
          return (
            <div key={idx} className="chat-msg-p">
              {block.text}
            </div>
          );
        })}
      </div>
    );
  }
);

function formatShortTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatSessionDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `Hoy ${formatShortTime(ts)}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) {
    return `Ayer ${formatShortTime(ts)}`;
  }
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

const ChatTabInner: React.FC = () => {
  const {
    chatMessages,
    chatSessions,
    activeChatSessionId,
    startNewChatSession,
    selectChatSession,
    deleteChatSession,
    sendChatMessage,
    clearChat,
    aiProfile,
    provideAiFeedback,
    resetAiProfile,
    books,
    openBook,
    setImportModalOpen,
  } = useLibrary();

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [ratedMsgIds, setRatedMsgIds] = useState<Record<string, boolean>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  const lastAssistantMsgId = useMemo(() => {
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      if (chatMessages[i].sender === 'assistant' && chatMessages[i].id !== 'msg_welcome_1') {
        return chatMessages[i].id;
      }
    }
    return '';
  }, [chatMessages]);

  const aiStyleLabel =
    aiProfile.preferredStyle === 'concise'
      ? 'Breve'
      : aiProfile.preferredStyle === 'detailed'
      ? 'Detallado'
      : 'Equilibrado';

  useEffect(() => {
    if (!historyOpen) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, historyOpen]);

  const booksById = useMemo(() => {
    const map = new Map<string, (typeof books)[number]>();
    for (const b of books) map.set(b.id, b);
    return map;
  }, [books]);

  const savedSessions = useMemo(
    () =>
      chatSessions
        .filter((s) => s.messages.some((m) => m.sender === 'user'))
        .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)),
    [chatSessions]
  );

  const filteredSessions = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return savedSessions;
    return savedSessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.messages.some((m) => m.text.toLowerCase().includes(q))
    );
  }, [savedSessions, historyQuery]);

  const hasUserMessages = useMemo(
    () => chatMessages.some((m) => m.sender === 'user'),
    [chatMessages]
  );

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || sending) return;
    const msg = input;
    setInput('');
    setHistoryOpen(false);
    setSending(true);
    try {
      await sendChatMessage(msg);
    } finally {
      setSending(false);
    }
  };

  const handleQuickPrompt = async (prompt: string) => {
    if (sending) return;
    setHistoryOpen(false);
    setSending(true);
    try {
      await sendChatMessage(prompt);
    } finally {
      setSending(false);
    }
  };

  const handleNewChat = () => {
    startNewChatSession();
    setHistoryOpen(false);
    setHistoryQuery('');
  };

  const handleSelectSession = (id: string) => {
    selectChatSession(id);
    setHistoryOpen(false);
  };

  const quickPrompts = ['Mangas', 'Manhwas', 'Favoritos', 'Leyendo'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Top Chat Toolbar: History + New Chat + Clear */}
      <div className="chat-toolbar">
        <button
          type="button"
          className="pill-btn"
          style={{
            height: 27,
            fontSize: 11,
            padding: '0 10px',
            background: historyOpen ? 'var(--accent-primary)' : 'var(--card-bg)',
            color: historyOpen ? 'var(--accent-contrast)' : 'var(--text-primary)',
            borderColor: historyOpen ? 'transparent' : undefined,
          }}
          onClick={() => setHistoryOpen((prev) => !prev)}
          title="Ver historial de conversaciones"
        >
          {historyOpen ? <ArrowLeft size={12} /> : <History size={12} />}
          {historyOpen ? 'Volver al chat' : `Historial (${savedSessions.length})`}
        </button>

        <button
          type="button"
          className="pill-btn"
          style={{ height: 27, fontSize: 11, padding: '0 10px', background: 'var(--card-bg)' }}
          onClick={handleNewChat}
          title="Iniciar nueva conversación (la actual queda guardada en el historial)"
        >
          <MessageSquarePlus size={12} /> Nuevo chat
        </button>

        {!historyOpen && hasUserMessages && (
          <button
            type="button"
            className="pill-btn"
            style={{
              height: 27,
              fontSize: 11,
              padding: '0 8px',
              background: 'var(--card-bg)',
              marginLeft: 'auto',
            }}
            onClick={clearChat}
            title="Limpiar conversación actual"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>

      {historyOpen ? (
        <div className="right-panel-body">
          {savedSessions.length >= 3 && (
            <div className="chat-input-pill" style={{ height: 34, padding: '0 11px' }}>
              <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <input
                type="text"
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
                placeholder="Buscar en tus conversaciones..."
                style={{ fontSize: 11.5 }}
              />
            </div>
          )}

          {filteredSessions.length === 0 ? (
            <div className="studio-card" style={{ textAlign: 'center', padding: '20px 14px' }}>
              <History
                size={22}
                style={{ color: 'var(--text-muted)', margin: '0 auto 8px', display: 'block' }}
              />
              <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 4 }}>
                {savedSessions.length === 0
                  ? 'Aún no hay conversaciones guardadas'
                  : 'No se encontraron conversaciones'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                {savedSessions.length === 0
                  ? 'Cada chat que tengas con la IA se guardará aquí automáticamente para que puedas consultarlo cuando quieras.'
                  : 'Prueba con otra palabra clave.'}
              </div>
            </div>
          ) : (
            <div className="chat-history-list">
              {filteredSessions.map((session) => {
                const isActive = session.id === activeChatSessionId;
                const userCount = session.messages.filter((m) => m.sender === 'user').length;
                const lastMsg = session.messages[session.messages.length - 1];
                return (
                  <div
                    key={session.id}
                    role="button"
                    tabIndex={0}
                    className={`chat-history-item ${isActive ? 'active' : ''}`}
                    onClick={() => handleSelectSession(session.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelectSession(session.id);
                      }
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="chat-history-title">
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {session.title}
                        </span>
                        {isActive && (
                          <span
                            style={{
                              fontSize: 9.5,
                              padding: '1px 6px',
                              borderRadius: 999,
                              background: 'var(--accent-primary)',
                              color: 'var(--accent-contrast)',
                              flexShrink: 0,
                            }}
                          >
                            Activa
                          </span>
                        )}
                      </div>
                      {lastMsg && (
                        <div className="chat-history-preview">
                          {lastMsg.sender === 'assistant' ? sanitizeAiReplyText(lastMsg.text) : lastMsg.text}
                        </div>
                      )}
                      <div className="chat-history-meta">
                        <span>{formatSessionDate(session.updatedAt || session.createdAt)}</span>
                        <span>·</span>
                        <span>
                          {userCount} {userCount === 1 ? 'consulta' : 'consultas'}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="chat-history-del-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteChatSession(session.id);
                      }}
                      title="Eliminar del historial"
                      aria-label={`Eliminar conversación ${session.title}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="right-panel-body">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {quickPrompts.map((q) => (
              <button
                key={q}
                type="button"
                className="pill-btn"
                style={{ height: 26, fontSize: 11, background: 'var(--card-bg)' }}
                onClick={() => handleQuickPrompt(q)}
              >
                <Sparkles size={11} /> {q}
              </button>
            ))}
            {(aiProfile.interactionCount > 0 || aiProfile.preferredStyle !== 'balanced') && (
              <span
                className="chat-ai-status-pill"
                title={`Estilo aprendido: ${aiStyleLabel}${
                  aiProfile.likedTopics.length ? ` · Gustos: ${aiProfile.likedTopics.slice(0, 3).join(', ')}` : ''
                }`}
              >
                IA: {aiStyleLabel}
                <button
                  type="button"
                  onClick={resetAiProfile}
                  title="Reiniciar aprendizaje de la IA"
                  aria-label="Reiniciar aprendizaje de la IA"
                >
                  <RotateCcw size={10} />
                </button>
              </span>
            )}
          </div>

          {chatMessages.map((msg) => {
            const attachedBooks = (msg.bookIds || [])
              .map((id) => booksById.get(id))
              .filter(Boolean);
            const showFeedback =
              msg.sender === 'assistant' &&
              msg.id === lastAssistantMsgId &&
              !sending &&
              !ratedMsgIds[msg.id];

            return (
              <div key={msg.id} className={`chat-bubble-row ${msg.sender}`}>
                <div className={`chat-bubble ${msg.sender}`}>
                  <FormattedChatMessage text={msg.text} isAssistant={msg.sender === 'assistant'} />
                  {attachedBooks.length > 0 && (
                    <div className="chat-embedded-books">
                      {attachedBooks.map((b) =>
                        b ? (
                          <div
                            key={b.id}
                            className="chat-mini-book"
                            onClick={() => openBook(b)}
                            title={`Abrir ${b.title}`}
                          >
                            <div
                              style={{
                                width: 58,
                                height: 82,
                                borderRadius: 7,
                                overflow: 'hidden',
                                boxShadow: '0 4px 10px rgba(0, 0, 0, 0.16)',
                              }}
                            >
                              <BookCoverVisual book={b} compact />
                            </div>
                            <div
                              style={{
                                fontSize: 9.5,
                                fontWeight: 700,
                                marginTop: 3,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                color: 'var(--text-primary)',
                              }}
                            >
                              {b.title}
                            </div>
                          </div>
                        ) : null
                      )}
                    </div>
                  )}
                  {showFeedback && (
                    <div className="chat-feedback-row">
                      <button
                        type="button"
                        className="chat-feedback-pill"
                        onClick={() => {
                          provideAiFeedback('shorter');
                          setRatedMsgIds((prev) => ({ ...prev, [msg.id]: true }));
                        }}
                      >
                        Más breve
                      </button>
                      <button
                        type="button"
                        className="chat-feedback-pill"
                        onClick={() => {
                          provideAiFeedback('detailed');
                          setRatedMsgIds((prev) => ({ ...prev, [msg.id]: true }));
                        }}
                      >
                        Más detalle
                      </button>
                      <button
                        type="button"
                        className="chat-feedback-pill"
                        onClick={() => {
                          provideAiFeedback('helpful');
                          setRatedMsgIds((prev) => ({ ...prev, [msg.id]: true }));
                        }}
                        title="Recordar este estilo de respuesta"
                      >
                        <ThumbsUp size={10} /> Clara
                      </button>
                    </div>
                  )}
                </div>
                {msg.createdAt > 0 && msg.id !== 'msg_welcome_1' && (
                  <span className="chat-bubble-time">{formatShortTime(msg.createdAt)}</span>
                )}
              </div>
            );
          })}
          {sending && (
            <div className="chat-bubble-row assistant">
              <div className="chat-bubble assistant" style={{ opacity: 0.78 }}>
                Pensando recomendación...
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      <form className="chat-input-bar" onSubmit={handleSend}>
        <button
          type="button"
          className="circle-arrow-btn"
          style={{ width: 38, height: 38, background: 'var(--card-bg)', flexShrink: 0 }}
          onClick={() => setImportModalOpen(true)}
          title="Adjuntar / Importar libro o manga"
        >
          <Paperclip size={16} />
        </button>

        <div className="chat-input-pill">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe un mensaje o /nota..."
          />
        </div>

        <button type="submit" className="chat-send-btn" disabled={sending} title="Enviar">
          <Send size={15} />
        </button>
      </form>
    </div>
  );
};

export const ChatTab = React.memo(ChatTabInner);
