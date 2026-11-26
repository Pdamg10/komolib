import React from 'react';
import {
  BarChart3,
  BookCheck,
  Bookmark,
  BookMarked,
  ClipboardList,
  Headphones,
  Layers,
  LayoutGrid,
  Palette,
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
    sharedRooms,
    theme,
    setStudioModalOpen,
  } = useLibrary();

  const activeRoomsCount = sharedRooms.length;

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
      badge: activeRoomsCount > 99 ? '99+' : activeRoomsCount || undefined,
    },
    { id: 'favorites', label: 'Favoritos', icon: <Star size={19} /> },
    { id: 'wishlist', label: 'Por leer', icon: <BookMarked size={19} /> },
    {
      id: 'reading',
      label: 'Lecturas terminadas',
      icon: <BookCheck size={19} />,
    },
    {
      id: 'manga',
      label: 'Mangas, Manhwas y Cómics',
      icon: <Layers size={19} />,
    },
    {
      id: 'audiobooks',
      label: 'Audiolibros',
      icon: <Headphones size={19} />,
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
