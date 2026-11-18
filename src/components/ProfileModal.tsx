import React, { useRef } from 'react';
import { BookOpen, Flame, Star, Upload, X } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';

const EMOJIS = ['🦊', '🐱', '🦉', '🐻', '🌸', '📚', '✨', '🧙', '🎧', '🐉'];

export const ProfileModal: React.FC = () => {
  const { profileModalOpen, setProfileModalOpen, profile, updateProfile, books, bookmarks, notes } =
    useLibrary();
  const imgRef = useRef<HTMLInputElement>(null);

  if (!profileModalOpen) return null;

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => updateProfile({ avatarImageUrl: String(reader.result || '') });
    reader.readAsDataURL(file);
  };

  const completed = books.filter((b) => b.progress >= 98).length;
  const favorites = books.filter((b) => b.favorite).length;

  return (
    <div className="modal-overlay" onClick={() => setProfileModalOpen(false)}>
      <div className="modal-card" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Tu Perfil de Lector</h3>
          <button className="circle-arrow-btn" onClick={() => setProfileModalOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            className="avatar-btn"
            style={{ width: 64, height: 64, fontSize: 30, background: profile.avatarBg }}
          >
            {profile.avatarImageUrl ? (
              <img src={profile.avatarImageUrl} alt={profile.name} />
            ) : (
              <span>{profile.avatarEmoji}</span>
            )}
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              className="studio-input"
              value={profile.name}
              onChange={(e) => updateProfile({ name: e.target.value })}
              placeholder="Tu nombre"
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="pill-btn" onClick={() => imgRef.current?.click()}>
                <Upload size={12} /> Subir foto
              </button>
              {profile.avatarImageUrl && (
                <button
                  className="pill-btn"
                  onClick={() => updateProfile({ avatarImageUrl: undefined })}
                >
                  Usar emoji
                </button>
              )}
              <input ref={imgRef} type="file" accept="image/*" hidden onChange={handleAvatarUpload} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {EMOJIS.map((em) => (
            <button
              key={em}
              className="circle-arrow-btn"
              style={{
                fontSize: 18,
                background:
                  !profile.avatarImageUrl && profile.avatarEmoji === em
                    ? 'var(--accent-secondary)'
                    : 'var(--banner-bg)',
              }}
              onClick={() => updateProfile({ avatarEmoji: em, avatarImageUrl: undefined })}
            >
              {em}
            </button>
          ))}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 10,
            background: 'var(--banner-bg)',
            padding: 12,
            borderRadius: 16,
            textAlign: 'center',
          }}
        >
          <div>
            <BookOpen size={16} style={{ color: 'var(--accent-primary)' }} />
            <div style={{ fontSize: 18, fontWeight: 800 }}>{books.length}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Títulos</div>
          </div>
          <div>
            <Star size={16} style={{ color: '#f2ba59' }} />
            <div style={{ fontSize: 18, fontWeight: 800 }}>{favorites}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Favoritos</div>
          </div>
          <div>
            <Flame size={16} style={{ color: 'var(--accent-secondary)' }} />
            <div style={{ fontSize: 18, fontWeight: 800 }}>
              {completed + bookmarks.length + notes.length}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Actividad</div>
          </div>
        </div>
      </div>
    </div>
  );
};
