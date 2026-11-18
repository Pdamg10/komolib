import React, { useEffect, useRef, useState } from 'react';
import { Image, Trash2, X } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import type { ContentKind } from '../types/library';

export const BookDetailModal: React.FC = () => {
  const { editingBook, setEditingBook, updateBook, deleteBook, categories } = useLibrary();
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<ContentKind>('book');
  const [spineColor, setSpineColor] = useState('#4c6c8a');
  const [ribbonColor, setRibbonColor] = useState('#f2ba59');
  const [coverDataUrl, setCoverDataUrl] = useState('');
  const [cats, setCats] = useState<string[]>([]);
  const coverRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editingBook) return;
    setTitle(editingBook.title);
    setAuthor(editingBook.author);
    setDescription(editingBook.description || '');
    setKind(editingBook.kind);
    setSpineColor(editingBook.spineColor);
    setRibbonColor(editingBook.ribbonColor);
    setCoverDataUrl(editingBook.coverDataUrl);
    setCats(editingBook.categories || []);
  }, [editingBook]);

  if (!editingBook) return null;

  const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCoverDataUrl(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const toggleCat = (id: string) => {
    setCats((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateBook(editingBook.id, {
      title: title.trim() || editingBook.title,
      author: author.trim() || editingBook.author,
      description,
      kind,
      spineColor,
      ribbonColor,
      coverDataUrl,
      categories: cats,
    });
    setEditingBook(null);
  };

  return (
    <div className="modal-overlay" onClick={() => setEditingBook(null)}>
      <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={handleSave}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Personalizar Título</h3>
          <button type="button" className="circle-arrow-btn" onClick={() => setEditingBook(null)}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ width: 112, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div
              style={{
                width: 112,
                height: 154,
                borderRadius: 12,
                overflow: 'hidden',
                background: spineColor,
                padding: '0 0 10px 5px',
                boxShadow: 'var(--shadow-book)',
              }}
            >
              <img
                src={coverDataUrl}
                alt={title}
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }}
              />
            </div>
            <button
              type="button"
              className="pill-btn"
              style={{ justifyContent: 'center', fontSize: 11 }}
              onClick={() => coverRef.current?.click()}
            >
              <Image size={12} /> Portada
            </button>
            <input ref={coverRef} type="file" accept="image/*" hidden onChange={handleCoverUpload} />
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700 }}>Título</label>
              <input className="studio-input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700 }}>Autor</label>
              <input className="studio-input" value={author} onChange={(e) => setAuthor(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700 }}>Modo / Tipo</label>
              <select
                className="studio-input"
                value={kind}
                onChange={(e) => setKind(e.target.value as ContentKind)}
              >
                <option value="book">Libro / eBook</option>
                <option value="manga">Manga (RTL)</option>
                <option value="manhwa">Manhwa / Webtoon (Vertical)</option>
                <option value="comic">Cómic (LTR)</option>
                <option value="audiobook">Audiolibro</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 14 }}>
              <label className="color-row" style={{ gap: 8 }}>
                <span>Color lomo</span>
                <input type="color" value={spineColor.startsWith('#') ? spineColor : '#4c6c8a'} onChange={(e) => setSpineColor(e.target.value)} />
              </label>
              <label className="color-row" style={{ gap: 8 }}>
                <span>Cinta</span>
                <input type="color" value={ribbonColor} onChange={(e) => setRibbonColor(e.target.value)} />
              </label>
            </div>
          </div>
        </div>

        <div>
          <label style={{ fontSize: 11, fontWeight: 700 }}>Sinopsis / Notas</label>
          <textarea
            className="studio-input"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div>
          <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6 }}>
            Categorías
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {categories
              .filter((c) => c.id !== 'all')
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`pill-btn ${cats.includes(c.id) ? 'active' : ''}`}
                  style={{ height: 28, fontSize: 11 }}
                  onClick={() => toggleCat(c.id)}
                >
                  {c.label}
                </button>
              ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <button
            type="button"
            className="pill-btn"
            style={{ color: '#c84b4e' }}
            onClick={() => deleteBook(editingBook.id)}
          >
            <Trash2 size={14} /> Eliminar
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="pill-btn" onClick={() => setEditingBook(null)}>
              Cancelar
            </button>
            <button type="submit" className="coral-cta-btn">
              Guardar cambios
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
