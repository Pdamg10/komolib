import React from 'react';
import {
  Bookmark,
  Heart,
  LayoutGrid,
  Palette,
  Play,
  Star,
} from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import type { NavSection } from '../types/library';

export const Sidebar: React.FC = () => {
  const {
    navSection,
    setNavSection,
    profile,
    setProfileModalOpen,
    books,
    theme,
    updateTheme,
    setRightTab,
    setMobilePanelOpen,
  } = useLibrary();

  const favCount = books.filter((b) => b.favorite).length;
  const readingCount = books.filter((b) => b.progress > 0 && b.progress < 100).length;

  const navItems: Array<{
    id: NavSection;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    { id: 'home', label: 'Biblioteca', icon: <LayoutGrid size={19} /> },
    { id: 'favorites', label: 'Favoritos', icon: <Star size={19} />, badge: favCount || undefined },
    { id: 'wishlist', label: 'Lista de deseos', icon: <Heart size={19} /> },
    { id: 'reading', label: 'Leyendo y Audio', icon: <Play size={19} />, badge: readingCount || undefined },
    { id: 'collections', label: 'Colecciones', icon: <Bookmark size={19} /> },
  ];

  const handleOpenStudio = () => {
    setRightTab('studio');
    if (!theme.showRightPanel) {
      updateTheme({ showRightPanel: true });
    }
    setMobilePanelOpen(true);
  };

  return (
    <aside className="left-rail" aria-label="Navegación principal">
      <button
        className="avatar-btn"
        style={{ background: profile.avatarBg }}
        onClick={() => setProfileModalOpen(true)}
        title={`Perfil: ${profile.name}`}
      >
        {profile.avatarImageUrl ? (
          <img src={profile.avatarImageUrl} alt={profile.name} />
        ) : (
          <span>{profile.avatarEmoji}</span>
        )}
      </button>

      <nav className="rail-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`rail-icon-btn ${navSection === item.id ? 'active' : ''}`}
            onClick={() => setNavSection(item.id)}
            title={item.label}
            aria-label={item.label}
          >
            {item.icon}
            {item.badge ? <span className="rail-badge">{item.badge}</span> : null}
          </button>
        ))}
      </nav>

      <button
        className="vertical-pill-btn"
        onClick={handleOpenStudio}
        title="Abrir Estudio de Personalización"
      >
        <span className="vertical-pill-icon">
          <Palette size={15} />
        </span>
        <span className="vertical-pill-text">{theme.sidebarPillLabel || 'personalizar'}</span>
      </button>
    </aside>
  );
};
