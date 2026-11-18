import React from 'react';
import { Plus } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import { CategoryBookIcon } from './CategoryIcons';

export const CategoryStrip: React.FC = () => {
  const {
    categories,
    activeCategory,
    setActiveCategory,
    setStudioModalOpen,
    theme,
  } = useLibrary();

  if (!theme.showCategories) return null;

  return (
    <section className="category-strip" aria-label="Categorías">
      {categories.map((cat) => (
        <button
          key={cat.id}
          className={`category-chip ${activeCategory === cat.id ? 'active' : ''}`}
          onClick={() => setActiveCategory(cat.id)}
        >
          <CategoryBookIcon icon={cat.icon} color={cat.color} accent={cat.accent} />
          <span className="category-label">{cat.label}</span>
        </button>
      ))}

      <button
        className="category-chip"
        onClick={() => setStudioModalOpen(true)}
        title="Crear o personalizar categorías y apariencia"
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 11,
            border: '2px dashed var(--text-muted)',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--text-muted)',
          }}
        >
          <Plus size={16} />
        </div>
        <span className="category-label">Personalizar</span>
      </button>
    </section>
  );
};
