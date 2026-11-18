import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, Paperclip, Send, Sparkles, Trash2 } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';

export const ChatTab: React.FC = () => {
  const {
    chatMessages,
    sendChatMessage,
    clearChat,
    books,
    openBook,
    setImportModalOpen,
    setRightTab,
  } = useLibrary();

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || sending) return;
    const msg = input;
    setInput('');
    setSending(true);
    try {
      await sendChatMessage(msg);
    } finally {
      setSending(false);
    }
  };

  const quickPrompts = ['Mangas', 'Manhwas', 'Favoritos', 'Leyendo'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="right-panel-body">
        <button
          className="chat-info-card"
          onClick={() => setRightTab('notes')}
          style={{ textAlign: 'left', width: '100%' }}
        >
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 800 }}>Asistente y Sincronización</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
              Busca libros, usa /nota o conecta IA local
            </div>
          </div>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'var(--card-bg)',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <ChevronRight size={15} />
          </span>
        </button>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {quickPrompts.map((q) => (
            <button
              key={q}
              className="pill-btn"
              style={{ height: 26, fontSize: 11, background: 'rgba(255,255,255,0.75)' }}
              onClick={() => sendChatMessage(q)}
            >
              <Sparkles size={11} /> {q}
            </button>
          ))}
          <button
            className="pill-btn"
            style={{ height: 26, fontSize: 11, background: 'rgba(255,255,255,0.55)', marginLeft: 'auto' }}
            onClick={clearChat}
            title="Limpiar chat"
          >
            <Trash2 size={11} />
          </button>
        </div>

        {chatMessages.map((msg) => {
          const attachedBooks = (msg.bookIds || [])
            .map((id) => books.find((b) => b.id === id))
            .filter(Boolean);

          return (
            <div key={msg.id} className={`chat-bubble-row ${msg.sender}`}>
              <div className={`chat-bubble ${msg.sender}`}>
                <div>{msg.text}</div>
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
                          <img src={b.coverDataUrl} alt={b.title} />
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
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

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
