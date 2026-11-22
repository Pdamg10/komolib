import React, { useRef, useState } from 'react';
import {
  Download,
  Image,
  Layout,
  Palette,
  Plus,
  RotateCcw,
  Sparkles,
  Tag,
  Trash2,
  Type,
  Upload,
  X,
} from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import { THEME_PRESETS } from '../data/presets';
import type { ThemeConfig } from '../types/library';
import { saveTextFileLocally } from '../utils/nativeBridge';
import { extractWallpaperTheme } from '../utils/wallpaperTheme';

type StudioSection = 'themes' | 'palette' | 'layout' | 'categories';

const CATEGORY_ICON_CHOICES = [
  'stack',
  'manga',
  'manhwa',
  'comic',
  'heart',
  'sparkle',
  'ufo',
  'mystery',
  'audio',
  'new',
];

export const StudioModal: React.FC = () => {
  const {
    studioModalOpen,
    setStudioModalOpen,
    theme,
    updateTheme,
    resetTheme,
    categories,
    addCategory,
    deleteCategory,
    showToast,
  } = useLibrary();

  const [section, setSection] = useState<StudioSection>('themes');
  const [newCatLabel, setNewCatLabel] = useState('');
  const [newCatColor, setNewCatColor] = useState('#7e6bc4');
  const [newCatIcon, setNewCatIcon] = useState('sparkle');
  const importThemeInputRef = useRef<HTMLInputElement>(null);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);

  if (!studioModalOpen) return null;

  const handleExportTheme = () => {
    const fileName = `komolib-theme-${theme.presetId || 'custom'}.json`;
    const res = saveTextFileLocally(fileName, JSON.stringify(theme, null, 2), 'application/json');
    showToast(
      res.ok
        ? res.location && res.location !== fileName
          ? `Tema guardado en ${res.location}`
          : 'Tema exportado en JSON'
        : res.error || 'No se pudo exportar el tema'
    );
  };

  const handleImportTheme = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Partial<ThemeConfig>;
      updateTheme(parsed);
      showToast('Tema importado correctamente');
    } catch {
      showToast('Archivo de tema inválido');
    }
    e.target.value = '';
  };

  const compressWallpaperImage = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
      reader.onload = () => {
        const rawUrl = String(reader.result || '');
        if (!rawUrl) {
          resolve('');
          return;
        }
        const img = new window.Image();
        img.onerror = () => resolve(rawUrl);
        img.onload = () => {
          const maxSide = 1920;
          const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(rawUrl);
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          try {
            const webp = canvas.toDataURL('image/webp', 0.82);
            if (webp.startsWith('data:image/webp')) {
              resolve(webp);
              return;
            }
          } catch {
            // fallback to jpeg
          }
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = rawUrl;
      };
      reader.readAsDataURL(file);
    });

  const handleWallpaperUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await compressWallpaperImage(file);
      if (!dataUrl) return;
      const adaptedPalette = await extractWallpaperTheme(dataUrl);
      updateTheme({
        ...adaptedPalette,
        customWallpaperUrl: dataUrl,
      });
      showToast('Fondo aplicado y colores adaptados automáticamente');
    } catch {
      showToast('No se pudo procesar la imagen de fondo');
    }
  };

  const handleReAdaptWallpaper = async () => {
    if (!theme.customWallpaperUrl) return;
    const adaptedPalette = await extractWallpaperTheme(theme.customWallpaperUrl);
    updateTheme(adaptedPalette);
    showToast('Colores re-adaptados al fondo');
  };

  const handleAddCat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatLabel.trim()) return;
    addCategory({
      label: newCatLabel.trim(),
      icon: newCatIcon,
      color: newCatColor,
      accent: '#f7d060',
    });
    setNewCatLabel('');
  };

  return (
    <div
      className="modal-overlay studio-modal-overlay"
      onClick={() => setStudioModalOpen(false)}
    >
      <div
        className="modal-card studio-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Estudio de Personalización"
      >
        {/* Header */}
        <div className="studio-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
            <span
              style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                background: 'color-mix(in srgb, var(--accent-primary) 16%, transparent)',
                color: 'var(--accent-primary)',
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
              }}
            >
              <Palette size={18} />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, lineHeight: 1.2 }}>
                Estudio de Personalización
              </h3>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, lineHeight: 1.35, marginTop: 2 }}>
                Ajusta temas, fondo, paleta, tipografía y categorías en tiempo real
              </div>
            </div>
          </div>

          <button
            type="button"
            className="circle-arrow-btn"
            style={{ flexShrink: 0 }}
            onClick={() => setStudioModalOpen(false)}
            aria-label="Cerrar personalización"
          >
            <X size={16} />
          </button>
        </div>

        {/* Section Tabs */}
        <div className="studio-modal-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={section === 'themes'}
            className={`studio-modal-tab ${section === 'themes' ? 'active' : ''}`}
            onClick={() => setSection('themes')}
          >
            <Sparkles size={13} /> Temas y Fondo
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === 'palette'}
            className={`studio-modal-tab ${section === 'palette' ? 'active' : ''}`}
            onClick={() => setSection('palette')}
          >
            <Palette size={13} /> Paleta Libre
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === 'layout'}
            className={`studio-modal-tab ${section === 'layout' ? 'active' : ''}`}
            onClick={() => setSection('layout')}
          >
            <Layout size={13} /> Diseño y Forma
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === 'categories'}
            className={`studio-modal-tab ${section === 'categories' ? 'active' : ''}`}
            onClick={() => setSection('categories')}
          >
            <Tag size={13} /> Categorías
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="studio-modal-body">
          {section === 'themes' && (
            <div className="studio-modal-two-col">
              {/* Presets */}
              <div className="studio-card">
                <h4>
                  <Sparkles size={14} /> Temas Predefinidos
                </h4>
                <div className="preset-grid">
                  {THEME_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`preset-btn ${theme.presetId === p.id ? 'active' : ''}`}
                      onClick={() => updateTheme(p.patch)}
                    >
                      <span className="preset-swatches">
                        {p.swatches.map((s, idx) => (
                          <span key={idx} className="preset-swatch" style={{ background: s }} />
                        ))}
                      </span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Wallpaper */}
              <div className="studio-card">
                <h4>
                  <Image size={14} /> Fondo Personalizado
                </h4>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                  Sube cualquier imagen: se visualizará en toda la pantalla con efecto cristal y los colores se adaptarán automáticamente para mantener todo legible.
                </div>

                {theme.customWallpaperUrl && (
                  <div
                    style={{
                      width: '100%',
                      height: 92,
                      borderRadius: 12,
                      backgroundImage: `url(${theme.customWallpaperUrl})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      border: '1px solid var(--border-subtle)',
                    }}
                  />
                )}

                <div className="studio-wallpaper-actions">
                  <button
                    type="button"
                    className="pill-btn"
                    style={{ flex: '1 1 130px', justifyContent: 'center' }}
                    onClick={() => wallpaperInputRef.current?.click()}
                  >
                    <Upload size={12} /> {theme.customWallpaperUrl ? 'Cambiar fondo' : 'Subir imagen'}
                  </button>
                  {theme.customWallpaperUrl && (
                    <>
                      <button
                        type="button"
                        className="pill-btn"
                        style={{ flex: '1 1 92px', justifyContent: 'center' }}
                        onClick={handleReAdaptWallpaper}
                        title="Re-extraer paleta de colores desde la imagen de fondo"
                      >
                        <Sparkles size={12} /> Adaptar
                      </button>
                      <button
                        type="button"
                        className="pill-btn"
                        style={{ flex: '1 1 82px', justifyContent: 'center' }}
                        onClick={() => updateTheme({ customWallpaperUrl: '' })}
                      >
                        Quitar
                      </button>
                    </>
                  )}
                </div>

                {theme.customWallpaperUrl && (
                  <>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, fontWeight: 700 }}>
                      <span>
                        Visibilidad de paneles: {Math.round((theme.wallpaperOpacity ?? 0.78) * 100)}%
                      </span>
                      <input
                        type="range"
                        min={0.45}
                        max={0.95}
                        step={0.02}
                        value={theme.wallpaperOpacity ?? 0.78}
                        onChange={(e) => updateTheme({ wallpaperOpacity: Number(e.target.value) })}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, fontWeight: 700 }}>
                      <span>Desenfoque cristal: {theme.wallpaperBlur ?? 12}px</span>
                      <input
                        type="range"
                        min={0}
                        max={24}
                        step={1}
                        value={theme.wallpaperBlur ?? 12}
                        onChange={(e) => updateTheme({ wallpaperBlur: Number(e.target.value) })}
                      />
                    </label>
                  </>
                )}

                <input
                  ref={wallpaperInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={handleWallpaperUpload}
                />
              </div>
            </div>
          )}

          {section === 'palette' && (
            <div className="studio-card">
              <h4>
                <Palette size={14} /> Paleta de Colores Libre
              </h4>
              <div className="studio-color-grid">
                {(
                  [
                    ['Fondo exterior', 'outerBg'],
                    ['Fondo principal', 'shellBg'],
                    ['Barra lateral', 'sidebarBg'],
                    ['Panel derecho', 'panelBg'],
                    ['Tarjetas y modales', 'cardBg'],
                    ['Secciones y botones', 'bannerBg'],
                    ['Color acento', 'accentPrimary'],
                    ['Color secundario', 'accentSecondary'],
                    ['Botón lateral', 'sidebarPillBg'],
                    ['Texto principal', 'textPrimary'],
                    ['Texto secundario', 'textMuted'],
                    ['Color autores', 'authorColor'],
                    ['Burbuja usuario', 'chatUserBubble'],
                    ['Burbuja asistente', 'chatBotBubble'],
                  ] as Array<[string, keyof ThemeConfig]>
                ).map(([label, key]) => (
                  <label key={key} className="color-row studio-color-chip">
                    <span>{label}</span>
                    <input
                      type="color"
                      value={String(theme[key])}
                      onChange={(e) => updateTheme({ [key]: e.target.value, presetId: 'custom' })}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          {section === 'layout' && (
            <div className="studio-modal-two-col">
              <div className="studio-card">
                <h4>
                  <Type size={14} /> Tipografía y Forma
                </h4>
                <label className="studio-select-row">
                  <span>Fuente UI</span>
                  <select
                    className="studio-input"
                    value={theme.fontFamily}
                    onChange={(e) =>
                      updateTheme({ fontFamily: e.target.value as ThemeConfig['fontFamily'] })
                    }
                  >
                    <option value="Quicksand">Quicksand (Original)</option>
                    <option value="Nunito">Nunito</option>
                    <option value="Fredoka">Fredoka (Cozy)</option>
                    <option value="Inter">Inter (Limpia)</option>
                    <option value="Lora">Lora (Editorial)</option>
                  </select>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, fontWeight: 700 }}>
                  <span>Redondeo de bordes: {theme.borderRadius}px</span>
                  <input
                    type="range"
                    min={8}
                    max={36}
                    value={theme.borderRadius}
                    onChange={(e) => updateTheme({ borderRadius: Number(e.target.value) })}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, fontWeight: 700 }}>
                  <span>Escala de interfaz: {Math.round(theme.uiScale * 100)}%</span>
                  <input
                    type="range"
                    min={0.88}
                    max={1.15}
                    step={0.02}
                    value={theme.uiScale}
                    onChange={(e) => updateTheme({ uiScale: Number(e.target.value) })}
                  />
                </label>

                <label className="studio-select-row">
                  <span>Rendimiento (Gama baja)</span>
                  <select
                    className="studio-input"
                    value={theme.lowPerformanceMode || 'auto'}
                    onChange={(e) =>
                      updateTheme({
                        lowPerformanceMode: e.target.value as ThemeConfig['lowPerformanceMode'],
                      })
                    }
                  >
                    <option value="auto">Automático</option>
                    <option value="on">Ligero (Máx. fluidez)</option>
                    <option value="off">Completo (Efectos)</option>
                  </select>
                </label>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700 }}>Texto botón lateral</span>
                  <input
                    className="studio-input"
                    value={theme.sidebarPillLabel}
                    onChange={(e) => updateTheme({ sidebarPillLabel: e.target.value })}
                  />
                </div>
              </div>

              <div className="studio-card">
                <h4>
                  <Layout size={14} /> Diseño y Detalles de Libros
                </h4>
                {(
                  [
                    ['Vista pantalla completa', 'fullView'],
                    ['Páginas 3D en portadas', 'showBookPages3D'],
                    ['Cinta marcapáginas', 'showBookRibbons'],
                    ['Patrón ilustrado en panel', 'showDoodlePattern'],
                    ['Barra de categorías', 'showCategories'],
                    ['Barra lateral compacta', 'compactSidebar'],
                  ] as Array<[string, keyof ThemeConfig]>
                ).map(([label, key]) => (
                  <div key={key} className="toggle-row">
                    <span>{label}</span>
                    <button
                      type="button"
                      className={`switch ${theme[key] ? 'on' : ''}`}
                      onClick={() => updateTheme({ [key]: !theme[key] })}
                      aria-label={label}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {section === 'categories' && (
            <div className="studio-card">
              <h4>
                <Tag size={14} /> Categorías Personalizadas
              </h4>
              <form onSubmit={handleAddCat} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                  <input
                    className="studio-input"
                    style={{ flex: 1, minWidth: 0 }}
                    placeholder="Ej: Seinen, Terror, Estudio..."
                    value={newCatLabel}
                    onChange={(e) => setNewCatLabel(e.target.value)}
                  />
                  <input
                    type="color"
                    value={newCatColor}
                    onChange={(e) => setNewCatColor(e.target.value)}
                    style={{ width: 38, height: 36, border: 'none', background: 'transparent', flexShrink: 0 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                  <select
                    className="studio-input"
                    style={{ flex: 1, minWidth: 0 }}
                    value={newCatIcon}
                    onChange={(e) => setNewCatIcon(e.target.value)}
                  >
                    {CATEGORY_ICON_CHOICES.map((ic) => (
                      <option key={ic} value={ic}>
                        Icono: {ic}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="pill-btn"
                    style={{
                      background: 'var(--accent-primary)',
                      color: 'var(--accent-contrast)',
                      borderColor: 'transparent',
                      flexShrink: 0,
                      height: 36,
                    }}
                  >
                    <Plus size={13} /> Crear
                  </button>
                </div>
              </form>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {categories
                  .filter((c) => !c.builtin)
                  .map((c) => (
                    <span
                      key={c.id}
                      className="pill-btn"
                      style={{ height: 28, fontSize: 11.5, gap: 5 }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: c.color,
                          display: 'inline-block',
                        }}
                      />
                      {c.label}
                      <button
                        type="button"
                        onClick={() => deleteCategory(c.id)}
                        style={{ color: 'var(--accent-primary)', display: 'grid', placeItems: 'center' }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </span>
                  ))}
                {categories.filter((c) => !c.builtin).length === 0 && (
                  <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    Todavía no has creado categorías personalizadas.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="studio-modal-footer">
          <div className="studio-modal-footer-actions">
            <button type="button" className="pill-btn" onClick={handleExportTheme}>
              <Download size={12} /> Exportar
            </button>
            <button
              type="button"
              className="pill-btn"
              onClick={() => importThemeInputRef.current?.click()}
            >
              <Upload size={12} /> Importar
            </button>
            <button type="button" className="pill-btn" onClick={resetTheme}>
              <RotateCcw size={12} /> Reset
            </button>
          </div>

          <button
            type="button"
            className="coral-cta-btn studio-modal-done-btn"
            onClick={() => setStudioModalOpen(false)}
          >
            Listo
          </button>

          <input
            ref={importThemeInputRef}
            type="file"
            accept="application/json"
            hidden
            onChange={handleImportTheme}
          />
        </div>
      </div>
    </div>
  );
};
