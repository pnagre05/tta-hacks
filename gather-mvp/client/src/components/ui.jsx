// Small visual building blocks shared by every page.
import { useEffect, useState } from 'react';

const AVATAR_COLORS = ['#ffe27a', '#ffb3d1', '#cdb9ff', '#b5ecc9', '#b3dcff', '#ffc9a3'];

function hash(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

// A coloured circle with the person's initial. The colour is always the same for the same name.
export function Avatar({ name = '?', size = 32 }) {
  return (
    <span
      className="av"
      title={name}
      style={{ width: size, height: size, fontSize: size * 0.42, background: AVATAR_COLORS[hash(name) % AVATAR_COLORS.length] }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function AvatarStack({ names = [], size = 28, max = 6 }) {
  const shown = names.slice(0, max);
  return (
    <span className="av-stack">
      {shown.map((n) => <Avatar key={n} name={n} size={size} />)}
      {names.length > max && <span className="av more" style={{ width: size, height: size, fontSize: size * 0.36 }}>+{names.length - max}</span>}
    </span>
  );
}

// A scalloped "sticker" shape with content in the middle.
export function Sticker({ color = '#ffe27a', size = 76, tilt = -8, children }) {
  const petals = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    return <circle key={i} cx={50 + Math.cos(a) * 34} cy={50 + Math.sin(a) * 34} r="15" />;
  });
  return (
    <span className="sticker" style={{ width: size, height: size, transform: `rotate(${tilt}deg)` }}>
      <svg viewBox="0 0 100 100" fill={color} aria-hidden="true">
        {petals}
        <circle cx="50" cy="50" r="36" />
      </svg>
      <span className="sticker-text">{children}</span>
    </span>
  );
}

const CONFETTI_COLORS = ['#ffe27a', '#ffb3d1', '#cdb9ff', '#b5ecc9', '#b3dcff', '#ff4f9a'];

// A one-second burst, used when a plan gets confirmed.
export function Confetti({ fire }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!fire) return undefined;
    setOn(true);
    const t = setTimeout(() => setOn(false), 1300);
    return () => clearTimeout(t);
  }, [fire]);
  if (!on) return null;
  return (
    <span className="confetti" aria-hidden="true">
      {Array.from({ length: 22 }, (_, i) => {
        const angle = (i / 22) * Math.PI * 2;
        const dist = 70 + (hash(`c${i}`) % 70);
        return (
          <i
            key={i}
            style={{
              background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
              '--dx': `${Math.cos(angle) * dist}px`,
              '--dy': `${Math.sin(angle) * dist - 30}px`,
              '--rot': `${(hash(`r${i}`) % 360) - 180}deg`,
              borderRadius: i % 3 === 0 ? '50%' : '3px',
            }}
          />
        );
      })}
    </span>
  );
}

const ICONS = {
  home: <path d="M3.5 11 12 4l8.5 7v7.5a2 2 0 0 1-2 2H15v-6H9v6H5.500a2 2 0 0 1-2-2z" />,
  schedule: <><rect x="3.500" y="5" width="17" height="15.500" rx="4" /><path d="M3.500 10.500h17M8 3v4M16 3v4" /></>,
  ideas: <path d="m12 3.500 2.500 5.300 5.800.800-4.200 4.100 1 5.800-5.100-2.800-5.100 2.800 1-5.800-4.200-4.100 5.800-.800z" />,
  polls: <path d="M6 20v-8M12 20V4.500M18 20v-5.500" />,
  money: <><circle cx="12" cy="12" r="8.500" /><path d="M14.300 9.600c-.300-.900-1.200-1.400-2.300-1.400-1.400 0-2.300.700-2.300 1.800 0 2.400 4.700 1.200 4.700 3.800 0 1.100-1 1.900-2.400 1.900-1.200 0-2.100-.600-2.400-1.500M12 6.700v1.500M12 15.700v1.600" /></>,
  ai: <><path d="M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v6.500a3 3 0 0 1-3 3h-4.500L8 20.500v-4H7a3 3 0 0 1-3-3z" /><path d="M9 10.200h.010M12 10.200h.010M15 10.200h.010" /></>,
};

export function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.200" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

export const CATEGORY_STYLE = {
  restaurants: ['🍜', 'c-butter'],
  outdoor: ['🌿', 'c-mint'],
  entertainment: ['🎳', 'c-lilac'],
  at_home: ['🛋️', 'c-pink'],
  travel: ['🚗', 'c-sky'],
  events: ['🎟️', 'c-peach'],
  other: ['✨', 'c-white'],
};
