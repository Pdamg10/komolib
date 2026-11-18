import React from 'react';

export const CategoryBookIcon: React.FC<{ icon: string; color: string; accent: string }> = ({
  icon,
  color,
  accent,
}) => {
  if (icon === 'stack') {
    return (
      <svg width="34" height="34" viewBox="0 0 36 36" fill="none">
        <rect x="6" y="25" width="24" height="6" rx="3" fill="#e86f68" />
        <rect x="8" y="27" width="18" height="2" rx="1" fill="#fdfbf8" opacity="0.9" />
        <rect x="7" y="18" width="22" height="6" rx="3" fill="#4c6c8a" />
        <rect x="9" y="20" width="16" height="2" rx="1" fill="#fdfbf8" opacity="0.9" />
        <rect x="6" y="11" width="24" height="6" rx="3" fill="#5da678" />
        <rect x="8" y="13" width="17" height="2" rx="1" fill="#fdfbf8" opacity="0.9" />
        <rect x="8" y="5" width="20" height="5.5" rx="2.7" fill="#e86f68" />
        <path d="M23 10.5v5l-2-1.5-2 1.5v-5z" fill="#f5c058" />
      </svg>
    );
  }

  if (icon === 'tablet') {
    return (
      <svg width="34" height="34" viewBox="0 0 36 36" fill="none">
        <rect x="7" y="4" width="22" height="28" rx="4" fill="#587085" />
        <rect x="9.5" y="6.5" width="17" height="21" rx="2" fill="#fcfaf5" />
        <path d="M12.5 11h11M12.5 15h11M12.5 19h8M12.5 23h9" stroke="#b9b0a6" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="18" cy="29.8" r="1.2" fill="#f3ede4" />
      </svg>
    );
  }

  return (
    <svg width="34" height="34" viewBox="0 0 36 36" fill="none">
      {/* Book body */}
      <rect x="7" y="4" width="22" height="26" rx="4.5" fill={color} />
      {/* Spine highlight */}
      <rect x="7" y="4" width="4" height="26" rx="2" fill="rgba(0,0,0,0.14)" />
      {/* Bottom white pages */}
      <rect x="10" y="26.5" width="19" height="4" rx="2" fill="#fdfbf8" />
      {/* Bookmark ribbon */}
      <path d="M22 29h4v5l-2-1.4-2 1.4v-5z" fill="#f5be58" />

      {/* Inner Emblem */}
      {icon === 'new' && (
        <text
          x="19"
          y="18"
          textAnchor="middle"
          fill="#ffffff"
          fontSize="7"
          fontWeight="800"
          fontFamily="Quicksand, sans-serif"
        >
          NEW
        </text>
      )}
      {icon === 'manga' && (
        <>
          <circle cx="19" cy="15.5" r="5.5" fill={accent} />
          <circle cx="15" cy="11.5" r="2.2" fill={accent} />
          <circle cx="23" cy="11.5" r="2.2" fill={accent} />
          <circle cx="17.4" cy="15" r="0.9" fill="#3b3532" />
          <circle cx="20.6" cy="15" r="0.9" fill="#3b3532" />
        </>
      )}
      {icon === 'manhwa' && (
        <>
          <rect x="14" y="9" width="10" height="4" rx="1.5" fill="#fff" opacity="0.92" />
          <rect x="14" y="14.5" width="10" height="4" rx="1.5" fill={accent} />
          <rect x="14" y="20" width="10" height="4" rx="1.5" fill="#fff" opacity="0.78" />
        </>
      )}
      {icon === 'comic' && (
        <path
          d="M19 9.5l1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z"
          fill={accent}
        />
      )}
      {icon === 'audio' && (
        <path d="M16.5 11.5l7 4.5-7 4.5z" fill={accent} />
      )}
      {icon === 'ufo' && (
        <>
          <ellipse cx="19" cy="16.5" rx="6.5" ry="2.8" fill={accent} />
          <path d="M15.5 15.5a3.5 3.5 0 0 1 7 0" fill="#fff" opacity="0.9" />
        </>
      )}
      {icon === 'heart' && (
        <path
          d="M19 20.5s-5-3.1-5-6.2a2.9 2.9 0 0 1 5-1.9 2.9 2.9 0 0 1 5 1.9c0 3.1-5 6.2-5 6.2z"
          fill={accent}
        />
      )}
      {icon === 'sparkle' && (
        <path d="M19 9.5l2.2 4.3 4.3 2.2-4.3 2.2-2.2 4.3-2.2-4.3-4.3-2.2 4.3-2.2z" fill={accent} />
      )}
      {icon === 'mystery' && (
        <>
          <circle cx="18" cy="14.5" r="4" stroke={accent} strokeWidth="2.2" />
          <path d="M21 17.5l3 3" stroke={accent} strokeWidth="2.2" strokeLinecap="round" />
        </>
      )}
      {![
        'new',
        'manga',
        'manhwa',
        'comic',
        'audio',
        'ufo',
        'heart',
        'sparkle',
        'mystery',
      ].includes(icon) && <circle cx="19" cy="15.5" r="4.5" fill={accent} />}
    </svg>
  );
};

export const BookStackIllustration: React.FC = () => (
  <svg width="138" height="150" viewBox="0 0 150 162" fill="none" className="banner-stack-illustration">
    {/* Book 1 top red */}
    <rect x="16" y="8" width="114" height="22" rx="7" fill="#e66465" />
    <rect x="26" y="12" width="94" height="14" rx="4" fill="#e66465" />
    <rect x="24" y="13" width="6" height="12" rx="2" fill="#c94b4d" />
    <rect x="114" y="13" width="6" height="12" rx="2" fill="#c94b4d" />

    {/* Book 2 slate blue with open white pages */}
    <rect x="22" y="30" width="108" height="26" rx="8" fill="#466886" />
    <rect x="30" y="36" width="96" height="14" rx="5" fill="#fffdf9" />
    <path d="M100 36h13v27l-6.5-5-6.5 5V36z" fill="#f2bc5a" />

    {/* Book 3 purple */}
    <rect x="20" y="56" width="106" height="24" rx="7" fill="#8979be" />
    <rect x="32" y="61" width="76" height="14" rx="3" fill="#7767ad" />
    <rect x="112" y="61" width="5" height="14" rx="2" fill="#6b5c9e" />

    {/* Book 4 green */}
    <rect x="14" y="80" width="118" height="22" rx="7" fill="#5da672" />
    <rect x="24" y="85" width="94" height="12" rx="3" fill="#4f9463" />

    {/* Book 5 coral with pages */}
    <rect x="20" y="102" width="110" height="26" rx="8" fill="#e46664" />
    <rect x="28" y="108" width="98" height="14" rx="5" fill="#fffdf9" />
    <path d="M40 108h13v25l-6.5-4.8L40 133v-25z" fill="#f3be5a" />

    {/* Book 6 purple + bottom green */}
    <rect x="18" y="128" width="112" height="18" rx="6" fill="#8878be" />
    <rect x="14" y="146" width="118" height="14" rx="5" fill="#5ca470" />
  </svg>
);

export const CollectionMiniIcon: React.FC<{ icon: string }> = ({ icon }) => {
  if (icon === 'classic') {
    return (
      <svg width="36" height="36" viewBox="0 0 38 38" fill="none">
        <rect width="38" height="38" rx="11" fill="var(--banner-bg)" />
        <rect x="9" y="9" width="14" height="4" rx="2" fill="#d9cfc2" />
        <rect x="11" y="13" width="10" height="14" rx="1.5" fill="#e5ddd2" />
        <rect x="9" y="27" width="14" height="3.5" rx="1.7" fill="#d4c9ba" />
        <path d="M23 28l7-14c-3-1-6 1-7 4l-2 10z" fill="#f1ba5a" />
      </svg>
    );
  }
  if (icon === 'ufo') {
    return (
      <svg width="36" height="36" viewBox="0 0 38 38" fill="none">
        <rect width="38" height="38" rx="11" fill="var(--banner-bg)" />
        <ellipse cx="19" cy="21" rx="11" ry="5" fill="#7c6cc4" />
        <path d="M13 19.5a6 6 0 0 1 12 0z" fill="#f5c65d" />
        <circle cx="14" cy="21" r="1.4" fill="#fff" />
        <circle cx="19" cy="22" r="1.4" fill="#fff" />
        <circle cx="24" cy="21" r="1.4" fill="#fff" />
      </svg>
    );
  }
  return (
    <svg width="36" height="36" viewBox="0 0 38 38" fill="none">
      <rect width="38" height="38" rx="11" fill="var(--banner-bg)" />
      <rect x="9" y="18" width="10" height="11" rx="2.5" fill="#e86f68" />
      <rect x="19" y="18" width="10" height="11" rx="2.5" fill="#4c6c8a" />
      <rect x="13" y="9" width="11" height="9" rx="2.5" fill="#5da672" />
      <circle cx="18.5" cy="13.5" r="2" fill="#f5c65d" />
    </svg>
  );
};
