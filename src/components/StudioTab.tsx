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
} from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import { THEME_PRESETS } from '../data/presets';
import type { ThemeConfig } from '../types/library';

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

export const StudioTab: React.FC = () => {
  const {
    theme,
    updateTheme,
    resetTheme,
    categories,
    addCategory,
    deleteCategory,
    showToast,
  } = useLibrary();

  const [newCatLabel, setNewCatLabel] = useState('');
  const [newCatColor, setNewCatColor] = useState('#7e6bc4');
  const [newCatIcon, setNewCatIcon] = useState('sparkle');
  const importThemeInputRef = useRef<HTMLInputElement>(null);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);

  const handleExportTheme = () => {
    const blob = new Blob([JSON.stringify(theme, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `komolib-theme-${theme.presetId || 'custom'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Tema exportado en JSON');
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

  const handleWallpaperUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateTheme({ customWallpaperUrl: String(reader.result || '') });
      showToast('Fondo personalizado aplicado');
    };
    reader.readAsDataURL(file);
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
    <div className="right-panel-body">
      {/* Presets */}
      <div className="studio-card">
        <h4>
          <Sparkles size={14} /> Temas Predefinidos
        </h4>
        <div className="preset-grid">
          {THEME_PRESETS.map((p) => (
            <button
              key={p.id}
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

      {/* Custom Colors */}
      <div className="studio-card">
        <h4>
          <Palette size={14} /> Paleta de Colores Libre
        </h4>
        {(
          [
            ['Fondo exterior', 'outerBg'],
            ['Fondo principal', 'shellBg'],
            ['Barra lateral', 'sidebarBg'],
            ['Panel derecho', 'panelBg'],
            ['Banner y tarjetas', 'bannerBg'],
            ['Color acento', 'accentPrimary'],
            ['Color secundario', 'accentSecondary'],
            ['Botón lateral', 'sidebarPillBg'],
            ['Texto principal', 'textPrimary'],
            ['Color autores', 'authorColor'],
            ['Burbuja chat', 'chatUserBubble'],
          ] as Array<[string, keyof ThemeConfig]>
        ).map(([label, key]) => (
          <label key={key} className="color-row">
            <span>{label}</span>
            <input
              type="color"
              value={String(theme[key])}
              onChange={(e) => updateTheme({ [key]: e.target.value, presetId: 'custom' })}
            />
          </label>
        ))}
      </div>

      {/* Typography & Geometry */}
      <div className="studio-card">
        <h4>
          <Type size={14} /> Tipografía y Forma
        </h4>
        <label className="color-row">
          <span>Fuente UI</span>
          <select
            className="studio-input"
            style={{ width: 140 }}
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
      </div>

      {/* Layout & Visual Toggles */}
      <div className="studio-card">
        <h4>
          <Layout size={14} /> Diseño y Detalles de Libros
        </h4>
        {(
          [
            ['Páginas 3D en portadas', 'showBookPages3D'],
            ['Cinta marcapáginas', 'showBookRibbons'],
            ['Patrón ilustrado en panel', 'showDoodlePattern'],
            ['Barra de categorías', 'showCategories'],
            ['Banner de colecciones', 'showBanner'],
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700 }}>Título del banner</span>
          <input
            className="studio-input"
            value={theme.bannerTitle}
            onChange={(e) => updateTheme({ bannerTitle: e.target.value })}
          />
          <span style={{ fontSize: 11, fontWeight: 700 }}>Texto botón lateral</span>
          <input
            className="studio-input"
            value={theme.sidebarPillLabel}
            onChange={(e) => updateTheme({ sidebarPillLabel: e.target.value })}
          />
        </div>
      </div>

      {/* Wallpaper */}
      <div className="studio-card">
        <h4>
          <Image size={14} /> Fondo Personalizado
        </h4>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="pill-btn"
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={() => wallpaperInputRef.current?.click()}
          >
            <Upload size={12} /> Subir imagen
          </button>
          {theme.customWallpaperUrl && (
            <button
              className="pill-btn"
              onClick={() => updateTheme({ customWallpaperUrl: '' })}
            >
              Quitar
            </button>
          )}
        </div>
        <input
          ref={wallpaperInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleWallpaperUpload}
        />
      </div>

      {/* Custom Categories */}
      <div className="studio-card">
        <h4>
          <Tag size={14} /> Categorías Personalizadas
        </h4>
        <form onSubmit={handleAddCat} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              className="studio-input"
              placeholder="Ej: Seinen, Terror, Estudio..."
              value={newCatLabel}
              onChange={(e) => setNewCatLabel(e.target.value)}
            />
            <input
              type="color"
              value={newCatColor}
              onChange={(e) => setNewCatColor(e.target.value)}
              style={{ width: 34, height: 34, border: 'none', background: 'transparent' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <select
              className="studio-input"
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
              style={{ background: 'var(--accent-primary)', color: '#fff', flexShrink: 0 }}
            >
              <Plus size={13} /> Crear
            </button>
          </div>
        </form>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {categories
            .filter((c) => !c.builtin)
            .map((c) => (
              <span
                key={c.id}
                className="pill-btn"
                style={{ height: 26, fontSize: 11, gap: 4 }}
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
                  onClick={() => deleteCategory(c.id)}
                  style={{ color: 'var(--accent-primary)', display: 'grid', placeItems: 'center' }}
                >
                  <Trash2 size={11} />
                </button>
              </span>
            ))}
        </div>
      </div>

      {/* Export / Import / Reset */}
      <div className="studio-card">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="pill-btn" onClick={handleExportTheme}>
            <Download size={12} /> Exportar tema
          </button>
          <button
            className="pill-btn"
            onClick={() => importThemeInputRef.current?.click()}
          >
            <Upload size={12} /> Importar JSON
          </button>
          <button className="pill-btn" onClick={resetTheme}>
            <RotateCcw size={12} /> Reset
          </button>
        </div>
        <input
          ref={importThemeInputRef}
          type="file"
          accept="application/json"
          hidden
          onChange={handleImportTheme}
        />
      </div>
    </div>
  );
};
