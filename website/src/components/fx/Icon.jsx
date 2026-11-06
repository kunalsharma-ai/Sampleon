import {
  ArrowUpRight,
  BadgeCheck,
  CalendarClock,
  Circle,
  X,
  CircleCheck,
  CircleCheckBig,
  CircleMinus,
  Fingerprint,
  Gauge,
  GitFork,
  Inbox,
  KeyRound,
  LayoutGrid,
  Lock,
  LockKeyhole,
  Mail,
  Menu,
  MessageCircleQuestion,
  Play,
  Rocket,
  ScrollText,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserCheck,
} from 'lucide-react';

// Only the icons listed here are bundled. To use a new one, import it above and add it to ICONS.
// Browse names at https://lucide.dev/icons
const ICONS = {
  ArrowUpRight, BadgeCheck, CalendarClock, CircleCheck, CircleCheckBig, CircleMinus, Fingerprint, Gauge, GitFork, Inbox, KeyRound, LayoutGrid, Lock, LockKeyhole, Mail, Menu, MessageCircleQuestion, Play, Rocket, ScrollText, Send, ShieldCheck, SlidersHorizontal, Sparkles, UserCheck, X,
};

export default function Icon({ name, size = 22, ...rest }) {
  const C = ICONS[name] || Circle;
  return <C size={size} strokeWidth={1.8} aria-hidden="true" {...rest} />;
}
