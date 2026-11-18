import React, { useRef, useState } from 'react';
import { FileUp, Images, Layers, Upload, X } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import { ACCEPTED_EXTENSIONS } from '../parsers';
import type { ContentKind } from '../types/library';

export const ImportModal: React.FC = () => {
  const { importModalOpen, setImportModalOpen, importFiles, categories } = useLibrary();
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [bundleImages, setBundleImages] = useState(true);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [kind, setKind] = useState<ContentKind | 'auto'>('auto');
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!importModalOpen) return null;

  const hasMultipleImages =
    files.filter((f) => /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(f.name)).length > 1;

  const handleSelectFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles(Array.from(list));
  };

  const toggleCat = (id: string) => {
    setSelectedCats((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleConfirm = async () => {
    if (!files.length || importing) return;
    setImporting(true);
    try {
      await importFiles(files, {
        bundleImages: hasMultipleImages && bundleImages,
        title: title.trim() || undefined,
        author: author.trim() || undefined,
        kind: kind === 'auto' ? undefined : kind,
        categories: selectedCats,
      });
      setFiles([]);
      setTitle('');
      setAuthor('');
      setKind('auto');
      setSelectedCats([]);
      setImportModalOpen(false);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => setImportModalOpen(false)}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
            Importar Libros, Mangas y Manhwas
          </h3>
          <button className="circle-arrow-btn" onClick={() => setImportModalOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <div
          className={`dropzone ${dragging ? 'dragging' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleSelectFiles(e.dataTransfer.files);
          }}
        >
          <Upload size={34} style={{ color: 'var(--accent-primary)', marginBottom: 8 }} />
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>
            Arrastra tus archivos aquí o toca para explorar
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            EPUB · PDF · CBZ · CBR · ZIP · RAR · MOBI · AZW3 · FB2 · DOCX · TXT · MD · HTML · MP3/M4B · Imágenes
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_EXTENSIONS}
            hidden
            onChange={(e) => handleSelectFiles(e.target.files)}
          />
        </div>

        {files.length > 0 && (
          <div
            style={{
              background: 'var(--banner-bg)',
              borderRadius: 14,
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
              <FileUp size={14} /> {files.length} archivo(s) seleccionado(s)
            </div>
            <div style={{ maxHeight: 90, overflowY: 'auto', fontSize: 11.5, color: 'var(--text-muted)' }}>
              {files.map((f, i) => (
                <div key={i}>
                  • {f.name} ({(f.size / 1024 / 1024).toFixed(2)} MB)
                </div>
              ))}
            </div>
          </div>
        )}

        {hasMultipleImages && (
          <div className="toggle-row" style={{ background: 'var(--banner-bg)', padding: '10px 12px', borderRadius: 12 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Images size={15} /> Unir imágenes en un solo volumen de Manga / Manhwa
            </span>
            <button
              type="button"
              className={`switch ${bundleImages ? 'on' : ''}`}
              onClick={() => setBundleImages(!bundleImages)}
            />
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>
              Tipo de lectura
            </label>
            <select
              className="studio-input"
              value={kind}
              onChange={(e) => setKind(e.target.value as ContentKind | 'auto')}
            >
              <option value="auto">Auto-detectar por archivo</option>
              <option value="book">Libro / Novela</option>
              <option value="manga">Manga (Derecha → Izquierda)</option>
              <option value="manhwa">Manhwa / Webtoon (Tira vertical)</option>
              <option value="comic">Cómic (Izquierda → Derecha)</option>
              <option value="audiobook">Audiolibro</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>
              Autor (opcional)
            </label>
            <input
              className="studio-input"
              placeholder="Auto o nombre del autor"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </div>
        </div>

        {(files.length === 1 || (hasMultipleImages && bundleImages)) && (
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 700, display: 'block', marginBottom: 4 }}>
              Título personalizado (opcional)
            </label>
            <input
              className="studio-input"
              placeholder="Déjalo vacío para extraer del archivo"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
        )}

        <div>
          <label
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              marginBottom: 6,
            }}
          >
            <Layers size={13} /> Categorías adicionales
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {categories
              .filter((c) => c.id !== 'all')
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`pill-btn ${selectedCats.includes(c.id) ? 'active' : ''}`}
                  style={{ height: 28, fontSize: 11 }}
                  onClick={() => toggleCat(c.id)}
                >
                  {c.label}
                </button>
              ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button className="pill-btn" onClick={() => setImportModalOpen(false)}>
            Cancelar
          </button>
          <button
            className="coral-cta-btn"
            disabled={!files.length || importing}
            onClick={handleConfirm}
          >
            {importing ? 'Procesando archivos...' : `Importar (${files.length})`}
          </button>
        </div>
      </div>
    </div>
  );
};
