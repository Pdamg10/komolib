import React, { useEffect, useRef, useState } from 'react';
import { FastForward, Pause, Play, Rewind, X } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import { BookCoverVisual } from './BookCoverVisual';

function fmtTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const AudioPlayerBar: React.FC = () => {
  const { audioBook, audioUrl, closeAudioPlayer, updateBook } = useLibrary();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(true);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !audioBook || !audioUrl) return;
    el.currentTime = audioBook.audioTime || 0;
    el.playbackRate = rate;
    el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, [audioBook?.id, audioUrl]);

  if (!audioBook || !audioUrl) return null;

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().then(() => setPlaying(true)).catch(() => undefined);
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  const skip = (delta: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(duration || 0, el.currentTime + delta));
  };

  const cycleRate = () => {
    const rates = [0.75, 1, 1.25, 1.5, 2];
    const next = rates[(rates.indexOf(rate) + 1) % rates.length];
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  return (
    <div className="audio-bar">
      <div style={{ width: 46, height: 60, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
        <BookCoverVisual book={audioBook} compact />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 800,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {audioBook.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)' }}>
            {fmtTime(current)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 1}
            value={current}
            onChange={(e) => {
              const t = Number(e.target.value);
              if (audioRef.current) audioRef.current.currentTime = t;
              setCurrent(t);
            }}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)' }}>
            {fmtTime(duration)}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button className="circle-arrow-btn" onClick={() => skip(-15)} title="-15s">
          <Rewind size={14} />
        </button>
        <button
          className="circle-arrow-btn"
          style={{
            background: 'var(--accent-primary)',
            color: 'var(--accent-contrast)',
            borderColor: 'transparent',
            width: 38,
            height: 38,
          }}
          onClick={togglePlay}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button className="circle-arrow-btn" onClick={() => skip(15)} title="+15s">
          <FastForward size={14} />
        </button>
        <button className="pill-btn" style={{ padding: '0 10px' }} onClick={cycleRate}>
          {rate}x
        </button>
        <button className="circle-arrow-btn" onClick={closeAudioPlayer} title="Cerrar reproductor">
          <X size={15} />
        </button>
      </div>

      <audio
        ref={audioRef}
        src={audioUrl}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          const d = e.currentTarget.duration || 1;
          setCurrent(t);
          if (Math.floor(t) % 5 === 0) {
            updateBook(audioBook.id, {
              audioTime: t,
              durationSec: d,
              progress: Math.round((t / d) * 100),
            });
          }
        }}
      />
    </div>
  );
};
