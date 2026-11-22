import React, { useMemo } from 'react';
import {
  BarChart3,
  BookCheck,
  Bookmark,
  BookMarked,
  ClipboardList,
  Headphones,
  LayoutGrid,
  Palette,
  Star,
  Users,
} from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import type { NavSection } from '../types/library';
import { getEffectiveStatus } from '../utils/readingStats';

export const Sidebar: React.FC = () => {
  const {
    navSection,
    setNavSection,
    profile,
    setProfileModalOpen,
    books,
    sharedRooms,
    sharedShelves,
    theme,
    setStudioModalOpen,
  } = useLibrary();

  const { completedCount, audiobooksCount } = useMemo(() => {
    let completed = 0;
    let audio = 0;
    for (const b of books) {
      if (getEffectiveStatus(b) === 'completed' || (b.progress || 0) >= 98) completed++;
      if (b.format === 'audio' || b.kind === 'audiobook') audio++;
    }
    return { completedCount: completed, audiobooksCount: audio };
  }, [books]);

  const sharedTotalCount = sharedRooms.length + sharedShelves.length;

  const navItems: Array<{
    id: NavSection;
    label: string;
    icon: React.ReactNode;
    badge?: number | string;
  }> = [
    { id: 'home', label: 'Biblioteca', icon: <LayoutGrid size={19} /> },
    { id: 'dashboard', label: 'Estadísticas de Lectura', icon: <BarChart3 size={19} /> },
    { id: 'reading-log', label: 'Diario de Lectura y Reseñas', icon: <ClipboardList size={19} /> },
    {
      id: 'annotations',
      label: 'Marcadores, Separadores y Anotaciones',
      icon: <Bookmark size={19} />,
    },
    {
      id: 'shared',
      label: 'Compartir Libros y Sync',
      icon: <Users size={19} />,
      badge: sharedTotalCount > 99 ? '99+' : sharedTotalCount || undefined,
    },
    { id: 'favorites', label: 'Favoritos', icon: <Star size={19} /> },
    { id: 'wishlist', label: 'Por leer', icon: <BookMarked size={19} /> },
    {
      id: 'reading',
      label: 'Lecturas terminadas',
      icon: <BookCheck size={19} />,
      badge: completedCount > 99 ? '99+' : completedCount || undefined,
    },
    {
      id: 'audiobooks',
      label: 'Audiolibros',
      icon: <Headphones size={19} />,
      badge: audiobooksCount > 99 ? '99+' : audiobooksCount || undefined,
    },
  ];

  const handleOpenStudio = () => {
    setStudioModalOpen(true);
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
