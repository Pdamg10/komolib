import React from 'react';
import {
  BarChart3,
  Bookmark,
  ClipboardList,
  Heart,
  LayoutGrid,
  Palette,
  Play,
  Star,
  Users,
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
    sharedRooms,
    sharedShelves,
    theme,
    setStudioModalOpen,
  } = useLibrary();

  const readingCount = books.filter((b) => b.progress > 0 && b.progress < 100).length;
  const sharedTotalCount = sharedRooms.length + sharedShelves.length;

  const navItems: Array<{
    id: NavSection;
    label: string;
    icon: React.ReactNode;
    badge?: number | string;
  }> = [
    { id: 'home', label: 'Biblioteca', icon: <LayoutGrid size={19} /> },
    { id: 'dashboard', label: 'Dashboard y Estadísticas', icon: <BarChart3 size={19} /> },
    { id: 'reading-log', label: 'Reading Log y Reseñas', icon: <ClipboardList size={19} /> },
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
    { id: 'wishlist', label: 'Wishlist / Por leer', icon: <Heart size={19} /> },
    {
      id: 'reading',
      label: 'Leyendo y Audio',
      icon: <Play size={19} />,
      badge: readingCount > 99 ? '99+' : readingCount || undefined,
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
