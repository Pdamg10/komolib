import React from 'react';
import { Eye } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import { BookStackIllustration, CollectionMiniIcon } from './CategoryIcons';

export const FeaturedBanner: React.FC = () => {
  const {
    theme,
    collections,
    setActiveCategory,
    setNavSection,
    updateTheme,
    setImportModalOpen,
  } = useLibrary();

  if (!theme.showBanner) return null;

  return (
    <section className="featured-banner" aria-label="Colecciones destacadas">
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <BookStackIllustration />
      </div>

      <div className="banner-copy">
        <h3>{theme.bannerTitle}</h3>
        <p>{theme.bannerSubtitle}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <button
            className="coral-cta-btn"
            onClick={() => {
              setNavSection('home');
              setActiveCategory('all');
              updateTheme({ viewMode: 'grid' });
            }}
          >
            <Eye size={15} /> ver todo
          </button>
          <button
            className="pill-btn"
            style={{ height: 38, padding: '0 16px', background: 'var(--card-bg)' }}
            onClick={() => setImportModalOpen(true)}
          >
            + Subir libro / manga
          </button>
        </div>
      </div>

      <div className="collection-stack">
        {collections.map((col) => (
          <button
            key={col.id}
            className="collection-mini-card"
            onClick={() => {
              setNavSection('home');
              if (col.filterCategory) setActiveCategory(col.filterCategory);
            }}
          >
            <CollectionMiniIcon icon={col.icon} />
            <div style={{ minWidth: 0 }}>
              <h4>{col.title}</h4>
              <p>{col.subtitle}</p>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
};
