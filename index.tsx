import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type, LiveServerMessage, Modality } from "@google/genai";
import { auth, db, googleProvider } from './firebase';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  User,
  GoogleAuthProvider,
  signInWithCredential,
  getAdditionalUserInfo,
  deleteUser,
  verifyBeforeUpdateEmail,
  updatePassword
} from "firebase/auth";
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App as CapacitorApp } from '@capacitor/app';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { PushNotifications } from '@capacitor/push-notifications';
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  collectionGroup,
  orderBy,
  writeBatch,
  arrayUnion,
  arrayRemove
} from "firebase/firestore";
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import './index.css';

// --- Config ---
const TMDB_API_KEY = process.env.TMDB_API_KEY || '86eda413b6a6563e449850347d1d7927';
const MODELS = {
  TEXT: 'gemini-2.5-flash',
  VISION: 'gemini-2.5-flash',
  LIVE: 'gemini-2.0-flash-exp'
};

// --- Types ---
interface Movie {
  id?: string; // Firestore Document ID
  title: string;
  description: string;
  trailer: string;
  cast: string;
  director: string;
  genre: string;
  language: string;
  rating: number;
  release_year: number;
  poster: string;
  country?: string;
  status: 'list' | 'watching' | 'watched' | 'favorite';
  media_type: 'movie' | 'tv';
  seasons?: number;
  episodes?: number;
  added_at: string;
  tmdb_id?: number;
  watch_providers?: string; // JSON string of flatrate watch providers
  userRating?: number;
  userNote?: string;
}

type Theme = 'dark' | 'light';

// --- Utils ---
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const encodePCM = (data: Float32Array) => {
  const int16 = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    int16[i] = Math.floor(s < 0 ? s * 32768 : s * 32767);
  }
  return encode(new Uint8Array(int16.buffer));
};

const sanitizePayload = (obj: any) => {
  const clean: any = {};
  Object.keys(obj).forEach(key => {
    const val = obj[key];
    if (val === undefined || val === null || Number.isNaN(val) || val === 'undefined' || val === 'null') {
      return;
    }
    clean[key] = val;
  });
  return clean;
};

const getPosterUrl = (posterPath: string | null, width = 300) => {
  if (posterPath) {
    if (posterPath.startsWith('http')) return posterPath;
    return `https://image.tmdb.org/t/p/w${width}${posterPath}`;
  }
  return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.floor(width * 1.5)}" viewBox="0 0 100 150"><rect width="100" height="150" fill="%2318181b"/><text x="50" y="75" font-family="system-ui" font-size="8" fill="%234f46e5" text-anchor="middle" font-weight="bold">NO IMAGE</text></svg>`;
};

// --- Components ---

const WelcomeScreen = ({ onClose }: { onClose: () => void }) => {
  const [step, setStep] = useState(1);
  return (
    <div className="fixed inset-0 z-[1000] flex flex-col bg-zinc-950 text-white animate-in fade-in duration-300">
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        {step === 1 && (
          <div className="animate-in slide-in-from-right-8 duration-500 max-w-sm">
            <div className="text-6xl mb-6">🍿</div>
            <h2 className="text-2xl font-black mb-4">Save for Later</h2>
            <p className="text-zinc-400 font-bold leading-relaxed text-sm">
              You see a movie and want to watch later, you can save in your vault.
            </p>
          </div>
        )}
        {step === 2 && (
          <div className="animate-in slide-in-from-right-8 duration-500 max-w-sm">
            <div className="text-6xl mb-6">🤝</div>
            <h2 className="text-2xl font-black mb-4">Share with Friends</h2>
            <p className="text-zinc-400 font-bold leading-relaxed text-sm">
              Recommend movies to your friends and get recommendations.
            </p>
          </div>
        )}
        {step === 3 && (
          <div className="animate-in slide-in-from-right-8 duration-500 max-w-sm">
            <div className="text-6xl mb-6">👀</div>
            <h2 className="text-2xl font-black mb-4">See What's Trending</h2>
            <p className="text-zinc-400 font-bold leading-relaxed text-sm">
              Share what you're watching and see what your friends are watching.
            </p>
          </div>
        )}
      </div>
      <div className="p-8 pb-12 flex flex-col gap-4">
        <button
          onClick={() => {
            if (step < 3) setStep(step + 1);
            else onClose();
          }}
          className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 rounded-2xl font-black uppercase tracking-widest text-sm shadow-xl shadow-indigo-600/20 transition-all active:scale-95"
        >
          {step < 3 ? 'Next' : 'Enter Vault'}
        </button>
      </div>
    </div>
  );
};
const DeleteAccountModal = ({ onClose, onDelete, theme }: { onClose: () => void, onDelete: (reason: string) => Promise<void>, theme: Theme }) => {
  const [step, setStep] = useState(1);
  const [reasons, setReasons] = useState<string[]>([]);
  const [otherReason, setOtherReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const glassClass = theme === 'dark' ? 'glass-dark border-white/10' : 'bg-white border-slate-200 shadow-2xl';
  const textClass = theme === 'dark' ? 'text-white' : 'text-slate-900';
  const labelClass = theme === 'dark' ? 'text-zinc-400' : 'text-slate-500';

  const REASON_OPTIONS = [
    "I'm not using the app anymore",
    "It's too complicated",
    "I found a better alternative",
    "Privacy concerns",
    "Other"
  ];

  const handleNext = () => {
    if (reasons.length === 0) {
      alert("Please select at least one reason.");
      return;
    }
    if (reasons.includes("Other") && !otherReason.trim()) {
      alert("Please specify your reason.");
      return;
    }
    setStep(2);
  };

  const handleDelete = async () => {
    if (confirmText !== 'DELETE') return;
    setIsDeleting(true);
    let finalReason = reasons.filter(r => r !== 'Other').join(', ');
    if (reasons.includes('Other')) {
      finalReason += (finalReason ? ', ' : '') + otherReason.trim();
    }
    await onDelete(finalReason);
    setIsDeleting(false);
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" onClick={onClose}></div>
      <div className={`relative ${glassClass} rounded-[32px] w-full max-w-md p-8 animate-in zoom-in-95 duration-200`}>
        {step === 1 ? (
          <div className="space-y-6">
            <div>
              <h2 className={`text-2xl font-black uppercase tracking-tight text-rose-500 mb-2`}>Delete Account</h2>
              <p className={`text-sm font-semibold ${labelClass}`}>We're sorry to see you go. Why are you leaving?</p>
            </div>

            <div className="space-y-3">
              {REASON_OPTIONS.map(opt => (
                <label key={opt} className="flex items-center gap-3 cursor-pointer group">
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${reasons.includes(opt) ? 'bg-rose-500 border-rose-500' : `${theme === 'dark' ? 'border-zinc-700 group-hover:border-zinc-500' : 'border-slate-300 group-hover:border-slate-400'}`}`}>
                    {reasons.includes(opt) && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                  </div>
                  <input type="checkbox" className="hidden" checked={reasons.includes(opt)} onChange={(e) => {
                    if (e.target.checked) setReasons(prev => [...prev, opt]);
                    else setReasons(prev => prev.filter(r => r !== opt));
                  }} />
                  <span className={`text-sm font-bold ${textClass}`}>{opt}</span>
                </label>
              ))}

              {reasons.includes("Other") && (
                <textarea
                  placeholder="Please tell us more..."
                  value={otherReason}
                  onChange={e => setOtherReason(e.target.value)}
                  className={`w-full p-3 rounded-xl border ${theme === 'dark' ? 'bg-black/50 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'} text-sm outline-none focus:border-rose-500 transition-colors mt-2 h-20 resize-none`}
                />
              )}
            </div>

            <div className="flex gap-3 pt-4 border-t border-white/5">
              <button onClick={onClose} className={`flex-1 py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-colors ${theme === 'dark' ? 'hover:bg-white/5 text-zinc-400' : 'hover:bg-slate-100 text-slate-500'}`}>Cancel</button>
              <button onClick={handleNext} className="flex-1 py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-black uppercase tracking-widest text-xs shadow-lg transition-colors">Next</button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <h2 className={`text-2xl font-black uppercase tracking-tight text-rose-500 mb-2`}>Are you sure?</h2>
              <p className={`text-sm font-bold ${labelClass} leading-relaxed`}>
                This action <strong className="text-rose-500">cannot be undone</strong>. All your vault data, recommendations, and friends will be permanently deleted.
              </p>
            </div>

            <div className="space-y-2">
              <label className={`text-xs font-black uppercase tracking-widest ${labelClass}`}>Type <span className="text-rose-500">DELETE</span> to confirm</label>
              <input
                type="text"
                value={confirmText}
                onChange={e => setConfirmText(e.target.value.toUpperCase())}
                className={`w-full px-4 py-3 rounded-xl border ${theme === 'dark' ? 'bg-black/50 border-rose-500/30 text-white' : 'bg-rose-50 border-rose-200 text-slate-900'} text-center font-black tracking-widest outline-none focus:border-rose-500 transition-colors`}
                placeholder="DELETE"
              />
            </div>

            <div className="flex gap-3 pt-4 border-t border-white/5">
              <button onClick={() => setStep(1)} disabled={isDeleting} className={`flex-1 py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-colors ${theme === 'dark' ? 'hover:bg-white/5 text-zinc-400' : 'hover:bg-slate-100 text-slate-500'}`}>Back</button>
              <button
                onClick={handleDelete}
                disabled={confirmText !== 'DELETE' || isDeleting}
                className="flex-1 py-3 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 disabled:bg-rose-600/50 text-white rounded-xl font-black uppercase tracking-widest text-xs shadow-lg transition-colors"
              >
                {isDeleting ? 'Deleting...' : 'Delete Forever'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Toast = ({ message, onClose }: { message: string, onClose: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[500] bg-indigo-600 text-white px-6 py-3 rounded-2xl shadow-2xl font-bold animate-in slide-in-from-bottom-5 fade-in duration-300 flex items-center gap-3 border border-white/20">
      <div className="w-2 h-2 rounded-full bg-white animate-pulse"></div>
      {message}
    </div>
  );
};

const MovieActionMenu = ({
  movie,
  existingGenres,
  onUpdateStatus,
  onUpdateGenre,
  onDelete,
  onClose,
  onShareWatching,
  onAddToRecommended,
  onReport,
  theme
}: {
  movie: Movie,
  existingGenres: string[],
  onUpdateStatus: (s: Movie['status']) => void,
  onUpdateGenre: (g: string) => void,
  onDelete: () => void,
  onClose: () => void,
  onShareWatching?: () => void,
  onAddToRecommended?: () => void,
  onReport?: () => void,
  theme: Theme
}) => {
  const [view, setView] = useState<'main' | 'category' | 'genre'>('main');
  const [customGenre, setCustomGenre] = useState('');
  const glassClass = theme === 'dark' ? 'glass-dark' : 'bg-white border border-slate-200 shadow-2xl backdrop-blur-xl';

  return (
    <div className="absolute top-10 left-8 z-50">
      <div className="fixed inset-0 cursor-default" onClick={onClose}></div>
      <div className={`relative ${glassClass} rounded-2xl ${theme === 'dark' ? 'border-white/10 shadow-2xl' : ''} w-56 sm:w-60 overflow-hidden animate-in zoom-in-95 duration-200 origin-top-left`}>
        {view === 'main' && (
          <div className="flex flex-col p-2">
            <button onClick={() => setView('category')} className={`w-full px-4 py-3.5 text-left text-sm font-black uppercase tracking-wider ${theme === 'dark' ? 'hover:bg-white/5 text-zinc-200' : 'hover:bg-indigo-50 text-slate-800 hover:text-indigo-600'} rounded-xl flex justify-between items-center transition-colors`}>
              Category <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
            </button>
            <button onClick={() => setView('genre')} className={`w-full px-4 py-3.5 text-left text-sm font-black uppercase tracking-wider ${theme === 'dark' ? 'hover:bg-white/5 text-zinc-200' : 'hover:bg-indigo-50 text-slate-800 hover:text-indigo-600'} rounded-xl flex justify-between items-center transition-colors`}>
              Genre <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
            </button>
            <div className={`h-px ${theme === 'dark' ? 'bg-white/10' : 'bg-slate-200'} my-1.5 mx-2`}></div>
            {onShareWatching && (
              <button onClick={() => { onShareWatching(); onClose(); }} className={`w-full px-4 py-3.5 text-left text-sm font-black uppercase tracking-wider ${theme === 'dark' ? 'hover:bg-amber-500/10 text-amber-400' : 'hover:bg-amber-50 text-amber-600'} rounded-xl flex items-center gap-2 transition-colors`}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" /></svg>
                Share as Watching
              </button>
            )}
            {onAddToRecommended && (
              <button onClick={() => { onAddToRecommended(); onClose(); }} className={`w-full px-4 py-3.5 text-left text-sm font-black uppercase tracking-wider ${theme === 'dark' ? 'hover:bg-indigo-500/10 text-indigo-400' : 'hover:bg-indigo-50 text-indigo-600'} rounded-xl flex items-center gap-2 transition-colors`}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                Add to Recommended
              </button>
            )}
            {onReport && (
              <button onClick={() => { onReport(); onClose(); }} className={`w-full px-4 py-3.5 text-left text-sm font-black uppercase tracking-wider ${theme === 'dark' ? 'hover:bg-rose-500/10 text-rose-400' : 'hover:bg-rose-50 text-rose-500'} rounded-xl flex items-center gap-2 transition-colors`}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                Report Content
              </button>
            )}
            <div className={`h-px ${theme === 'dark' ? 'bg-white/10' : 'bg-slate-200'} my-1.5 mx-2`}></div>
            <button onClick={() => { if (confirm(`Remove "${movie.title}" from collection?`)) onDelete(); }} className="w-full px-4 py-3.5 text-left text-sm font-black uppercase tracking-wider hover:bg-rose-500/20 text-rose-500 rounded-xl transition-colors">
              Delete
            </button>
          </div>
        )}

        {view === 'category' && (
          <div className="flex flex-col p-2">
            <button onClick={() => setView('main')} className="flex items-center gap-2 px-4 py-2 text-indigo-600 hover:text-indigo-500 transition-colors text-sm uppercase font-black mb-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
              Back
            </button>
            {([['list', 'To Watch'], ['watching', 'Watching'], ['watched', 'Watched'], ['favorite', 'Favorite']] as const).map(([s, label]) => (
              <button key={s} onClick={() => { onUpdateStatus(s); onClose(); }} className={`w-full px-4 py-3 text-left text-sm font-black uppercase tracking-wider rounded-xl transition-all ${movie.status === s ? 'bg-indigo-600/10 text-indigo-600' : `${theme === 'dark' ? 'hover:bg-white/5 text-zinc-300' : 'hover:bg-indigo-50 text-slate-800 hover:text-indigo-600'}`}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        {view === 'genre' && (
          <div className="flex flex-col p-2 max-h-72 overflow-y-auto no-scrollbar">
            <button onClick={() => setView('main')} className="flex items-center gap-2 px-4 py-2 text-indigo-600 hover:text-indigo-500 transition-colors text-sm uppercase font-black mb-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
              Back
            </button>
            <div className="space-y-1">
              {existingGenres.map(g => (
                <button key={g} onClick={() => { onUpdateGenre(g); onClose(); }} className={`w-full px-4 py-2.5 text-left text-sm font-bold uppercase tracking-wider rounded-xl transition-colors ${movie.genre === g ? 'bg-indigo-600/10 text-indigo-600' : `${theme === 'dark' ? 'hover:bg-white/5 text-zinc-300' : 'hover:bg-indigo-50 text-slate-800 hover:text-indigo-600'}`}`}>
                  {g}
                </button>
              ))}
            </div>
            <div className={`mt-3 p-2 ${theme === 'dark' ? 'bg-white/5' : 'bg-slate-50 border border-slate-200/60'} rounded-xl space-y-2`}>
              <input
                className={`w-full ${theme === 'dark' ? 'bg-black/40 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-800'} border rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-400`}
                placeholder="Custom..."
                value={customGenre}
                onChange={(e) => setCustomGenre(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customGenre.trim()) {
                    onUpdateGenre(customGenre.trim());
                    onClose();
                  }
                }}
              />
              <button
                onClick={() => { if (customGenre.trim()) { onUpdateGenre(customGenre.trim()); onClose(); } }}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-[9px] font-black uppercase tracking-wider transition-colors text-white"
              >
                Add Genre
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface GenreGroupProps {
  genre: string;
  movies: Movie[];
  existingGenres: string[];
  theme: Theme;
  onMovieClick: (m: Movie) => void;
  onUpdateStatus: (m: Movie, s: Movie['status']) => void | Promise<any>;
  onUpdateGenre: (m: Movie, g: string) => void | Promise<any>;
  onDelete: (m: Movie) => void | Promise<any>;
  onShareWatching?: (m: Movie) => void;
  onAddToRecommended?: (m: Movie) => void;
}

const GenreGroup: React.FC<GenreGroupProps> = ({
  genre,
  movies,
  existingGenres,
  theme,
  onMovieClick,
  onUpdateStatus,
  onUpdateGenre,
  onDelete,
  onShareWatching,
  onAddToRecommended
}) => {
  const [isOpen, setIsOpen] = useState(false); // Collapsed by default
  const [activeMenuId, setActiveMenuId] = useState<number | string | null>(null);

  return (
    <div className="space-y-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between py-2 border-b ${theme === 'dark' ? 'border-white/5' : 'border-zinc-200'} group`}
      >
        <div className="flex items-center gap-3">
          <span className={`text-sm font-black uppercase tracking-widest ${theme === 'dark' ? 'text-zinc-400' : 'text-slate-800'} group-hover:text-indigo-500 transition-colors`}>{genre}</span>
          <span className={`${theme === 'dark' ? 'bg-white/5 text-zinc-400' : 'bg-indigo-50 text-indigo-700 font-bold'} text-sm px-2 py-0.5 rounded-full`}>{movies.length}</span>
        </div>
        <svg className={`w-4 h-4 ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-500'} transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
      </button>

      {isOpen && (
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4 animate-in slide-in-from-top-2 duration-300">
          {movies.map(m => {
            const isMenuId = m.id || m.title;
            const isMenuOpen = activeMenuId === isMenuId;
            return (
              <div key={isMenuId} className={`group relative aspect-[2/3] transition-all duration-300 ${isMenuOpen ? 'z-50' : 'z-0 hover:z-20'}`}>
                <div
                  onClick={() => onMovieClick(m)}
                  className={`absolute inset-0 rounded-2xl overflow-hidden ring-1 ${theme === 'dark' ? 'ring-white/5 bg-zinc-900' : 'ring-zinc-200 bg-zinc-100'} group-hover:ring-indigo-500/50 transition-all shadow-xl cursor-pointer`}
                >
                  {m.poster ? (
                    <img src={m.poster} className="w-full h-full object-cover transition-transform group-hover:scale-110" loading="lazy" alt={m.title} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-zinc-800 text-zinc-600 text-sm uppercase font-black text-center p-4">No Poster</div>
                  )}

                  {(m.status === 'favorite') && (
                    <div className="absolute top-2 left-2 z-10 bg-yellow-500 text-black p-1 rounded-lg shadow-lg">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" /></svg>
                    </div>
                  )}

                  <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent p-3 flex flex-col justify-end pointer-events-none">
                    <h3 className="text-sm font-bold line-clamp-1 text-white group-hover:text-indigo-300 transition-colors">{m.title}</h3>
                    <div className="flex justify-between items-center mt-1">
                      <p className="text-[9px] text-yellow-500 font-bold">★ {m.rating?.toFixed(1) || '0.0'}</p>
                      {(m.status === 'watching') && (
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-black uppercase text-amber-500 tracking-tighter">Live</span>
                          <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.8)]"></span>
                        </div>
                      )}
                    </div>
                    {(m.userRating || m.userNote) && (
                      <div className="mt-1 pt-1 border-t border-white/20 flex flex-col gap-0.5">
                        {m.userRating && (
                          <div className="text-yellow-400 text-[8px] tracking-widest drop-shadow-md">
                            {'★'.repeat(m.userRating)}{'☆'.repeat(5 - m.userRating)}
                          </div>
                        )}
                        {m.userNote && (
                          <p className="text-white/90 text-[9px] font-semibold italic line-clamp-2">"{m.userNote}"</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  onClick={(e) => { e.stopPropagation(); setActiveMenuId(isMenuOpen ? null : isMenuId as number | string); }}
                  className={`absolute top-2 right-2 p-2.5 rounded-full transition-all backdrop-blur-md z-10 shadow-lg ${isMenuOpen ? 'bg-indigo-600 text-white scale-110' : 'bg-black/70 text-zinc-100 hover:bg-black/95'}`}
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" /></svg>
                </button>

                {isMenuOpen && (
                  <MovieActionMenu
                    movie={m}
                    theme={theme}
                    existingGenres={existingGenres}
                    onUpdateStatus={(s) => { onUpdateStatus(m, s); setActiveMenuId(null); }}
                    onUpdateGenre={(g) => { onUpdateGenre(m, g); setActiveMenuId(null); }}
                    onDelete={() => { onDelete(m); setActiveMenuId(null); }}
                    onClose={() => setActiveMenuId(null)}
                    onShareWatching={onShareWatching ? () => { onShareWatching(m); setActiveMenuId(null); } : undefined}
                    onAddToRecommended={onAddToRecommended ? () => { onAddToRecommended(m); setActiveMenuId(null); } : undefined}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const DetailModal = ({ movie, theme, isSaved, onClose, onUpdateStatus, onDelete, onUpdatePersonal, setConfirmModal }: { movie: Movie, theme: Theme, isSaved: boolean, onClose: () => void, onUpdateStatus: (s: Movie['status']) => void | Promise<any>, onDelete: () => void | Promise<any>, onUpdatePersonal?: (rating: number, note: string) => Promise<void>, setConfirmModal: any }) => {
  const trailerId = movie.trailer?.split('v=')[1];
  const glassClass = theme === 'dark' ? 'glass-dark' : 'glass-light';
  const textClass = theme === 'dark' ? 'text-zinc-100' : 'text-slate-900';
  const [providers, setProviders] = useState<any[]>([]);
  const [isLoadingProviders, setIsLoadingProviders] = useState(false);
  const [tempRating, setTempRating] = useState(movie.userRating || 0);
  const [tempNote, setTempNote] = useState(movie.userNote || '');
  const [isSavingPersonal, setIsSavingPersonal] = useState(false);

  useEffect(() => {
    if (movie.watch_providers) {
      try {
        setProviders(JSON.parse(movie.watch_providers));
      } catch (e) {
        setProviders([]);
      }
    } else {
      const loadProviders = async () => {
        setIsLoadingProviders(true);
        try {
          let tmdbId = movie.tmdb_id;
          if (!tmdbId) {
            const searchRes = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(movie.title)}`);
            const searchData = await searchRes.json();
            const matched = (searchData.results || []).find((r: any) =>
              (r.media_type === movie.media_type || 'movie') &&
              (r.title || r.name).toLowerCase().trim() === movie.title.toLowerCase().trim()
            );
            if (matched) tmdbId = matched.id;
          }
          if (tmdbId) {
            const providerRes = await fetch(`https://api.themoviedb.org/3/${movie.media_type || 'movie'}/${tmdbId}/watch/providers?api_key=${TMDB_API_KEY}`);
            const providerData = await providerRes.json();
            const flatrate = providerData.results?.US?.flatrate || [];
            const formatted = flatrate.map((p: any) => ({
              provider_name: p.provider_name,
              logo_path: p.logo_path
            }));
            setProviders(formatted);
          }
        } catch (err) {
          console.error("Error fetching watch providers dynamically:", err);
        } finally {
          setIsLoadingProviders(false);
        }
      };
      loadProviders();
    }
  }, [movie]);

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/95 backdrop-blur-md animate-in fade-in duration-300" onClick={onClose}></div>
      <div className={`relative ${glassClass} w-full max-w-4xl h-full sm:h-auto max-h-[95vh] overflow-y-auto rounded-t-[40px] sm:rounded-[40px] shadow-2xl animate-in slide-in-from-bottom-10 duration-500 no-scrollbar ${theme === 'light' ? 'bg-white/95' : ''}`}>
        <button onClick={onClose} className="fixed sm:absolute top-5 right-5 z-[110] p-3 bg-black/50 rounded-full text-white/70 hover:text-white backdrop-blur-md transition-colors">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>

        <div className="relative aspect-video w-full bg-black overflow-hidden shadow-inner">
          {trailerId ? (
            <iframe className="w-full h-full" src={`https://www.youtube.com/embed/${trailerId}?autoplay=1`} allow="autoplay" allowFullScreen title="trailer"></iframe>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-zinc-900 relative">
              {movie.poster && <img src={movie.poster} className="w-full h-full object-cover blur-3xl opacity-40 absolute inset-0" alt="poster-blur" />}
              <p className="relative text-zinc-500 font-black uppercase tracking-widest text-sm">No Trailer Available</p>
            </div>
          )}
        </div>

        <div className="p-8 space-y-8">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <h2 className={`text-3xl sm:text-4xl font-black leading-tight tracking-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{movie.title}</h2>
              {!isSaved && <div className="bg-indigo-600/20 text-indigo-400 text-[9px] font-black px-2 py-1 rounded-lg uppercase tracking-widest border border-indigo-600/30">Preview</div>}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-yellow-500 font-black text-sm">★ {movie.rating?.toFixed(1) || '0.0'}</span>
              <span className={`w-1 h-1 rounded-full ${theme === 'dark' ? 'bg-zinc-700' : 'bg-zinc-300'}`}></span>
              <span className={`font-bold text-sm uppercase tracking-widest ${theme === 'dark' ? 'text-zinc-200' : 'text-slate-800'}`}>{movie.release_year || 'TBA'} • {movie.genre || 'Uncategorized'}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {[
              { id: 'list', label: 'To Watch', color: 'indigo' },
              { id: 'watching', label: 'Watching', color: 'amber' },
              { id: 'watched', label: 'Watched', color: 'emerald' },
              { id: 'favorite', label: 'Favorite', color: 'rose' }
            ].map(btn => {
              const isActive = isSaved && (movie.status || 'list') === btn.id;
              return (
                <button
                  key={btn.id}
                  onClick={() => onUpdateStatus(btn.id as any)}
                  className={`flex-1 min-w-[120px] px-6 py-4 rounded-2xl text-sm font-black uppercase tracking-widest transition-all border ${isActive ? `bg-${btn.color}-600 border-transparent text-white shadow-xl scale-[1.02]` : `${theme === 'dark' ? 'bg-white/5 border-white/10 text-zinc-300 hover:bg-white/10 hover:text-white' : 'bg-zinc-100 border-zinc-200 text-slate-800 hover:bg-zinc-200 hover:text-indigo-600 hover:border-indigo-600/30'}`}`}
                >
                  {btn.label}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 pb-10">
            <div className="md:col-span-2 space-y-6">
              <div>
                <h3 className="text-indigo-500 font-black uppercase tracking-widest text-[11px] mb-3">Storyline</h3>
                <p className={`${theme === 'dark' ? 'text-zinc-200' : 'text-slate-950'} leading-relaxed text-base font-semibold`}>{movie.description || "No description available."}</p>
              </div>

              {isSaved && (movie.status === 'watched' || movie.status === 'watching') && (
                <div className={`p-5 rounded-3xl ${theme === 'dark' ? 'bg-white/5 border border-white/10' : 'bg-slate-50 border border-slate-200'}`}>
                  <h3 className="text-indigo-500 font-black uppercase tracking-widest text-[11px] mb-4">Your Opinion</h3>
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      {[1, 2, 3, 4, 5].map(star => (
                        <button
                          key={star}
                          onClick={() => setTempRating(star)}
                          className={`text-2xl transition-all ${star <= tempRating ? 'text-yellow-400 scale-110 drop-shadow-md' : 'text-zinc-400/30 hover:text-yellow-400/50'}`}
                        >
                          ★
                        </button>
                      ))}
                    </div>
                    <div className="relative">
                      <textarea
                        value={tempNote}
                        onChange={(e) => setTempNote(e.target.value.slice(0, 50))}
                        placeholder="Add a short note..."
                        className={`w-full bg-transparent border-b ${theme === 'dark' ? 'border-white/20 text-white placeholder:text-white/30' : 'border-slate-300 text-slate-800 placeholder:text-slate-400'} py-2 outline-none focus:border-indigo-500 transition-colors resize-none font-semibold text-sm`}
                        rows={1}
                      />
                      <span className={`absolute right-2 bottom-2 text-[10px] font-bold ${tempNote.length >= 50 ? 'text-rose-500' : 'text-zinc-400'}`}>{tempNote.length}/50</span>
                    </div>
                    {onUpdatePersonal && (tempRating !== (movie.userRating || 0) || tempNote !== (movie.userNote || '')) && (
                      <button
                        onClick={async () => {
                          setIsSavingPersonal(true);
                          await onUpdatePersonal(tempRating, tempNote);
                          setIsSavingPersonal(false);
                        }}
                        disabled={isSavingPersonal}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
                      >
                        {isSavingPersonal ? 'Saving...' : 'Save Opinion'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {isSaved && (
                <button
                  onClick={() => {
                    setConfirmModal({
                      title: "Delete Movie",
                      message: `Are you sure you want to permanently remove "${movie.title}" from your vault?`,
                      onConfirm: () => {
                        onDelete();
                        setConfirmModal(null);
                      }
                    });
                  }}
                  className="px-8 py-4 border border-rose-500/20 text-rose-500 hover:bg-rose-500/10 rounded-2xl text-sm font-black uppercase tracking-widest transition-all"
                >
                  Delete from Vault
                </button>

              )}
            </div>
            <div className="space-y-8">
              <div>
                <h3 className={`${theme === 'dark' ? 'text-zinc-300' : 'text-slate-800'} font-black uppercase tracking-widest text-[11px] mb-2`}>Director</h3>
                <p className={`text-sm font-bold ${theme === 'dark' ? 'text-zinc-100' : 'text-slate-950'} tracking-wide`}>{movie.director || 'N/A'}</p>
              </div>
              <div>
                <h3 className={`${theme === 'dark' ? 'text-zinc-300' : 'text-slate-800'} font-black uppercase tracking-widest text-[11px] mb-2`}>Starring</h3>
                <p className={`text-sm ${theme === 'dark' ? 'text-zinc-200' : 'text-slate-900'} leading-relaxed font-semibold`}>{movie.cast || 'N/A'}</p>
              </div>
              {movie.media_type === 'tv' && (
                <div className={`flex gap-8 border-t ${theme === 'dark' ? 'border-white/5' : 'border-zinc-200'} pt-6`}>
                  <div><h3 className={`${theme === 'dark' ? 'text-zinc-300' : 'text-slate-800'} font-black text-sm mb-1 uppercase tracking-widest`}>Seasons</h3><p className="font-bold text-indigo-400 text-lg">{movie.seasons || '?'}</p></div>
                  <div><h3 className={`${theme === 'dark' ? 'text-zinc-300' : 'text-slate-800'} font-black text-sm mb-1 uppercase tracking-widest`}>Episodes</h3><p className="font-bold text-indigo-400 text-lg">{movie.episodes || '?'}</p></div>
                </div>
              )}
              {/* Where to Watch Section */}
              <div className={`border-t ${theme === 'dark' ? 'border-white/5' : 'border-zinc-200'} pt-6`}>
                <h3 className={`${theme === 'dark' ? 'text-zinc-300' : 'text-slate-800'} font-black uppercase tracking-widest text-[11px] mb-3`}>Where to Watch</h3>
                {isLoadingProviders ? (
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce"></span>
                    <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce delay-100"></span>
                    <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce delay-200"></span>
                  </div>
                ) : providers.length > 0 ? (
                  <div className="flex flex-wrap gap-2.5">
                    {providers.map((p: any) => {
                      const queryStr = encodeURIComponent(movie.title);
                      const providerLower = p.provider_name.toLowerCase();
                      let watchUrl = `https://www.google.com/search?q=watch+${queryStr}+on+${encodeURIComponent(p.provider_name)}`;
                      if (providerLower.includes('netflix')) watchUrl = `https://www.netflix.com/search?q=${queryStr}`;
                      else if (providerLower.includes('amazon') || providerLower.includes('prime')) watchUrl = `https://www.amazon.com/s?k=${queryStr}&i=instant-video`;
                      else if (providerLower.includes('disney')) watchUrl = `https://www.disneyplus.com/`;
                      else if (providerLower.includes('max') || providerLower.includes('hbo')) watchUrl = `https://play.max.com/search?q=${queryStr}`;
                      else if (providerLower.includes('hulu')) watchUrl = `https://www.hulu.com/search?q=${queryStr}`;
                      else if (providerLower.includes('apple tv')) watchUrl = `https://tv.apple.com/search?term=${queryStr}`;

                      return (
                        <a
                          key={p.provider_name}
                          href={watchUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex flex-col items-center gap-1 group cursor-pointer hover:no-underline"
                          title={`Watch on ${p.provider_name}`}
                        >
                          {p.logo_path ? (
                            <img
                              src={`https://image.tmdb.org/t/p/w92${p.logo_path}`}
                              alt={p.provider_name}
                              className="w-10 h-10 rounded-xl object-cover shadow-md border border-white/5 group-hover:scale-110 group-hover:ring-2 group-hover:ring-indigo-500 transition-all duration-300"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center text-[6px] text-center font-bold text-zinc-300">{p.provider_name}</div>
                          )}
                          <span className={`text-[7px] ${theme === 'dark' ? 'text-zinc-300' : 'text-slate-800'} font-black tracking-tighter truncate max-w-[45px] group-hover:text-indigo-500`}>{p.provider_name}</span>
                        </a>
                      );
                    })}
                  </div>
                ) : (
                  <p className={`text-sm ${theme === 'dark' ? 'text-zinc-400' : 'text-slate-800'} font-semibold italic`}>Not available on subscription streams.</p>
                )}
                <p className={`text-[7px] ${theme === 'dark' ? 'text-zinc-400' : 'text-slate-800'} mt-3 font-black uppercase tracking-tighter`}>Powered by JustWatch • Click to watch</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const ManualAddModal = ({ theme, existingGenres, onClose, onSave }: { theme: Theme, existingGenres: string[], onClose: () => void, onSave: (m: Movie) => void }) => {
  const [isNewGenre, setIsNewGenre] = useState(false);
  const [formData, setFormData] = useState<Partial<Movie>>({
    title: '',
    description: '',
    genre: '',
    poster: '',
    rating: 0,
    release_year: new Date().getFullYear(),
    status: 'list',
    media_type: 'movie',
    director: '',
    cast: '',
    trailer: '',
    language: 'English'
  });

  const glassClass = theme === 'dark' ? 'glass-dark' : 'glass-light';
  const inputClass = `w-full ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white' : 'bg-zinc-50 border-zinc-200 text-slate-800'} border rounded-2xl px-5 py-3 outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all text-sm font-medium placeholder:text-zinc-500`;
  const labelClass = `text-sm font-black uppercase tracking-widest ${theme === 'dark' ? 'text-zinc-500' : 'text-zinc-400'} mb-2 block ml-1`;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title) return;

    const movie: Movie = {
      ...formData as Movie,
      added_at: new Date().toISOString()
    };
    onSave(movie);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-black/90 backdrop-blur-xl animate-in fade-in duration-300" onClick={onClose}></div>
      <div className={`relative ${glassClass} w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-[40px] shadow-2xl animate-in zoom-in-95 duration-300 no-scrollbar p-8 sm:p-10`}>
        <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className={`text-2xl font-black tracking-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Manual Entry</h2>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-indigo-500 mt-1">Add to your cloud vault</p>
          </div>
          <button onClick={onClose} className="p-3 hover:bg-white/5 rounded-2xl transition-colors text-zinc-500">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="sm:col-span-2">
            <label className={labelClass}>Movie Title *</label>
            <input required className={inputClass} placeholder="e.g. Inception" value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} />
          </div>

          <div className="sm:col-span-2">
            <label className={labelClass}>Poster Image URL</label>
            <input className={inputClass} placeholder="https://..." value={formData.poster} onChange={e => setFormData({ ...formData, poster: e.target.value })} />
          </div>

          <div>
            <label className={labelClass}>Genre</label>
            {!isNewGenre ? (
              <select
                className={inputClass}
                value={formData.genre}
                onChange={e => {
                  if (e.target.value === 'ADD_NEW') {
                    setIsNewGenre(true);
                    setFormData({ ...formData, genre: '' });
                  } else {
                    setFormData({ ...formData, genre: e.target.value });
                  }
                }}
              >
                <option value="">Select Genre</option>
                {existingGenres.map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
                <option value="ADD_NEW" className="text-indigo-500 font-bold">+ Add New Genre...</option>
              </select>
            ) : (
              <div className="relative">
                <input
                  autoFocus
                  className={inputClass}
                  placeholder="Type new genre..."
                  value={formData.genre}
                  onChange={e => setFormData({ ...formData, genre: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => { setIsNewGenre(false); setFormData({ ...formData, genre: '' }); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black uppercase text-zinc-500 hover:text-indigo-500"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          <div>
            <label className={labelClass}>Release Year</label>
            <input type="number" className={inputClass} value={formData.release_year} onChange={e => setFormData({ ...formData, release_year: parseInt(e.target.value) })} />
          </div>

          <div>
            <label className={labelClass}>Rating (0-10)</label>
            <input type="number" step="0.1" min="0" max="10" className={inputClass} value={formData.rating} onChange={e => setFormData({ ...formData, rating: parseFloat(e.target.value) })} />
          </div>

          <div>
            <label className={labelClass}>Category</label>
            <select className={inputClass} value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value as any })}>
              <option value="list">To Watch</option>
              <option value="watching">Watching</option>
              <option value="watched">Watched</option>
              <option value="favorite">Favorite</option>
            </select>
          </div>

          <div>
            <label className={labelClass}>Director</label>
            <input className={inputClass} placeholder="Christopher Nolan" value={formData.director} onChange={e => setFormData({ ...formData, director: e.target.value })} />
          </div>

          <div>
            <label className={labelClass}>Media Type</label>
            <select className={inputClass} value={formData.media_type} onChange={e => setFormData({ ...formData, media_type: e.target.value as any })}>
              <option value="movie">Movie</option>
              <option value="tv">TV Show</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className={labelClass}>Cast</label>
            <input className={inputClass} placeholder="Leonardo DiCaprio, Joseph Gordon-Levitt" value={formData.cast} onChange={e => setFormData({ ...formData, cast: e.target.value })} />
          </div>

          <div className="sm:col-span-2">
            <label className={labelClass}>Description</label>
            <textarea rows={3} className={`${inputClass} resize-none`} placeholder="A thief who steals corporate secrets..." value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} />
          </div>

          <div className="sm:col-span-2 pt-4">
            <button type="submit" className="w-full py-5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-[24px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-indigo-600/30 transition-all active:scale-95">
              Save to Vault
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const UserProfileSetup = ({
  theme,
  onComplete
}: {
  theme: Theme,
  onComplete: (username: string, avatar: string, interests: string[], dob: string, onError: (err: string) => void) => void
}) => {
  const [username, setUsername] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('🍿');
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [dob, setDob] = useState('');
  const [error, setError] = useState('');

  const avatars = ['🍿', '🎬', '📺', '🕶️', '🚀', '🦊', '🪐', '👾', '🎨', '🎧'];
  const genres = ['Action', 'Comedy', 'Sci-Fi', 'Thriller', 'Horror', 'Drama', 'Romance', 'Anime', 'Documentary', 'Fantasy'];

  const handleInterestToggle = (g: string) => {
    setSelectedInterests(prev =>
      prev.includes(g) ? prev.filter(item => item !== g) : [...prev, g]
    );
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        const img = new window.Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX = 600;
          let w = img.width, h = img.height;
          if (w > h) { if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; } }
          else { if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; } }
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0, w, h);
          // Compress: start at 0.85 quality, reduce until under 700KB
          let quality = 0.85;
          let dataUrl = canvas.toDataURL('image/jpeg', quality);
          while (dataUrl.length > 700000 && quality > 0.3) {
            quality -= 0.1;
            dataUrl = canvas.toDataURL('image/jpeg', quality);
          }
          setSelectedAvatar(dataUrl);
        };
        img.src = reader.result as string;
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim()) {
      setError('Please choose a username.');
      return;
    }
    if (username.trim().includes(' ')) {
      setError('Username cannot contain spaces.');
      return;
    }
    if (!dob) {
      setError('Please enter your birth year.');
      return;
    }
    const birthYear = parseInt(dob, 10);
    const currentYear = new Date().getFullYear();
    if (isNaN(birthYear) || birthYear < 1900 || birthYear > currentYear) {
      setError('Please enter a valid birth year.');
      return;
    }
    const age = currentYear - birthYear;
    if (age < 13) {
      setError('You must be at least 13 years old to join.');
      return;
    }
    if (selectedInterests.length === 0) {
      setError('Please select at least one favorite genre.');
      return;
    }
    onComplete(username.trim(), selectedAvatar, selectedInterests, dob, (errText) => setError(errText));
  };

  const glassStyle = theme === 'dark' ? 'glass-dark border-white/10' : 'bg-white border-slate-200 shadow-2xl backdrop-blur-xl';
  const textStyle = theme === 'dark' ? 'text-zinc-100' : 'text-slate-800';
  const labelStyle = theme === 'dark' ? 'text-zinc-500' : 'text-slate-400';
  const inputStyle = `w-full px-5 py-4 rounded-2xl border ${theme === 'dark' ? 'bg-black/50 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'} outline-none focus:border-indigo-500 transition-colors text-sm font-semibold`;

  return (
    <div className={`min-h-screen flex items-center justify-center p-6 transition-colors duration-500 ${theme === 'dark' ? 'bg-[#050505]' : 'bg-[#f1f5f9]'}`}>
      <div className={`w-full max-w-lg p-8 rounded-[40px] border ${glassStyle} space-y-8 animate-in zoom-in-95 duration-300`}>
        <div className="text-center space-y-2">
          {selectedAvatar.startsWith('data:image') ? (
            <img src={selectedAvatar} className="w-20 h-20 rounded-full object-cover mx-auto mb-3 border-2 border-indigo-500 shadow-md animate-in zoom-in-50 duration-300" alt="avatar" />
          ) : (
            <div className="text-5xl animate-bounce mb-3">{selectedAvatar}</div>
          )}
          <h2 className={`text-3xl font-black font-questrial tracking-wide uppercase ${textStyle}`}>Initialize Profile</h2>
          <p className={`text-sm ${labelStyle} uppercase font-bold tracking-widest`}>Customize your movie tracking experience</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-500 text-sm font-bold rounded-2xl text-center">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label className={`text-sm font-black uppercase tracking-widest ${labelStyle} block ml-1`}>Choose a Username</label>
            <input
              className={inputStyle}
              placeholder="e.g. MovieLover99"
              value={username}
              onChange={e => setUsername(e.target.value)}
              maxLength={20}
            />
          </div>

          <div className="space-y-2">
            <label className={`text-sm font-black uppercase tracking-widest ${labelStyle} block ml-1`}>Birth Year</label>
            <input
              type="number"
              className={inputStyle}
              value={dob}
              onChange={e => setDob(e.target.value)}
              min="1900"
              max={new Date().getFullYear()}
              placeholder="e.g. 1995"
            />
            <p className={`text-[9px] ${labelStyle} ml-1`}>Used to personalize recommendations. Must be 13+.</p>
          </div>

          <div className="space-y-2">
            <label className={`text-sm font-black uppercase tracking-widest ${labelStyle} block ml-1`}>Select Avatar or Upload Photo</label>
            <div className="flex gap-2.5 overflow-x-auto pb-2 pt-1 no-scrollbar items-center">
              <label className={`flex-shrink-0 p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-center ${selectedAvatar.startsWith('data:image') ? 'bg-indigo-600 border-transparent text-white' : `${theme === 'dark' ? 'bg-white/5 border-white/5 hover:bg-white/10 text-zinc-400' : 'bg-slate-100 border-slate-200 hover:bg-slate-200 text-slate-600'}`}`}>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              </label>
              {avatars.map(av => (
                <button
                  key={av}
                  type="button"
                  onClick={() => setSelectedAvatar(av)}
                  className={`flex-shrink-0 text-2xl p-3.5 rounded-2xl border transition-all ${selectedAvatar === av ? 'bg-indigo-600 border-transparent scale-110 shadow-lg text-white' : `${theme === 'dark' ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-slate-100 border-slate-200 hover:bg-slate-200'}`}`}
                >
                  {av}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className={`text-sm font-black uppercase tracking-widest ${labelStyle} block ml-1`}>Select Favorite Genres</label>
            <div className="flex flex-wrap gap-2 pt-1">
              {genres.map(g => {
                const isSelected = selectedInterests.includes(g);
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => handleInterestToggle(g)}
                    className={`px-4 py-2.5 rounded-xl border text-sm font-black uppercase tracking-wider transition-all ${isSelected ? 'bg-indigo-600 border-transparent text-white shadow-md' : `${theme === 'dark' ? 'bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'}`}`}
                  >
                    {g}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-4.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-black uppercase tracking-[0.2em] shadow-lg shadow-indigo-600/20 transition-all active:scale-98 text-sm pt-4"
          >
            Complete Setup
          </button>
        </form>
      </div>
    </div>
  );
};

const ShareOpinionModal = ({ movie, type, theme, onClose, onSubmit }: { movie: Movie, type: 'watching' | 'recommended', theme: Theme, onClose: () => void, onSubmit: (rating: number, note: string) => Promise<void> }) => {
  const [tempRating, setTempRating] = useState(movie.userRating || 0);
  const [tempNote, setTempNote] = useState(movie.userNote || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={onClose}></div>
      <div className={`relative ${theme === 'dark' ? 'glass-dark border-white/10' : 'bg-white border-slate-200 shadow-2xl'} rounded-[32px] max-w-sm w-full p-6 space-y-6 animate-in zoom-in-95 duration-200`}>
        <div className="space-y-2 text-center">
          <h3 className={`text-lg font-black uppercase tracking-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
            {type === 'watching' ? 'Share as Watching' : 'Add to Recommended'}
          </h3>
          <p className={`text-sm font-semibold leading-relaxed ${theme === 'dark' ? 'text-zinc-400' : 'text-slate-500'}`}>
            Add your rating and comment for your friends to see!
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex justify-center gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => setTempRating(star)}
                className="p-1 transition-transform hover:scale-125"
              >
                <svg className={`w-8 h-8 ${tempRating >= star ? 'text-amber-400' : 'text-zinc-400'}`} fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              </button>
            ))}
          </div>
          <div className="relative">
            <textarea
              value={tempNote}
              onChange={(e) => setTempNote(e.target.value.slice(0, 50))}
              placeholder="Add a short note... (optional)"
              className={`w-full ${theme === 'dark' ? 'bg-black/40 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'} border rounded-2xl p-4 text-sm outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-400 resize-none h-24`}
              maxLength={50}
            />
            <div className={`absolute bottom-3 right-3 text-[10px] font-bold ${tempNote.length === 50 ? 'text-rose-500' : 'text-slate-400'}`}>
              {tempNote.length}/50
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className={`flex-1 py-3.5 rounded-2xl text-sm font-black uppercase tracking-wider transition-all ${theme === 'dark' ? 'bg-white/5 border border-white/10 hover:bg-white/10 text-zinc-400' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}>Cancel</button>
          <button
            onClick={async () => {
              setIsSubmitting(true);
              await onSubmit(tempRating, tempNote);
              setIsSubmitting(false);
            }}
            disabled={isSubmitting}
            className="flex-1 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-sm font-black uppercase tracking-wider transition-all shadow-lg shadow-indigo-600/30 disabled:opacity-50"
          >
            {isSubmitting ? 'Sharing...' : 'Share'}
          </button>
        </div>
      </div>
    </div>
  );
};

const ChangeEmailModal = ({ onClose, onUpdate, theme }: { onClose: () => void, onUpdate: (newEmail: string) => Promise<void>, theme: Theme }) => {
  const [email, setEmail] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState('');
  const glassClass = theme === 'dark' ? 'glass-dark border-white/10' : 'bg-white border-slate-200 shadow-2xl';
  const textClass = theme === 'dark' ? 'text-white' : 'text-slate-900';
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" onClick={onClose}></div>
      <div className={`relative ${glassClass} rounded-[32px] w-full max-w-md p-8 animate-in zoom-in-95 duration-200`}>
        <div className="space-y-6">
          <div>
            <h2 className={`text-2xl font-black uppercase tracking-tight mb-2 ${textClass}`}>Change Email</h2>
            <p className={`text-sm font-semibold ${theme === 'dark' ? 'text-zinc-400' : 'text-slate-500'}`}>Enter your new email address below.</p>
          </div>
          {error && <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-500 text-sm font-bold rounded-xl text-center">{error}</div>}
          <input type="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); }} className={`w-full px-4 py-3 rounded-xl border ${theme === 'dark' ? 'bg-black/50 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'} outline-none focus:border-indigo-500 transition-colors`} placeholder="New Email" />
          <div className="flex gap-3 pt-4 border-t border-white/5">
            <button onClick={onClose} disabled={isUpdating} className={`flex-1 py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-colors ${theme === 'dark' ? 'hover:bg-white/5 text-zinc-400' : 'hover:bg-slate-100 text-slate-500'}`}>Cancel</button>
            <button onClick={async () => {
              if (!email) { setError("Please enter an email"); return; }
              setIsUpdating(true);
              try {
                await onUpdate(email);
              } catch (e: any) {
                setError(e.message || "Failed to update email.");
              } finally {
                setIsUpdating(false);
              }
            }} disabled={isUpdating} className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-black uppercase tracking-widest text-xs shadow-lg transition-colors">Update</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ChangePasswordModal = ({ onClose, onUpdate, theme }: { onClose: () => void, onUpdate: (newPass: string) => Promise<void>, theme: Theme }) => {
  const [password, setPassword] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState('');
  const glassClass = theme === 'dark' ? 'glass-dark border-white/10' : 'bg-white border-slate-200 shadow-2xl';
  const textClass = theme === 'dark' ? 'text-white' : 'text-slate-900';
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" onClick={onClose}></div>
      <div className={`relative ${glassClass} rounded-[32px] w-full max-w-md p-8 animate-in zoom-in-95 duration-200`}>
        <div className="space-y-6">
          <div>
            <h2 className={`text-2xl font-black uppercase tracking-tight mb-2 ${textClass}`}>Change Password</h2>
            <p className={`text-sm font-semibold ${theme === 'dark' ? 'text-zinc-400' : 'text-slate-500'}`}>Enter your new password below (min 6 characters).</p>
          </div>
          {error && <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-500 text-sm font-bold rounded-xl text-center">{error}</div>}
          <input type="password" value={password} onChange={e => { setPassword(e.target.value); setError(''); }} className={`w-full px-4 py-3 rounded-xl border ${theme === 'dark' ? 'bg-black/50 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'} outline-none focus:border-indigo-500 transition-colors`} placeholder="New Password" />
          <div className="flex gap-3 pt-4 border-t border-white/5">
            <button onClick={onClose} disabled={isUpdating} className={`flex-1 py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-colors ${theme === 'dark' ? 'hover:bg-white/5 text-zinc-400' : 'hover:bg-slate-100 text-slate-500'}`}>Cancel</button>
            <button onClick={async () => {
              if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
              setIsUpdating(true);
              try {
                await onUpdate(password);
              } catch (e: any) {
                setError(e.message || "Failed to update password.");
              } finally {
                setIsUpdating(false);
              }
            }} disabled={isUpdating} className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-black uppercase tracking-widest text-xs shadow-lg transition-colors">Update</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const App = () => {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('sam_theme') as Theme) || 'dark');
  const [showWelcomeScreen, setShowWelcomeScreen] = useState(false);
  const [isChangeEmailOpen, setIsChangeEmailOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isDeleteAccountOpen, setIsDeleteAccountOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'collection' | 'find' | 'friends' | 'board'>('collection');
  const [findMode, setFindMode] = useState<'search' | 'ai'>('search');
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [isLoadingRecs, setIsLoadingRecs] = useState(false);
  const [aiDailyCount, setAiDailyCount] = useState(0);
  const [aiDailyDate, setAiDailyDate] = useState('');
  const [filter, setFilter] = useState<Movie['status']>('list');
  const [movies, setMovies] = useState<Movie[]>([]);
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [isManualAddOpen, setIsManualAddOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const [vaultSearch, setVaultSearch] = useState('');
  const [vaultSuggestions, setVaultSuggestions] = useState<any[]>([]);

  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [filterGenre, setFilterGenre] = useState('');
  const [filterProvider, setFilterProvider] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [filterCountry, setFilterCountry] = useState('');
  const [filterMediaType, setFilterMediaType] = useState('');
  const [filterRating, setFilterRating] = useState(0);
  const [sortBy, setSortBy] = useState('added_at_desc');

  const [aiInput, setAiInput] = useState('');
  const [aiHistory, setAiHistory] = useState<{ role: string, content: string, results?: any[] }[]>([]);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);

  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const activeTabRef = useRef(activeTab);
  const findModeRef = useRef(findMode);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const outAudioCtxRef = useRef<AudioContext | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextStartTimeRef = useRef(0);

  // Firebase Auth and Import States
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authEmail, setAuthEmail] = useState('');
  const [authConfirmEmail, setAuthConfirmEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authConfirmPassword, setAuthConfirmPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authError, setAuthError] = useState('');
  const [authSuccess, setAuthSuccess] = useState('');

  // CSV Import States
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importTotal, setImportTotal] = useState(0);

  // User Profile, Hamburger Drawer, and Notification States
  const [userProfile, setUserProfile] = useState<{ username: string; avatar: string; interests: string[]; dob?: string; created_at?: string; blockedUsers?: string[] } | null>(null);
  const [showProfileSetup, setShowProfileSetup] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  
  const [searchUserModal, setSearchUserModal] = useState<{ uid: string, username: string, avatar: string } | null>(null);

  const [friendsList, setFriendsList] = useState<any[]>([]);
  const [mySharedWatching, setMySharedWatching] = useState<any>(null);
  const [myRecommendedCount, setMyRecommendedCount] = useState<number>(0);
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [shareOpinionModal, setShareOpinionModal] = useState<{ movie: Movie, type: 'watching' | 'recommended' } | null>(null);

  // Board states
  const [boardScope, setBoardScope] = useState<'friends' | 'global'>('global');
  const [boardTimeframe, setBoardTimeframe] = useState<'day' | 'week' | 'month'>('week');
  const [boardMovies, setBoardMovies] = useState<any[]>([]);
  const [isBoardLoading, setIsBoardLoading] = useState(false);

  const [stories, setStories] = useState<any[]>([]);
  const [activeStoryState, setActiveStoryState] = useState<{ groups: any[][], startIndex: number } | null>(null);
  const [isCreateStoryOpen, setIsCreateStoryOpen] = useState(false);

  const [viewedStoryIds, setViewedStoryIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('viewed_story_ids');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch (e) {
      return new Set();
    }
  });

  const handleViewStory = (storyId: string) => {
    setViewedStoryIds(prev => {
      const next = new Set(prev);
      next.add(storyId);
      localStorage.setItem('viewed_story_ids', JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const [notifications, setNotifications] = useState<any[]>([]);

  // Drawer Accordions & Edit Profile States
  const [collapseProfile, setCollapseProfile] = useState(true);
  const [collapseTheme, setCollapseTheme] = useState(true);
  const [collapseInterests, setCollapseInterests] = useState(true);
  const [collapseFriends, setCollapseFriends] = useState(true);
  const [collapseNotificationsPref, setCollapseNotificationsPref] = useState(true);
  const [collapseAccount, setCollapseAccount] = useState(true);

  // Switch Toggle States for Notification Preferences
  const [notifyFriendRequests, setNotifyFriendRequests] = useState(() => localStorage.getItem('notify_friend_requests') !== 'false');
  const [notifyRecommended, setNotifyRecommended] = useState(() => localStorage.getItem('notify_recommended') !== 'false');
  const [notifyWatching, setNotifyWatching] = useState(() => localStorage.getItem('notify_watching') !== 'false');
  const [notifyNewStory, setNotifyNewStory] = useState(() => localStorage.getItem('notify_new_story') !== 'false');
  const [notifyReleaseWatching, setNotifyReleaseWatching] = useState(() => localStorage.getItem('notify_release_watching') !== 'false');
  const [notifyReleaseFavorites, setNotifyReleaseFavorites] = useState(() => localStorage.getItem('notify_release_favorites') !== 'false');

  const updateNotifyPref = async (key: string, val: boolean) => {
    localStorage.setItem(key, String(val));
    if (user) {
      try {
        const ref = doc(db, "users", user.uid, "profile", "data");
        await setDoc(ref, { notificationPrefs: { [key]: val } }, { merge: true });
      } catch (e) {
        console.error("Failed to update Firestore notification prefs:", e);
      }
    }
  };

  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [showFullAvatar, setShowFullAvatar] = useState(false);
  const [viewProfilePicModal, setViewProfilePicModal] = useState<{ src: string; username: string } | null>(null);
  const [isEditingInterests, setIsEditingInterests] = useState(false);
  const [editUsername, setEditUsername] = useState('');
  const [editAvatar, setEditAvatar] = useState('');
  const [editInterests, setEditInterests] = useState<string[]>([]);
  const [editError, setEditError] = useState('');

  const popupsRef = useRef<any>({});
  useEffect(() => {
    popupsRef.current = {
      isChangeEmailOpen, isChangePasswordOpen, isDeleteAccountOpen,
      selectedMovie, isManualAddOpen, isEditingProfile, isEditingInterests,
      searchUserModal, shareOpinionModal, isDrawerOpen, isNotificationsOpen,
      showWelcomeScreen
    };
  }, [isChangeEmailOpen, isChangePasswordOpen, isDeleteAccountOpen, selectedMovie, isManualAddOpen, isEditingProfile, isEditingInterests, searchUserModal, shareOpinionModal, isDrawerOpen, isNotificationsOpen, showWelcomeScreen]);

  useEffect(() => { activeTabRef.current = activeTab; findModeRef.current = findMode; }, [activeTab, findMode]);

  useEffect(() => {
    let lastBackPress = 0;
    const timePeriodToExit = 2000;

    const backListener = CapacitorApp.addListener('backButton', () => {
      const p = popupsRef.current;
      if (p.showWelcomeScreen) setShowWelcomeScreen(false);
      else if (p.selectedMovie) setSelectedMovie(null);
      else if (p.shareOpinionModal) setShareOpinionModal(null);
      else if (p.searchUserModal) setSearchUserModal(null);
      else if (p.isManualAddOpen) setIsManualAddOpen(false);
      else if (p.isEditingInterests) setIsEditingInterests(false);
      else if (p.isEditingProfile) setIsEditingProfile(false);
      else if (p.isChangeEmailOpen) setIsChangeEmailOpen(false);
      else if (p.isChangePasswordOpen) setIsChangePasswordOpen(false);
      else if (p.isDeleteAccountOpen) setIsDeleteAccountOpen(false);
      else if (p.isNotificationsOpen) setIsNotificationsOpen(false);
      else if (p.isDrawerOpen) setIsDrawerOpen(false);
      else if (activeTabRef.current !== 'collection') {
        setActiveTab('collection');
      } else {
        const currentTime = new Date().getTime();
        if (currentTime - lastBackPress < timePeriodToExit) {
          CapacitorApp.exitApp();
        } else {
          lastBackPress = currentTime;
          setToast("Tap back again to exit");
        }
      }
    });

    return () => {
      backListener.then(l => l.remove());
    };
  }, []);

  // Capture referral parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const refUid = params.get('ref');
    if (refUid) {
      localStorage.setItem('referral_uid', refUid);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'find' && recommendations.length === 0 && !isLoadingRecs) {
      fetchRecommendations();
    }
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem('sam_theme', theme);
    document.body.className = theme === 'dark' ? 'bg-[#050505] text-zinc-100 overflow-x-hidden' : 'bg-[#f8fafc] text-slate-900 overflow-x-hidden';
  }, [theme]);

  const loadAllData = async (userId: string) => {
    try {
      const q = query(collection(db, "users", userId, "movies"), orderBy("added_at", "desc"));
      const querySnapshot = await getDocs(q);
      const list: Movie[] = [];
      querySnapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() } as Movie);
      });
      setMovies(list);
    } catch (e: any) {
      console.error("Cloud load error:", e);
      setToast("Failed to fetch vault from database.");
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setAuthLoading(true);
      setUser(u);
      if (u) {
        await loadAllData(u.uid);
      } else {
        setMovies([]);
        setUserProfile(null);
        setShowProfileSetup(false);
      }
      setAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user || !Capacitor.isNativePlatform()) return;

    const registerPush = async () => {
      try {
        let permStatus = await PushNotifications.checkPermissions();
        if (permStatus.receive === 'prompt') {
          permStatus = await PushNotifications.requestPermissions();
        }
        if (permStatus.receive !== 'granted') {
          console.warn('User denied push notifications');
          return;
        }
        await PushNotifications.register();
      } catch (err) {
        console.error('Error registering push:', err);
      }
    };

    registerPush();

    const addListeners = async () => {
      await PushNotifications.addListener('registration', async (token) => {
        try {
          const profileRef = doc(db, 'users', user.uid, 'profile', 'data');
          await setDoc(profileRef, { fcmToken: token.value }, { merge: true });
        } catch (err) {
          console.error('Failed to save FCM token:', err);
        }
      });

      await PushNotifications.addListener('registrationError', (err) => {
        console.error('Registration error: ', err.error);
      });

      await PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('Push notification received: ', notification);
      });

      await PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
        console.log('Push notification action performed', notification.actionId);
      });
    };

    addListeners();

    return () => {
      PushNotifications.removeAllListeners();
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;

    // Listen to profile updates
    const profileRef = doc(db, "users", user.uid, "profile", "data");
    const unsubProfile = onSnapshot(profileRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (!data.username) data.username = user.displayName || (user.email ? user.email.split('@')[0] : 'User');
        setUserProfile(data as any);
        setShowProfileSetup(false);
        if (data.notificationPrefs) {
          if (data.notificationPrefs.notify_friend_requests !== undefined) setNotifyFriendRequests(data.notificationPrefs.notify_friend_requests);
          if (data.notificationPrefs.notify_recommended !== undefined) setNotifyRecommended(data.notificationPrefs.notify_recommended);
          if (data.notificationPrefs.notify_watching !== undefined) setNotifyWatching(data.notificationPrefs.notify_watching);
          if (data.notificationPrefs.notify_new_story !== undefined) setNotifyNewStory(data.notificationPrefs.notify_new_story);
          if (data.notificationPrefs.notify_release_watching !== undefined) setNotifyReleaseWatching(data.notificationPrefs.notify_release_watching);
          if (data.notificationPrefs.notify_release_favorites !== undefined) setNotifyReleaseFavorites(data.notificationPrefs.notify_release_favorites);
        }
      } else {
        setShowProfileSetup(true);
      }
    });

    // Listen to real-time friends
    const friendsRef = collection(db, "users", user.uid, "friends");
    const unsubFriends = onSnapshot(friendsRef, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach(docSnap => {
        list.push({ uid: docSnap.id, ...docSnap.data() });
      });
      const blocked = userProfile?.blockedUsers || [];
      setFriendsList(list.filter(f => !blocked.includes(f.uid)));
    });

    // Listen to real-time notifications
    const notificationsRef = collection(db, "users", user.uid, "notifications");
    const unsubNotifications = onSnapshot(notificationsRef, (snapshot) => {
      if (!snapshot.empty) {
        const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a: any, b: any) => {
          const timeA = a.time ? new Date(a.time).getTime() : 0;
          const timeB = b.time ? new Date(b.time).getTime() : 0;
          return timeB - timeA;
        });
        setNotifications(list);

        // Process any unhandled friend_accepted or friend_removed notifications locally
        list.forEach(async (n: any) => {
          if (n.type === 'friend_accepted' && !n.processed && n.senderId) {
            try {
              const friendRef = doc(db, "users", user.uid, "friends", n.senderId);
              await setDoc(friendRef, {
                uid: n.senderId,
                username: n.senderUsername || 'Unknown',
                avatar: n.senderAvatar || null,
                status: "online",
                watching: "Nothing yet"
              });
              await updateDoc(doc(db, "users", user.uid, "notifications", n.id), { processed: true });
            } catch (e) {
              console.error("Failed to process accepted friend", e);
            }
          } else if (n.type === 'friend_removed' && !n.processed && n.senderId) {
            try {
              await deleteDoc(doc(db, "users", user.uid, "friends", n.senderId));
              await updateDoc(doc(db, "users", user.uid, "notifications", n.id), { processed: true });
            } catch (e) {
              console.error("Failed to process removed friend", e);
            }
          }
        });
      } else {
        setNotifications([
          { id: 'welcome', text: "Welcome! Connect with friends to see their activities here.", time: "Just now", read: true, isMock: true }
        ]);
      }
    });

    // Listen to my own shared watching
    const myWatchRef = doc(db, "users", user.uid, "shared_watching", "current");
    const unsubMyWatch = onSnapshot(myWatchRef, (docSnap) => {
      setMySharedWatching(docSnap.exists() ? docSnap.data() : null);
    });

    // Listen to my own recommended
    const myRecsRef = collection(db, "users", user.uid, "recommended");
    const unsubMyRecs = onSnapshot(myRecsRef, (snapshot) => {
      setMyRecommendedCount(snapshot.size);
    });

    // Listen to real-time stories (global collection)
    const storiesRef = collection(db, "stories");
    const unsubStories = onSnapshot(storiesRef, (snapshot) => {
      const list: any[] = [];
      const nowStr = new Date().toISOString();
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (data.expiresAt && data.expiresAt > nowStr) {
          list.push({ id: docSnap.id, ...data });
        }
      });
      list.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
      setStories(list);
    }, (err) => {
      console.error("Stories listen error:", err);
    });

    return () => {
      unsubProfile();
      unsubFriends();
      unsubNotifications();
      unsubMyWatch();
      unsubMyRecs();
      unsubStories();
    };
  }, [user]);

  // Load Board Data
  useEffect(() => {
    if (activeTab !== 'board' || !user) return;
    setIsBoardLoading(true);

    const loadBoardData = async () => {
      try {
        let allRecs: any[] = [];
        const now = new Date();
        if (boardTimeframe === 'day') {
          now.setDate(now.getDate() - 1);
        } else if (boardTimeframe === 'week') {
          now.setDate(now.getDate() - 7);
        } else if (boardTimeframe === 'month') {
          now.setMonth(now.getMonth() - 1);
        }
        const cutoffTime = now.getTime();

        const blocked = userProfile?.blockedUsers || [];
        const processDoc = (docSnap: any) => {
          // If this doc belongs to a blocked user, skip it
          const itemUid = docSnap.ref.parent.parent?.id;
          if (itemUid && blocked.includes(itemUid)) return;

          const data = docSnap.data();
          const timeStr = data.recommended_at || data.shared_at || data.added_at;
          const recTime = timeStr ? new Date(timeStr).getTime() : 0;
          if (recTime >= cutoffTime || !timeStr) {
            allRecs.push({ ...data, id: docSnap.id, _computedTime: recTime, _ownerUid: itemUid });
          }
        };

        if (boardScope === 'global') {
          const recsQuery = query(collectionGroup(db, 'recommended'));
          const snapshot = await getDocs(recsQuery);
          snapshot.forEach(processDoc);
        } else {
          // Add user's own recommendations to Friends board too
          const mySnapshot = await getDocs(collection(db, "users", user.uid, "recommended"));
          mySnapshot.forEach(processDoc);

          for (const friend of friendsList) {
            const snapshot = await getDocs(collection(db, "users", friend.uid, "recommended"));
            snapshot.forEach(processDoc);
          }
        }

        const movieMap = new Map<string, { movie: any, count: number, latestTime: number }>();
        allRecs.forEach(rec => {
          const key = rec.tmdb_id?.toString() || rec.title.toLowerCase();
          const recTime = rec._computedTime || 0;
          if (movieMap.has(key)) {
            const entry = movieMap.get(key)!;
            entry.count += 1;
            if (recTime > entry.latestTime) {
              entry.latestTime = recTime;
            }
          } else {
            movieMap.set(key, { movie: rec, count: 1, latestTime: recTime });
          }
        });

        const sortedMovies = Array.from(movieMap.values())
          .sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            return b.latestTime - a.latestTime;
          })
          .slice(0, 10)
          .map(entry => entry.movie);

        setBoardMovies(sortedMovies);
      } catch (err) {
        console.error("Error loading board data:", err);
        setToast("Failed to load trending movies.");
      } finally {
        setIsBoardLoading(false);
      }
    };

    loadBoardData();
  }, [activeTab, boardScope, boardTimeframe, user, friendsList, userProfile?.blockedUsers]);

  const parseCSV = (text: string): any[] => {
    const lines = [];
    let row = [""];
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          row[row.length - 1] += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push('');
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') i++;
        lines.push(row);
        row = [''];
      } else {
        row[row.length - 1] += char;
      }
    }
    if (row.length > 1 || row[0] !== '') lines.push(row);
    if (lines.length === 0) return [];

    const headers = lines[0].map(h => h.trim().toLowerCase());
    const data = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i];
      if (values.length < headers.length) continue;
      const obj: any = {};
      headers.forEach((header, idx) => {
        const val = values[idx] || '';
        if (header === 'rating') {
          obj[header] = parseFloat(val) || 0;
        } else if (header === 'release_year' || header === 'seasons' || header === 'episodes') {
          obj[header] = parseInt(val) || null;
        } else {
          obj[header] = val;
        }
      });
      data.push(obj);
    }
    return data;
  };

  const handleImportCSV = async (file: File) => {
    if (!user) {
      setToast("Please log in first to import.");
      return;
    }
    setIsImporting(true);
    setImportProgress(0);

    try {
      const text = await file.text();
      const records = parseCSV(text);
      if (records.length === 0) {
        setToast("No valid records found in CSV.");
        setIsImporting(false);
        return;
      }

      setImportTotal(records.length);

      const batchSize = 100;
      for (let i = 0; i < records.length; i += batchSize) {
        const chunk = records.slice(i, i + batchSize);
        const batch = writeBatch(db);

        chunk.forEach((rec) => {
          const movieDoc: any = {
            title: rec.title || 'Untitled',
            description: rec.description || '',
            trailer: rec.trailer || '',
            cast: rec.cast || '',
            director: rec.director || '',
            genre: rec.genre || 'Uncategorized',
            language: rec.language || 'en',
            rating: rec.rating || 0,
            release_year: rec.release_year || new Date().getFullYear(),
            poster: rec.poster || '',
            status: rec.status || 'list',
            media_type: rec.media_type || 'movie',
            added_at: rec.added_at || new Date().toISOString()
          };
          if (rec.seasons !== null && rec.seasons !== undefined) movieDoc.seasons = rec.seasons;
          if (rec.episodes !== null && rec.episodes !== undefined) movieDoc.episodes = rec.episodes;
          if (rec.tmdb_id) movieDoc.tmdb_id = parseInt(rec.tmdb_id) || null;
          if (rec.watch_providers) movieDoc.watch_providers = rec.watch_providers;

          const newDocRef = doc(collection(db, "users", user.uid, "movies"));
          batch.set(newDocRef, movieDoc);
        });

        await batch.commit();
        setImportProgress(Math.min(i + batchSize, records.length));
      }

      setToast(`Successfully imported ${records.length} movies!`);
      loadAllData(user.uid);
    } catch (e: any) {
      console.error(e);
      console.error('Error during Google login:', e);
      setAuthError('Google sign-in failed. Please try again.');
    } finally {
      setIsImporting(false);
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setAuthError('');
    setAuthSuccess('');
    const defaultEmail = authEmail || '';
    const emailPrompt = window.prompt("Enter your email address to reset password:", defaultEmail);

    if (!emailPrompt || !emailPrompt.trim()) {
      return;
    }

    try {
      await sendPasswordResetEmail(auth, emailPrompt.trim());
      setAuthError('');
      setAuthSuccess('Password reset email sent! Please check your inbox (and spam folder).');
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to send reset email.';
      setAuthError(errorMsg);
      setAuthSuccess('');
      setToast(errorMsg);
    }
  };

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  const getSavedMovie = (tmdb_id?: number, db_id?: string, title?: string) => {
    return movies.find(m =>
      (db_id && m.id === db_id) ||
      (tmdb_id && m.tmdb_id === tmdb_id) ||
      (title && m.title.toLowerCase().trim() === title.toLowerCase().trim())
    ) || null;
  };

  const isMovieSaved = (tmdb_id?: number, title?: string) => {
    if (tmdb_id) return !!getSavedMovie(tmdb_id);
    if (title) return !!getSavedMovie(undefined, undefined, title);
    return false;
  };

  const saveMovie = async (movie: Movie) => {
    if (!user) {
      setToast("Please log in to save movies.");
      return;
    }

    // Normalize title (TV shows use 'name' not 'title')
    if (!movie.title && (movie as any).name) {
      movie = { ...movie, title: (movie as any).name };
    }

    if (!movie.title) {
      setToast("Could not determine title. Please try again.");
      return;
    }

    const existing = getSavedMovie(movie.tmdb_id, undefined, movie.title);
    if (existing) {
      setToast(`"${movie.title}" is already in your vault.`);
      return;
    }

    const primaryGenre = (movie.genre || 'Uncategorized').split(',')[0].trim();
    const { id, ...dbPayload } = movie;
    const movieWithTimestamp = { ...dbPayload, added_at: new Date().toISOString(), status: movie.status || 'list' };

    // Strip invalid values — Firestore rejects them
    const cleanPayload = sanitizePayload(movieWithTimestamp);

    // Optimistic UI update
    setMovies(prev => [{ ...movie, added_at: movieWithTimestamp.added_at } as Movie, ...prev]);

    try {
      const docRef = await addDoc(collection(db, "users", user.uid, "movies"), cleanPayload);
      setMovies(prev => prev.map(m => {
        const matches = m.title.toLowerCase().trim() === movie.title.toLowerCase().trim();
        return matches ? { ...m, id: docRef.id } : m;
      }));
      setToast(`${movie.title} added to ${primaryGenre} genre`);
    } catch (e: any) {
      console.error("Cloud insert error:", e);
      setMovies(prev => prev.filter(m => m.title !== movie.title));
      setToast(`DB Error: Failed to save to vault.`);
    }
  };

  const updateStatus = async (movie: Movie, status: Movie['status']) => {
    if (!user) return;
    const saved = getSavedMovie(movie.tmdb_id, movie.id, movie.title);
    if (!saved || !saved.id) {
      await saveMovie({ ...movie, status });
      return;
    }

    const oldStatus = saved.status;
    setMovies(prev => prev.map(m => (m.id === saved.id ? { ...m, status } : m)));

    try {
      const docRef = doc(db, "users", user.uid, "movies", saved.id as string);
      await updateDoc(docRef, { status });
      setToast(`Moved to ${status.toUpperCase()}`);
    } catch (e: any) {
      console.error("Cloud update error:", e);
      setMovies(prev => prev.map(m => (m.id === saved.id ? { ...m, status: oldStatus } : m)));
      setToast("Failed to update database.");
    }

    if (selectedMovie) setSelectedMovie(prev => prev ? { ...prev, status } : null);
  };

  const updateGenre = async (movie: Movie, newGenre: string) => {
    if (!user) return;
    const saved = getSavedMovie(movie.tmdb_id, movie.id, movie.title);
    if (!saved || !saved.id) return;

    const oldGenre = saved.genre;
    setMovies(prev => prev.map(m => (m.id === saved.id ? { ...m, genre: newGenre } : m)));

    try {
      const docRef = doc(db, "users", user.uid, "movies", saved.id as string);
      await updateDoc(docRef, { genre: newGenre });
      setToast(`Genre: ${newGenre}`);
    } catch (e: any) {
      console.error("Cloud update error:", e);
      setMovies(prev => prev.map(m => (m.id === saved.id ? { ...m, genre: oldGenre } : m)));
      setToast("Failed to update database.");
    }
  };

  const handleDelete = async (movie: Movie) => {
    if (!user) return;
    const saved = getSavedMovie(movie.tmdb_id, movie.id, movie.title);
    if (!saved || !saved.id) return;

    const originalMovies = [...movies];
    setMovies(prev => prev.filter(m => m.id !== saved.id));

    if (selectedMovie && selectedMovie.id === saved.id) {
      setSelectedMovie(null);
    }

    try {
      const docRef = doc(db, "users", user.uid, "movies", saved.id as string);
      await deleteDoc(docRef);
      setToast("Removed from Cloud Vault");
    } catch (e: any) {
      console.error("Cloud delete error:", e);
      setMovies(originalMovies);
      setToast("Failed to delete from database.");
    }
  };

  const shareAsWatching = async (movie: Movie) => {
    if (!user) return;
    setShareOpinionModal({ movie, type: 'watching' });
  };

  const handleUpdatePersonal = async (m: Movie, rating: number, note: string) => {
    if (user) {
      const saved = getSavedMovie(m.tmdb_id, m.id, m.title);
      if (saved && saved.id) {
        await updateDoc(doc(db, "users", user.uid, "movies", saved.id), {
          userRating: rating,
          userNote: note
        });
        setToast("Opinion saved!");
        setMovies(prev => prev.map(old => old.id === saved.id ? { ...old, userRating: rating, userNote: note } : old));
      }
    }
  };

  const addToRecommended = async (movie: Movie) => {
    if (!user) return;
    try {
      const movieKey = movie.id || movie.tmdb_id?.toString() || movie.title.replace(/\s+/g, '_').toLowerCase();
      const ref = doc(db, "users", user.uid, "recommended", movieKey);
      const existing = await getDoc(ref);
      if (existing.exists()) {
        setToast(`"${movie.title}" is already in your recommended list!`);
        return;
      }
      setShareOpinionModal({ movie, type: 'recommended' });
    } catch (e: any) {
      console.error("Check recommended error:", e);
      setToast("Failed to check recommendations.");
    }
  };

  const storyGroups = useMemo(() => {
    if (!user) return {};
    const allowedUids = new Set([user.uid, ...friendsList.map(f => f.uid)]);
    const filtered = stories.filter(s => allowedUids.has(s.uid));

    const groups: { [uid: string]: any[] } = {};
    filtered.forEach(s => {
      if (!groups[s.uid]) groups[s.uid] = [];
      groups[s.uid].push(s);
    });
    return groups;
  }, [stories, user, friendsList]);

  const handleVoiceSearch = async () => {
    if (isVoiceActive) {
      stopVoiceSearch();
      return;
    }

    if (!process.env.API_KEY) {
      setToast("API Key is missing. Please configure your .env file.");
      return;
    }

    setIsVoiceActive(true);
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioCtxRef.current = audioCtx;
      outAudioCtxRef.current = outAudioCtx;
      nextStartTimeRef.current = 0;

      await audioCtx.resume();
      await outAudioCtx.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: MODELS.LIVE,
        callbacks: {
          onopen: () => {
            if (!audioCtxRef.current || !audioStreamRef.current) return;
            const source = audioCtxRef.current.createMediaStreamSource(audioStreamRef.current);
            audioSourceRef.current = source;
            const processor = audioCtxRef.current.createScriptProcessor(4096, 1, 1);
            audioProcessorRef.current = processor;
            processor.onaudioprocess = (e) => {
              try {
                const data = e.inputBuffer.getChannelData(0);
                const pcmBase64 = encodePCM(data);
                sessionPromise.then(session => {
                  if (session) {
                    session.sendRealtimeInput({
                      media: { data: pcmBase64, mimeType: 'audio/pcm;rate=16000' }
                    });
                  }
                }).catch(() => { });
              } catch (err) { console.error("PCM stream error:", err); }
            };
            source.connect(processor);
            processor.connect(audioCtxRef.current.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            const parts = msg.serverContent?.modelTurn?.parts;
            const audioPart = parts?.find(p => p.inlineData);
            const base64Audio = audioPart?.inlineData?.data;

            if (base64Audio && outAudioCtxRef.current) {
              const audioBuffer = await decodeAudioData(decode(base64Audio), outAudioCtxRef.current, 24000, 1);
              const source = outAudioCtxRef.current.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outAudioCtxRef.current.destination);
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outAudioCtxRef.current.currentTime);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
            }

            if (msg.serverContent?.inputTranscription) {
              const text = msg.serverContent.inputTranscription.text;
              if (text) {
                if (activeTabRef.current === 'find' && findModeRef.current === 'search') {
                  setSearchQuery(prev => {
                    const next = (prev + " " + text).trim();
                    handleSearch(next);
                    return next;
                  });
                } else if (activeTabRef.current === 'find' && findModeRef.current === 'ai') {
                  setAiInput(prev => (prev + " " + text).trim());
                } else if (activeTabRef.current === 'collection') {
                  setVaultSearch(prev => (prev + " " + text).trim());
                }
              }
            }
          },
          onclose: () => setIsVoiceActive(false),
          onerror: (err: any) => {
            console.error("Live Voice Error:", err);
            stopVoiceSearch();
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: "You are a movie vault assistant. Do not speak unless spoken to. Quietly transcribe the user's movie titles accurately."
        }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (err: any) {
      console.error("Voice Startup Failure:", err);
      setIsVoiceActive(false);
    }
  };

  const stopVoiceSearch = () => {
    if (sessionPromiseRef.current) {
      sessionPromiseRef.current.then(session => {
        if (session) try { session.close(); } catch (e) { }
      }).catch(() => { });
      sessionPromiseRef.current = null;
    }
    if (audioProcessorRef.current) {
      try { audioProcessorRef.current.disconnect(); } catch (e) { }
      audioProcessorRef.current = null;
    }
    if (audioSourceRef.current) {
      try { audioSourceRef.current.disconnect(); } catch (e) { }
      audioSourceRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
      audioStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => { });
      audioCtxRef.current = null;
    }
    if (outAudioCtxRef.current) {
      outAudioCtxRef.current.close().catch(() => { });
      outAudioCtxRef.current = null;
    }
    setIsVoiceActive(false);
  };

  const handleSearch = async (query: string) => {
    if (!query || query.length < 2) return;
    setIsSearching(true);
    try {
      const res = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.results && Array.isArray(data.results)) {
        setSearchResults(data.results.filter((r: any) => r.media_type === 'movie' || r.media_type === 'tv'));
      }
    } catch (e) { console.error(e); }
    finally { setIsSearching(false); }
  };

  const fetchMovieDetails = async (item: any) => {
    const mediaType = item.media_type || (item.title ? 'movie' : 'tv');
    const itemId = item.id || item.tmdb_id;
    if (!itemId || itemId === 'undefined' || itemId === 'null') {
      // Return a minimal object from what we already have
      return {
        title: item.title || item.name || 'Unknown',
        description: item.overview || '',
        trailer: '', cast: '', director: 'Unknown',
        genre: 'Uncategorized', language: 'en', rating: item.vote_average || 0,
        release_year: parseInt((item.release_date || item.first_air_date || '0000').substring(0, 4)),
        poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : '',
        status: 'list' as const, media_type: mediaType,
        added_at: new Date().toISOString(), tmdb_id: undefined, watch_providers: '[]',
        country: 'Unknown'
      };
    }
    try {
      let actualMediaType = mediaType;
      let res = await fetch(`https://api.themoviedb.org/3/${actualMediaType}/${itemId}?api_key=${TMDB_API_KEY}&append_to_response=credits,videos,watch/providers`);
      if (!res.ok && res.status === 404) {
        actualMediaType = actualMediaType === 'movie' ? 'tv' : 'movie';
        res = await fetch(`https://api.themoviedb.org/3/${actualMediaType}/${itemId}?api_key=${TMDB_API_KEY}&append_to_response=credits,videos,watch/providers`);
      }
      if (!res.ok) throw new Error(`TMDB ${res.status}`);
      const d = await res.json();
      const trailer = d.videos?.results?.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube');
      const flatrateProviders = d["watch/providers"]?.results?.US?.flatrate || [];
      const formattedProviders = flatrateProviders.map((p: any) => ({
        provider_name: p.provider_name,
        logo_path: p.logo_path
      }));
      const result: any = {
        title: d.title || d.name || item.title || item.name || 'Unknown',
        description: d.overview || '',
        trailer: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : '',
        cast: (d.credits?.cast || []).slice(0, 5).map((c: any) => c.name).join(', '),
        director: (d.credits?.crew || []).find((c: any) => c.job === 'Director')?.name || 'Unknown',
        genre: (d.genres || []).map((g: any) => g.name).join(', ') || 'Uncategorized',
        language: d.original_language || 'en',
        rating: d.vote_average || 0,
        release_year: parseInt((d.release_date || d.first_air_date || '0000').substring(0, 4)),
        poster: d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : '',
        status: 'list' as const,
        media_type: actualMediaType,
        added_at: new Date().toISOString(),
        tmdb_id: d.id,
        watch_providers: JSON.stringify(formattedProviders),
        country: (d.origin_country && d.origin_country[0]) || (d.production_countries && d.production_countries[0]?.iso_3166_1) || 'Unknown'
      };
      // Only add seasons/episodes if they are actual numbers (TV shows)
      if (typeof d.number_of_seasons === 'number') result.seasons = d.number_of_seasons;
      if (typeof d.number_of_episodes === 'number') result.episodes = d.number_of_episodes;
      return result;
    } catch (e) {
      console.error('fetchMovieDetails error:', e);
      // Fallback from raw item data
      return {
        title: item.title || item.name || 'Unknown',
        description: item.overview || '',
        trailer: '', cast: '', director: 'Unknown',
        genre: 'Uncategorized', language: 'en', rating: item.vote_average || 0,
        release_year: parseInt((item.release_date || item.first_air_date || '0000').substring(0, 4)),
        poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : '',
        status: 'list' as const, media_type: mediaType,
        added_at: new Date().toISOString(), tmdb_id: item.id || undefined, watch_providers: '[]'
      };
    }
  };

  const handlePreviewMovie = async (item: any) => {
    const tmdbId = item.id || item.tmdb_id;
    const saved = getSavedMovie(tmdbId, item.id, item.title || item.name);
    if (saved) {
      setSelectedMovie(saved);
      return;
    }
    const details = await fetchMovieDetails(item);
    setSelectedMovie(details);
  };

  useEffect(() => {
    if (vaultSearch.length > 2) {
      const timer = setTimeout(async () => {
        try {
          const res = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(vaultSearch)}`);
          const data = await res.json();
          const items = (data.results || []).filter((r: any) =>
            (r.media_type === 'movie' || r.media_type === 'tv') &&
            !isMovieSaved(r.id, r.title || r.name)
          );
          setVaultSuggestions(items.slice(0, 5));
        } catch (e) { console.error(e); }
      }, 500);
      return () => clearTimeout(timer);
    } else {
      setVaultSuggestions([]);
    }
  }, [vaultSearch, movies]);

  const uniqueGenres = useMemo(() => {
    const set = new Set<string>();
    movies.forEach(m => {
      const g = (m.genre || 'Uncategorized').split(',')[0].trim();
      if (g) set.add(g);
    });
    return Array.from(set).sort();
  }, [movies]);

  const uniqueProviders = useMemo(() => {
    const set = new Set<string>();
    movies.forEach(m => {
      if (m.watch_providers) {
        try {
          const list = JSON.parse(m.watch_providers);
          if (Array.isArray(list)) {
            list.forEach((p: any) => {
              if (p.provider_name) set.add(p.provider_name);
            });
          }
        } catch (e) { }
      }
    });
    return Array.from(set).sort();
  }, [movies]);

  const uniqueYears = useMemo(() => {
    const set = new Set<number>();
    movies.forEach(m => {
      if (m.release_year) set.add(m.release_year);
    });
    return Array.from(set).sort((a, b) => b - a); // Newest years first
  }, [movies]);

  const uniqueCountries = useMemo(() => {
    const set = new Set<string>();
    movies.forEach(m => {
      if (m.country && m.country !== 'Unknown') set.add(m.country);
    });
    return Array.from(set).sort();
  }, [movies]);

  const groupedMovies = useMemo<[string, Movie[]][]>(() => {
    let list = movies.filter(m => (m.status || 'list').toLowerCase() === filter.toLowerCase());

    // Apply filters
    if (filterGenre) {
      list = list.filter(m => (m.genre || '').toLowerCase().includes(filterGenre.toLowerCase()));
    }

    if (filterProvider) {
      list = list.filter(m => {
        if (m.watch_providers) {
          try {
            const providersList = JSON.parse(m.watch_providers);
            if (Array.isArray(providersList)) {
              return providersList.some((p: any) => p.provider_name?.toLowerCase() === filterProvider.toLowerCase());
            }
          } catch (e) { }
        }
        return false;
      });
    }

    if (filterYear) {
      list = list.filter(m => (m.release_year || 0).toString() === filterYear);
    }

    if (filterCountry) {
      list = list.filter(m => m.country === filterCountry);
    }

    if (filterMediaType) {
      list = list.filter(m => m.media_type === filterMediaType);
    }

    if (filterRating) {
      list = list.filter(m => (m.rating || 0) >= filterRating);
    }

    // Apply sorting
    list = [...list].sort((a, b) => {
      if (sortBy === 'added_at_desc') return new Date(b.added_at).getTime() - new Date(a.added_at).getTime();
      if (sortBy === 'added_at_asc') return new Date(a.added_at).getTime() - new Date(b.added_at).getTime();
      if (sortBy === 'title_asc') return a.title.localeCompare(b.title);
      if (sortBy === 'title_desc') return b.title.localeCompare(a.title);
      if (sortBy === 'rating_desc') return (b.rating || 0) - (a.rating || 0);
      if (sortBy === 'year_desc') return (b.release_year || 0) - (a.release_year || 0);
      return 0;
    });

    const groups = list.reduce((acc: Record<string, Movie[]>, movie) => {
      const genre = (movie.genre || 'Uncategorized').split(',')[0].trim() || 'Uncategorized';
      if (!acc[genre]) acc[genre] = [];
      acc[genre].push(movie);
      return acc;
    }, {});
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [movies, filter, filterGenre, filterProvider, filterYear, filterCountry, filterMediaType, filterRating, sortBy]);

  const filteredVault = useMemo(() => {
    if (!vaultSearch.trim()) return [];
    return movies.filter(m => m.title.toLowerCase().includes(vaultSearch.toLowerCase()));
  }, [movies, vaultSearch]);

  // TMDB Genre map for interest-based discovery
  const TMDB_GENRE_MAP: Record<string, number> = {
    'Action': 28, 'Comedy': 35, 'Sci-Fi': 878, 'Thriller': 53, 'Horror': 27,
    'Drama': 18, 'Romance': 10749, 'Anime': 16, 'Documentary': 99, 'Fantasy': 14
  };

  const fetchRecommendations = async () => {
    setIsLoadingRecs(true);
    try {
      const results: any[] = [];
      // Trending first
      const trendRes = await fetch(`https://api.themoviedb.org/3/trending/all/week?api_key=${TMDB_API_KEY}`);
      const trendData = await trendRes.json();
      const trending = (trendData.results || []).slice(0, 8).map((r: any) => ({ ...r, _section: 'trending' }));

      // Interest-based
      const interests = userProfile?.interests || [];
      const genreIds = interests.map(i => TMDB_GENRE_MAP[i]).filter(Boolean);
      let genreBased: any[] = [];
      if (genreIds.length > 0) {
        const page = Math.floor(Math.random() * 5) + 1;
        const genreRes = await fetch(`https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&with_genres=${genreIds.slice(0, 3).join(',')}&sort_by=popularity.desc&page=${page}`);
        const genreData = await genreRes.json();
        genreBased = (genreData.results || []).slice(0, 8).map((r: any) => ({ ...r, media_type: 'movie', _section: 'genre' }));
      }

      results.push(...trending, ...genreBased);
      setRecommendations(results);
    } catch (e) { console.error(e); }
    finally { setIsLoadingRecs(false); }
  };

  const askAi = async (prompt: string) => {
    if (!prompt.trim()) return;
    const apiKey = (import.meta as any).env?.VITE_API_KEY || (process as any).env?.API_KEY;
    if (!apiKey) {
      setToast("AI API Key missing. Add VITE_API_KEY to your .env file.");
      return;
    }

    // Daily limit check (2 per day for free plan)
    const today = new Date().toISOString().split('T')[0];
    let currentCount = aiDailyCount;
    let currentDate = aiDailyDate;

    if (user) {
      try {
        const usageRef = doc(db, "users", user.uid, "ai_usage", today);
        const usageSnap = await getDoc(usageRef);
        if (usageSnap.exists()) {
          currentCount = usageSnap.data().count || 0;
          currentDate = today;
        } else {
          currentCount = 0;
          currentDate = today;
        }
        setAiDailyCount(currentCount);
        setAiDailyDate(today);
      } catch { }
    }

    if (currentCount >= 2) {
      setToast("Daily AI limit reached (2/day on Free Plan). Try again tomorrow!");
      return;
    }

    setIsAiThinking(true);
    setAiHistory(prev => [...prev, { role: 'user', content: prompt }]);
    setAiInput('');
    const ai = new GoogleGenAI({ apiKey });
    try {
      const interests = userProfile?.interests?.join(', ') || 'movies';
      const response = await ai.models.generateContent({
        model: MODELS.TEXT,
        contents: `You are a movie recommendation AI. User interests: ${interests}. User asks: "${prompt}". Their vault: ${movies.map(m => m.title).join(', ')}. 
STRICT CONSTRAINTS: 
1. Only recommend content that directly matches the user's requested genre, keywords, year, or mood. If the user asks for a specific genre (e.g., horror), DO NOT recommend anything outside that genre. 
2. NEVER recommend adult, pornographic, or highly inappropriate content under any circumstances.
Respond helpfully and recommend 4-6 movies/shows. Return JSON: {reply: string, recommendations: [{title: string, tmdb_id: number, media_type: string}]}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: { type: Type.STRING },
              recommendations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: { title: { type: Type.STRING }, tmdb_id: { type: Type.NUMBER }, media_type: { type: Type.STRING } },
                  required: ["title", "tmdb_id", "media_type"]
                }
              }
            }
          }
        }
      });
      const data = JSON.parse(response.text || "{}");
      const richRecs = await Promise.all((data.recommendations || []).map(async (r: any) => {
        const res = await fetch(`https://api.themoviedb.org/3/${r.media_type}/${r.tmdb_id}?api_key=${TMDB_API_KEY}`);
        return res.json();
      }));
      setAiHistory(prev => [...prev, { role: 'model', content: data.reply || "Here are some suggestions:", results: richRecs }]);

      // Increment daily usage counter
      if (user) {
        try {
          const usageRef = doc(db, "users", user.uid, "ai_usage", today);
          await setDoc(usageRef, { count: currentCount + 1 }, { merge: true });
          setAiDailyCount(currentCount + 1);
          setAiDailyDate(today);
        } catch { }
      }
    } catch (e: any) {
      console.error(e);
      setToast("AI request failed. Check your API key and try again.");
      setAiHistory(prev => prev.slice(0, -1)); // remove the user message on error
    }
    finally { setIsAiThinking(false); }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditError('');
    if (!editUsername.trim()) {
      setEditError('Username cannot be empty.');
      return;
    }
    if (editUsername.trim().includes(' ')) {
      setEditError('Username cannot contain spaces.');
      return;
    }

    try {
      const lowerOld = userProfile?.username?.toLowerCase()?.trim() || "";
      const lowerNew = editUsername.toLowerCase().trim();

      const batch = writeBatch(db);
      const profileRef = doc(db, "users", user!.uid, "profile", "data");
      const newUsernameRef = doc(db, "usernames", lowerNew);

      if (lowerOld !== lowerNew) {
        const checkSnap = await getDoc(newUsernameRef);
        if (checkSnap.exists()) {
          setEditError('Username is already taken.');
          return;
        }
        batch.set(newUsernameRef, { uid: user!.uid, avatar: editAvatar, username: editUsername.trim() });
        if (lowerOld) {
          batch.delete(doc(db, "usernames", lowerOld));
        }
      } else {
        batch.set(newUsernameRef, { uid: user!.uid, avatar: editAvatar, username: editUsername.trim() });
      }

      const profileData = {
        username: editUsername.trim(),
        avatar: editAvatar,
        interests: userProfile?.interests || [],
        created_at: userProfile?.created_at || new Date().toISOString()
      };

      batch.set(profileRef, profileData);
      // Keep email lookup doc fresh
      if (user!.email) {
        const emailKey = user!.email.toLowerCase().trim().replace(/\./g, '_dot_');
        const emailRef = doc(db, "emails", emailKey);
        batch.set(emailRef, { uid: user!.uid, username: editUsername.trim() });
      }
      await batch.commit();

      const referralUid = localStorage.getItem('referral_uid');
      if (referralUid && (!userProfile || !userProfile.username)) {
        try {
          const notifId = `req_${user.uid}_${Date.now()}`;
          const reqRef = doc(db, "users", referralUid, "notifications", notifId);
          await setDoc(reqRef, {
            id: notifId,
            type: "friend_request",
            senderId: user.uid,
            senderUsername: editUsername.trim(),
            text: `${editUsername.trim()} sent you a friend request (from invite).`,
            time: new Date().toISOString(),
            read: false,
            timestamp: Date.now()
          });
          localStorage.removeItem('referral_uid');
        } catch (refErr) {
          console.error("Referral error:", refErr);
        }
      }

      setIsEditingProfile(false);
      setToast('Profile updated successfully!');
    } catch (err: any) {
      console.error(err);
      setEditError('Failed to save updates.');
    }
  };

  const handleSaveInterests = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !userProfile) return;
    if (editInterests.length === 0) {
      setToast('Please select at least one favorite genre.');
      return;
    }
    try {
      const profileRef = doc(db, "users", user.uid, "profile", "data");
      const profileData = {
        ...userProfile,
        interests: editInterests
      };
      await setDoc(profileRef, profileData);
      setIsEditingInterests(false);
      setToast('Interests updated successfully!');
    } catch (err: any) {
      console.error(err);
      setToast('Failed to save interests.');
    }
  };

  const handleAcceptFriend = async (notif: any) => {
    if (!user || !userProfile) return;
    try {
      const batch = writeBatch(db);

      const recFriendRef = doc(db, "users", user.uid, "friends", notif.senderId);
      batch.set(recFriendRef, {
        uid: notif.senderId,
        username: notif.senderUsername,
        avatar: notif.senderAvatar,
        status: "online",
        watching: "Nothing yet"
      });

      const recNotifRef = doc(db, "users", user.uid, "notifications", notif.id);
      batch.update(recNotifRef, {
        status: "accepted",
        read: true,
        text: `You accepted ${notif.senderUsername}'s friend request!`
      });

      const sendNotifRef = doc(db, "users", notif.senderId, "notifications", `accept_${user.uid}_${Date.now()}`);
      batch.set(sendNotifRef, {
        type: "friend_accepted",
        text: `${userProfile.username} accepted your friend request!`,
        senderId: user.uid,
        senderUsername: userProfile.username,
        senderAvatar: userProfile.avatar || null,
        time: new Date().toISOString(),
        read: false
      });

      await batch.commit();
      setToast(`You are now friends with ${notif.senderUsername}!`);
    } catch (e: any) {
      console.error(e);
      setToast("Failed to accept friend request.");
    }
  };

  const handleChangeEmail = async (newEmail: string) => {
    if (!user) return;
    try {
      await verifyBeforeUpdateEmail(user, newEmail);
      setToast("A verification email has been sent to your new email. Please verify it in your inbox/spam folder.");
      setIsChangeEmailOpen(false);
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/requires-recent-login') {
        throw new Error("Please sign out and sign in again before changing your email.");
      } else {
        throw new Error(err.message.replace("Firebase: ", ""));
      }
    }
  };

  const handleChangePassword = async (newPass: string) => {
    if (!user) return;
    try {
      await updatePassword(user, newPass);
      setToast("Password updated successfully.");
      setIsChangePasswordOpen(false);
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/requires-recent-login') {
        throw new Error("Please sign out and sign in again before changing your password.");
      } else {
        throw new Error(err.message.replace("Firebase: ", ""));
      }
    }
  };

  const handleExportData = async () => {
    if (!user) return;
    setToast("Preparing your data for export...");
    try {
      const getCollectionData = async (colName: string) => {
        const snap = await getDocs(collection(db, "users", user.uid, colName));
        return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      };

      const exportData = {
        movies: await getCollectionData("movies"),
        recommended: await getCollectionData("recommended"),
        friends: await getCollectionData("friends"),
        notifications: await getCollectionData("notifications")
      };

      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", "my_movie_tracker_data.json");
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
      setToast("Data exported successfully!");
    } catch (err: any) {
      console.error(err);
      setToast("Failed to export data: " + err.message);
    }
  };

  const handleDeleteAccount = async (reason: string) => {
    if (!user) return;
    try {
      try {
        await addDoc(collection(db, "account_deletions"), {
          uid: user.uid,
          email: user.email,
          reason: reason,
          deletedAt: new Date().toISOString()
        });
      } catch (e) {
        console.warn("Could not save deletion reason", e);
      }
      await deleteUser(user);
      setUser(null);
      setToast("Account successfully deleted. We're sorry to see you go.");
      setIsDeleteAccountOpen(false);
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/requires-recent-login') {
        setToast("Please sign out and sign in again before deleting your account.");
      } else {
        setToast(err.message.replace("Firebase: ", ""));
      }
    }
  };

  const handleDeclineFriend = async (notif: any) => {
    if (!user) return;
    try {
      const recNotifRef = doc(db, "users", user.uid, "notifications", notif.id);
      await updateDoc(recNotifRef, {
        status: "declined",
        read: true,
        text: `You declined ${notif.senderUsername}'s friend request.`
      });
      setToast("Friend request declined.");
    } catch (e: any) {
      console.error(e);
      setToast("Failed to decline friend request.");
    }
  };

  const navGlass = theme === 'dark' ? 'glass-dark' : 'glass-light';
  const tabBtnClass = (id: string) => `px-8 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest transition-all ${activeTab === id ? 'bg-indigo-600 text-white shadow-xl' : `${theme === 'dark' ? 'text-zinc-500 hover:text-white' : 'text-zinc-400 hover:text-indigo-600'}`}`;

  const displayedModalMovie = useMemo(() => {
    if (!selectedMovie) return null;
    const saved = getSavedMovie(selectedMovie.tmdb_id, selectedMovie.id, selectedMovie.title);
    return saved ? { ...selectedMovie, ...saved } : selectedMovie;
  }, [selectedMovie, movies]);

  const getStatusLabel = (status: Movie['status']) => {
    const labels = { list: 'To Watch', watching: 'Watching', watched: 'Watched', favorite: 'Favorite' };
    return labels[status] || 'Unknown';
  };

  const filterSelectClass = `w-full ${theme === 'dark' ? 'bg-black/40 border-white/10 text-zinc-300' : 'bg-zinc-50 border-zinc-200 text-slate-700'} border rounded-2xl px-4 py-2.5 outline-none focus:border-indigo-500 transition-colors text-sm tracking-wider`;
  const filterLabelClass = `text-sm font-black tracking-widest ${theme === 'dark' ? 'text-zinc-400' : 'text-slate-600'} mb-1.5 block ml-1`;

  if (authLoading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${theme === 'dark' ? 'bg-[#050505] text-zinc-300' : 'bg-[#f8fafc] text-slate-700'}`}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin"></div>
          <span className="text-sm font-black uppercase tracking-widest">Loading Vault...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    const glassAuth = theme === 'dark' ? 'glass-dark' : 'bg-white/80 border border-slate-200/60 shadow-2xl backdrop-blur-xl';
    const textAuth = theme === 'dark' ? 'text-zinc-100' : 'text-slate-950';
    const labelAuth = theme === 'dark' ? 'text-zinc-500' : 'text-slate-800';
    const inputAuth = `w-full px-5 py-4 rounded-2xl border ${theme === 'dark' ? 'bg-black/50 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'} outline-none focus:border-indigo-500 transition-colors text-sm font-semibold`;

    const handleAuthSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setAuthError('');
      setAuthSuccess('');
      if (!authEmail || !authPassword) {
        setAuthError('Email and password are required.');
        return;
      }

      if (authMode === 'signup') {
        if (authPassword !== authConfirmPassword) {
          setAuthError('Passwords do not match.');
          return;
        }
      }

      try {
        if (authMode === 'login') {
          await signInWithEmailAndPassword(auth, authEmail, authPassword);
        } else {
          await createUserWithEmailAndPassword(auth, authEmail, authPassword);
          setShowWelcomeScreen(true);
        }
      } catch (err: any) {
        console.error(err);
        setAuthError(err.message.replace("Firebase: ", ""));
      }
    };

    const handleGoogleAuth = async () => {
      setAuthError('');
      try {
        if (Capacitor.isNativePlatform()) {
          const result = await FirebaseAuthentication.signInWithGoogle({ useCredentialManager: false });
          if (result.credential) {
            const credential = GoogleAuthProvider.credential(result.credential.idToken, result.credential.accessToken);
            const userCred = await signInWithCredential(auth, credential);
            if (getAdditionalUserInfo(userCred)?.isNewUser) {
              setShowWelcomeScreen(true);
            }
          }
        } else {
          const userCred = await signInWithPopup(auth, googleProvider);
          if (getAdditionalUserInfo(userCred)?.isNewUser) {
            setShowWelcomeScreen(true);
          }
        }
      } catch (err: any) {
        if (err.code === 'auth/popup-blocked') {
          setAuthError('Popup was blocked by your browser. Please allow popups for this site, or use the Email & Password option above.');
        } else if (err.code === 'auth/popup-closed-by-user' || err.message?.includes('12501')) {
          setAuthError('Sign-in window was closed before completion.');
        } else {
          console.error(err);
          setAuthError(err.message.replace('Firebase: ', ''));
        }
      }
    };

    return (
      <div className={`min-h-screen flex items-center justify-center p-6 transition-colors duration-500 ${theme === 'dark' ? 'bg-[#050505]' : 'bg-[#f1f5f9]'}`}>
        <div className={`w-full max-w-md p-8 rounded-[40px] ${glassAuth} space-y-8 animate-in zoom-in-95 duration-300 relative overflow-hidden`}>
          <div className="absolute top-5 right-5 z-10">
            <button onClick={toggleTheme} className={`p-3 rounded-full transition-all shadow-lg ${theme === 'dark' ? 'bg-white/5 text-yellow-400 hover:bg-white/10' : 'bg-white border border-zinc-200 text-indigo-600 hover:bg-zinc-100'}`}>
              {theme === 'dark' ? <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z" /></svg> : <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58a.996.996 0 00-1.41 0 .996.996 0 000 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37a.996.996 0 00-1.41 0 .996.996 0 000 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96a.996.996 0 000-1.41.996.996 0 00-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36a.996.996 0 000-1.41.996.996 0 00-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z" /></svg>}
            </button>
          </div>
          <div className="text-center space-y-2">
            <img src="/logo.png" alt="Share Movies" className="w-16 h-16 rounded-3xl object-contain shadow-xl mx-auto" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            <h2 className={`text-3xl font-black font-questrial tracking-wide uppercase ${textAuth}`}>Share Movies</h2>
            <p className={`text-sm ${labelAuth} uppercase font-bold tracking-widest`}>Your Handy Movie Vault</p>
          </div>

          <form onSubmit={handleAuthSubmit} className="space-y-5">
            {authError && (
              <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-500 text-sm font-bold rounded-2xl text-center">
                {authError}
              </div>
            )}
            {authSuccess && (
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-sm font-bold rounded-2xl text-center">
                {authSuccess}
              </div>
            )}
            <div className="space-y-1.5">
              <label className={`text-sm font-black uppercase tracking-widest ${labelAuth} block ml-1`}>Email Address</label>
              <input type="email" className={inputAuth} placeholder="you@example.com" value={authEmail} onChange={e => setAuthEmail(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <label className={`text-sm font-black uppercase tracking-widest ${labelAuth} block ml-1`}>Password</label>
              <input type="password" className={inputAuth} placeholder="••••••••" value={authPassword} onChange={e => setAuthPassword(e.target.value)} />
            </div>

            {authMode === 'signup' && (
              <div className="space-y-1.5 animate-in slide-in-from-top-2 fade-in duration-300">
                <label className={`text-sm font-black uppercase tracking-widest ${labelAuth} block ml-1`}>Confirm Password</label>
                <input type="password" className={inputAuth} placeholder="••••••••" value={authConfirmPassword} onChange={e => setAuthConfirmPassword(e.target.value)} />
              </div>
            )}

            {authMode === 'login' && (
              <div className="flex justify-end mt-1 mb-4">
                <button type="button" onClick={handleForgotPassword} className="text-[10px] font-bold text-indigo-500 hover:text-indigo-400 uppercase tracking-wider">
                  Forgot Password?
                </button>
              </div>
            )}

            <button type="submit" className="w-full py-4.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-black uppercase tracking-[0.2em] shadow-lg shadow-indigo-600/20 transition-all active:scale-98 text-sm">
              {authMode === 'login' ? 'Sign In' : 'Get Started'}
            </button>
          </form>

          <div className="relative flex py-2 items-center">
            <div className={`flex-grow border-t ${theme === 'dark' ? 'border-white/5' : 'border-slate-200'}`}></div>
            <span className={`flex-shrink mx-4 text-[9px] font-black uppercase tracking-widest ${labelAuth}`}>or connect with</span>
            <div className={`flex-grow border-t ${theme === 'dark' ? 'border-white/5' : 'border-slate-200'}`}></div>
          </div>

          <button onClick={handleGoogleAuth} className={`w-full py-4 bg-transparent border ${theme === 'dark' ? 'border-white/10 hover:bg-white/5 text-white' : 'border-slate-200 hover:bg-slate-50 text-slate-700'} rounded-2xl flex items-center justify-center gap-3 transition-colors text-sm font-black uppercase tracking-wider`}>
            <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="currentColor" d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.114-5.136 4.114-3.555 0-6.44-2.885-6.44-6.44s2.885-6.44 6.44-6.44c1.633 0 3.125.61 4.27 1.615l3.076-3.076C19.123 2.259 15.82 1 12 1 5.925 1 12 5.925 1 12s4.925 11 11 11c5.55 0 10.25-4.015 10.25-10.25 0-.585-.05-1.16-.15-1.715h-9.86z" /></svg>
            Continue with Google
          </button>

          <div className="text-center">
            <button onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')} className={`text-sm font-black uppercase tracking-widest text-indigo-500 hover:text-indigo-400 transition-colors`}>
              {authMode === 'login' ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (showProfileSetup && user) {
    return (
      <UserProfileSetup
        theme={theme}
        onComplete={async (username, avatar, interests, dob, onError) => {
          try {
            const lowerUsername = username.toLowerCase().trim();
            const usernameRef = doc(db, "usernames", lowerUsername);
            const usernameSnap = await getDoc(usernameRef);
            if (usernameSnap.exists()) {
              onError("Username is already taken. Please choose another one.");
              return;
            }

            const profileData = {
              username,
              avatar,
              interests,
              dob,
              created_at: new Date().toISOString()
            };

            const batch = writeBatch(db);
            const profileRef = doc(db, "users", user.uid, "profile", "data");
            batch.set(profileRef, profileData);
            batch.set(usernameRef, { uid: user.uid, avatar, username });
            // Store email for email-based friend search
            if (user.email) {
              const emailKey = user.email.toLowerCase().trim().replace(/\./g, '_dot_');
              const emailRef = doc(db, "emails", emailKey);
              batch.set(emailRef, { uid: user.uid, username });
            }
            await batch.commit();

            setUserProfile(profileData);
            setShowProfileSetup(false);
            setToast("Welcome to Share Movies!");
          } catch (err: any) {
            console.error(err);
            onError("Failed to save profile. Please try again.");
          }
        }}
      />
    );
  }

  return (
    <div className="min-h-screen pb-24 sm:pb-0 selection:bg-indigo-500/30 transition-colors duration-500">
      {showWelcomeScreen && <WelcomeScreen onClose={() => { setShowWelcomeScreen(false); setActiveTab('collection'); }} />}
      {isChangeEmailOpen && (
        <ChangeEmailModal theme={theme} onClose={() => setIsChangeEmailOpen(false)} onUpdate={handleChangeEmail} />
      )}
      {isChangePasswordOpen && (
        <ChangePasswordModal theme={theme} onClose={() => setIsChangePasswordOpen(false)} onUpdate={handleChangePassword} />
      )}

      {isDeleteAccountOpen && (
        <DeleteAccountModal
          theme={theme}
          onClose={() => setIsDeleteAccountOpen(false)}
          onDelete={handleDeleteAccount}
        />
      )}
      {isImporting && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
          <div className={`p-8 rounded-[32px] ${theme === 'dark' ? 'glass-dark' : 'bg-white shadow-2xl'} max-w-sm w-full text-center space-y-4`}>
            <div className="w-12 h-12 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin mx-auto"></div>
            <h3 className={`text-lg font-black uppercase tracking-wider ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>Importing Vault</h3>
            <p className="text-sm text-zinc-500 font-bold uppercase tracking-widest">{importProgress} / {importTotal} Movies</p>
            <div className="w-full bg-zinc-800/10 h-1.5 rounded-full overflow-hidden">
              <div className="bg-indigo-600 h-full transition-all duration-300" style={{ width: `${(importProgress / importTotal) * 100}%` }}></div>
            </div>
          </div>
        </div>
      )}

      {/* Side Settings Drawer */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-[250] flex justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsDrawerOpen(false)}></div>
          <div className={`relative w-80 sm:w-96 h-full p-6 shadow-2xl flex flex-col justify-between overflow-y-auto no-scrollbar animate-in slide-in-from-right duration-300 ${theme === 'dark' ? 'bg-[#0f0f11] border-l border-white/5 text-white' : 'bg-white border-l border-slate-200 text-slate-800'}`}>
            <div className="space-y-8">
              <div className="flex justify-between items-center pb-4 border-b border-white/5">
                <h3 className="text-sm font-black uppercase tracking-widest text-indigo-500">Menu & Settings</h3>
                <button onClick={() => setIsDrawerOpen(false)} className={`p-2 rounded-xl ${theme === 'dark' ? 'hover:bg-white/5 text-zinc-400' : 'hover:bg-slate-100 text-slate-600'}`}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              {/* Profile Card Collapsible */}
              <div className="space-y-3">
                <div
                  onClick={() => setCollapseProfile(!collapseProfile)}
                  className={`flex justify-between items-center cursor-pointer select-none py-1.5 border-b ${theme === 'dark' ? 'border-white/5' : 'border-slate-200'}`}
                >
                  <h4 className={`text-sm font-black uppercase tracking-widest ${theme === 'dark' ? 'text-zinc-400' : 'text-indigo-600 font-extrabold'}`}>Profile Settings</h4>
                  <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${collapseProfile ? '' : 'rotate-180'} ${theme === 'dark' ? 'text-zinc-400' : 'text-indigo-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
                </div>

                {!collapseProfile && (
                  <div className="space-y-4 pt-1 animate-in fade-in duration-200">
                    {isEditingProfile ? (
                      <form onSubmit={handleSaveProfile} className="space-y-4">
                        {editError && (
                          <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-500 text-sm font-bold rounded-xl text-center">
                            {editError}
                          </div>
                        )}
                        <div className="space-y-1">
                          <label className={`text-sm font-black uppercase tracking-widest ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-500'} block ml-1`}>Username</label>
                          <input
                            className={`w-full px-3 py-2 border rounded-xl text-sm outline-none ${theme === 'dark' ? 'bg-black/50 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-800 focus:border-indigo-500'}`}
                            value={editUsername}
                            onChange={e => setEditUsername(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className={`text-sm font-black uppercase tracking-widest ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-500'} block ml-1`}>Avatar Preset or Photo Upload</label>
                          <div className="flex gap-2 items-center overflow-x-auto pb-1 no-scrollbar pt-1">
                            <label className={`flex-shrink-0 p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-center ${editAvatar?.startsWith('data:image') ? 'bg-indigo-600 border-transparent text-white' : `${theme === 'dark' ? 'bg-white/5 border-white/5 hover:bg-white/10 text-zinc-400' : 'bg-slate-100 border-slate-200 hover:bg-slate-200 text-slate-600'}`}`}>
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                              <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  const reader = new FileReader();
                                  reader.onloadend = () => {
                                    if (typeof reader.result === 'string') {
                                      const img = new window.Image();
                                      img.onload = () => {
                                        const canvas = document.createElement('canvas');
                                        const MAX = 600;
                                        let w = img.width, h = img.height;
                                        if (w > h) { if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; } }
                                        else { if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; } }
                                        canvas.width = w; canvas.height = h;
                                        const ctx = canvas.getContext('2d')!;
                                        ctx.drawImage(img, 0, 0, w, h);
                                        let quality = 0.85;
                                        let dataUrl = canvas.toDataURL('image/jpeg', quality);
                                        while (dataUrl.length > 700000 && quality > 0.3) {
                                          quality -= 0.1;
                                          dataUrl = canvas.toDataURL('image/jpeg', quality);
                                        }
                                        setEditAvatar(dataUrl);
                                      };
                                      img.src = reader.result as string;
                                    }
                                  };
                                  reader.readAsDataURL(file);
                                }
                              }} />
                            </label>
                            {['🍿', '🎬', '📺', '🕶️', '🚀', '🦊', '🪐', '👾', '🎨', '🎧'].map(av => (
                              <button
                                key={av}
                                type="button"
                                onClick={() => setEditAvatar(av)}
                                className={`flex-shrink-0 text-xl p-2.5 rounded-xl border transition-all ${editAvatar === av ? 'bg-indigo-600 border-transparent text-white shadow-md' : `${theme === 'dark' ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-slate-100 border-slate-200 hover:bg-slate-200 text-slate-600'}`}`}
                              >
                                {av}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-2 pt-2">
                          <button type="submit" className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-black uppercase tracking-wider shadow-md">Save</button>
                          <button type="button" onClick={() => setIsEditingProfile(false)} className={`flex-1 py-2.5 rounded-xl text-sm font-black uppercase tracking-wider ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10 text-zinc-300' : 'bg-slate-100 border border-slate-200 hover:bg-slate-200 text-slate-700'}`}>Cancel</button>
                        </div>
                      </form>
                    ) : (
                      <>
                        {userProfile && (
                          <div className={`p-4 rounded-[24px] ${theme === 'dark' ? 'bg-white/5' : 'bg-slate-50 border border-slate-100'} flex items-center gap-3`}>
                            {userProfile.avatar?.startsWith('data:image') || userProfile.avatar?.startsWith('http') ? (
                              <img src={userProfile.avatar} onClick={() => {
                                setViewProfilePicModal({ src: userProfile.avatar, username: userProfile.username });
                              }} className="w-12 h-12 rounded-full object-cover border border-indigo-500/20 cursor-pointer" alt="avatar" />
                            ) : (
                              <div onClick={() => {
                                if (userProfile) {
                                  setEditUsername(userProfile.username);
                                  setEditAvatar(userProfile.avatar);
                                  setEditInterests(userProfile.interests || []);
                                  setEditError('');
                                  setIsEditingProfile(true);
                                }
                              }} className="text-3xl bg-indigo-600/10 p-2 rounded-xl cursor-pointer">{userProfile.avatar}</div>
                            )}
                            <div className="overflow-hidden flex-1 min-w-0">
                              <h4 className={`font-black text-sm truncate uppercase tracking-wide ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{userProfile.username}</h4>
                              <p className={`text-[9px] ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-500'} truncate font-semibold`}>{user.email}</p>
                              {userProfile.dob && (
                                <p className={`text-[9px] ${theme === 'dark' ? 'text-zinc-600' : 'text-slate-400'} font-semibold`}>
                                  DOB: {new Date(userProfile.dob).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                                </p>
                              )}
                              <span className={`text-sm font-black uppercase tracking-widest ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600 font-extrabold'} block mt-0.5`}>Free Plan</span>
                            </div>
                          </div>
                        )}
                        <button
                          onClick={() => {
                            if (userProfile) {
                              setEditUsername(userProfile.username);
                              setEditAvatar(userProfile.avatar);
                              setEditInterests(userProfile.interests || []);
                              setEditError('');
                              setIsEditingProfile(true);
                            }
                          }}
                          className={`w-full py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10 text-zinc-300' : 'bg-slate-100 border border-slate-200 hover:bg-slate-200 text-slate-700'}`}
                        >
                          Edit Profile
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Theme Preferences Collapsible */}
              <div className="space-y-3">
                <div
                  onClick={() => setCollapseTheme(!collapseTheme)}
                  className={`flex justify-between items-center cursor-pointer select-none py-1.5 border-b ${theme === 'dark' ? 'border-white/5' : 'border-slate-200'}`}
                >
                  <h4 className={`text-sm font-black uppercase tracking-widest ${theme === 'dark' ? 'text-zinc-400' : 'text-indigo-600 font-extrabold'}`}>Theme Preferences</h4>
                  <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${collapseTheme ? '' : 'rotate-180'} ${theme === 'dark' ? 'text-zinc-400' : 'text-indigo-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
                </div>

                {!collapseTheme && (
                  <div className={`flex p-1 rounded-2xl ${theme === 'dark' ? 'bg-black/50' : 'bg-slate-100'} border ${theme === 'dark' ? 'border-white/5' : 'border-slate-200/60'} mt-1 animate-in fade-in duration-200`}>
                    <button onClick={() => setTheme('light')} className={`flex-1 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest transition-all ${theme === 'light' ? 'bg-white text-indigo-600 shadow-md' : 'text-zinc-500 hover:text-zinc-300'}`}>Light</button>
                    <button onClick={() => setTheme('dark')} className={`flex-1 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest transition-all ${theme === 'dark' ? 'bg-zinc-800 text-white shadow-md' : 'text-zinc-500 hover:text-zinc-700'}`}>Dark</button>
                  </div>
                )}
              </div>

              {/* My Interests Collapsible */}
              {userProfile && (
                <div className="space-y-3">
                  <div
                    onClick={() => setCollapseInterests(!collapseInterests)}
                    className={`flex justify-between items-center cursor-pointer select-none py-1.5 border-b ${theme === 'dark' ? 'border-white/5' : 'border-slate-200'}`}
                  >
                    <h4 className={`text-sm font-black uppercase tracking-widest ${theme === 'dark' ? 'text-zinc-400' : 'text-indigo-600 font-extrabold'}`}>My Interests</h4>
                    <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${collapseInterests ? '' : 'rotate-180'} ${theme === 'dark' ? 'text-zinc-400' : 'text-indigo-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
                  </div>

                  {!collapseInterests && (
                    <div className="space-y-3 pt-1 animate-in fade-in duration-200">
                      {isEditingInterests ? (
                        <form onSubmit={handleSaveInterests} className="space-y-3">
                          <div className="flex flex-wrap gap-1.5">
                            {['Action', 'Comedy', 'Sci-Fi', 'Thriller', 'Horror', 'Drama', 'Romance', 'Anime', 'Documentary', 'Fantasy'].map(g => {
                              const isSel = editInterests.includes(g);
                              return (
                                <button
                                  key={g}
                                  type="button"
                                  onClick={() => setEditInterests(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g])}
                                  className={`px-3 py-1.5 rounded-lg border text-sm font-black uppercase tracking-wider transition-all ${isSel ? 'bg-indigo-600 border-transparent text-white shadow-sm' : `${theme === 'dark' ? 'bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'}`}`}
                                >
                                  {g}
                                </button>
                              );
                            })}
                          </div>
                          <div className="flex gap-2">
                            <button type="submit" className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-black uppercase tracking-wider shadow-md">Save</button>
                            <button type="button" onClick={() => setIsEditingInterests(false)} className={`flex-1 py-2.5 rounded-xl text-sm font-black uppercase tracking-wider ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10 text-zinc-300' : 'bg-slate-100 border border-slate-200 hover:bg-slate-200 text-slate-700'}`}>Cancel</button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-1.5">
                            {(userProfile.interests || []).map(genre => (
                              <span key={genre} className={`text-sm font-black uppercase tracking-wider px-2.5 py-1 rounded-lg ${theme === 'dark' ? 'bg-white/5 text-zinc-300' : 'bg-indigo-50 text-indigo-700 border border-indigo-200/60 font-extrabold'}`}>{genre}</span>
                            ))}
                          </div>
                          <button
                            onClick={() => {
                              setEditInterests(userProfile.interests || []);
                              setIsEditingInterests(true);
                            }}
                            className={`w-full py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10 text-zinc-300' : 'bg-slate-100 border border-slate-200 hover:bg-slate-200 text-slate-700'}`}
                          >
                            Edit Interests
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Friends List Collapsible */}
              <div className="space-y-3">
                <div
                  onClick={() => setCollapseFriends(!collapseFriends)}
                  className={`flex justify-between items-center cursor-pointer select-none py-1.5 border-b ${theme === 'dark' ? 'border-white/5' : 'border-slate-200'}`}
                >
                  <h4 className={`text-sm font-black uppercase tracking-widest ${theme === 'dark' ? 'text-zinc-400' : 'text-indigo-600 font-extrabold'}`}>Friends List</h4>
                  <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${collapseFriends ? '' : 'rotate-180'} ${theme === 'dark' ? 'text-zinc-400' : 'text-indigo-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
                </div>

                {!collapseFriends && (
                  <div className="space-y-3 pt-1">
                    <div className="space-y-2 max-h-48 overflow-y-auto no-scrollbar">
                      {friendsList.map((friend: any) => (
                        <div key={friend.username} className={`flex items-center justify-between p-3 rounded-2xl ${theme === 'dark' ? 'bg-white/5' : 'bg-slate-50 border border-slate-100'}`}>
                          <div className="flex items-center gap-2.5 min-w-0">
                            {friend.avatar?.startsWith('data:image') ? (
                              <img src={friend.avatar} className="w-10 h-10 rounded-full object-cover border border-indigo-500/20" alt="avatar" />
                            ) : (
                              <span className="text-xl">{friend.avatar || '👤'}</span>
                            )}
                            <div className="min-w-0">
                              <h5 className={`font-bold text-sm truncate ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>{friend.username}</h5>
                              <p className={`text-[9px] ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-500'} truncate font-semibold`}>Watching {friend.watching || 'Nothing yet'}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                            <span className={`w-1.5 h-1.5 rounded-full ${friend.status === 'online' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]' : `${theme === 'dark' ? 'bg-zinc-600' : 'bg-slate-400'}`}`}></span>
                            <span className={`text-sm font-black uppercase tracking-wider ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-500'}`}>{friend.status}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <form onSubmit={async (e) => {
                      e.preventDefault();
                      const target = e.currentTarget.elements.namedItem('friendName') as HTMLInputElement;
                      if (!target || !target.value.trim() || !user || !userProfile) return;
                      const targetName = target.value.trim();

                      if (targetName.toLowerCase() === userProfile.username.toLowerCase()) {
                        setToast("You cannot add yourself!");
                        return;
                      }

                      setToast("Searching for user...");
                      try {
                        const lookupRef = doc(db, "usernames", targetName.toLowerCase());
                        const lookupSnap = await getDoc(lookupRef);
                        if (!lookupSnap.exists()) {
                          setToast(`User "${targetName}" does not exist!`);
                          return;
                        }
                        const friendData = lookupSnap.data();
                        const friendUid = friendData.uid;

                        const checkRef = doc(db, "users", user.uid, "friends", friendUid);
                        const checkSnap = await getDoc(checkRef);
                        if (checkSnap.exists()) {
                          setToast(`You are already friends with ${targetName}!`);
                          return;
                        }
  
                        const reqRef = doc(db, "users", friendUid, "notifications", `req_${user.uid}_${Date.now()}`);
                        await setDoc(reqRef, {
                          type: "friend_request",
                          senderId: user.uid,
                          senderUsername: userProfile.username,
                          senderAvatar: userProfile.avatar || null,
                          status: "pending",
                          text: `${userProfile.username} sent you a friend request!`,
                          time: new Date().toISOString(),
                          read: false
                        });

                        target.value = '';
                        setToast(`Friend request sent to ${targetName}!`);
                      } catch (err: any) {
                        console.error(err);
                        setToast("Failed to send request.");
                      }
                    }} className="flex gap-2 mt-2">
                      <input name="friendName" placeholder="Add friend by username..." className={`flex-grow px-3 py-2 border rounded-xl text-sm outline-none ${theme === 'dark' ? 'bg-black/50 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'} placeholder:text-zinc-500`} />
                      <button type="submit" className="px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-black uppercase tracking-wider">Add</button>
                    </form>
                  </div>
                )}
              </div>

              {/* Notification Settings Collapsible */}
              <div className="space-y-3">
                <div
                  onClick={() => setCollapseNotificationsPref(!collapseNotificationsPref)}
                  className={`flex justify-between items-center cursor-pointer select-none py-1.5 border-b ${theme === 'dark' ? 'border-white/5' : 'border-slate-200'}`}
                >
                  <h4 className={`text-sm font-black uppercase tracking-widest ${theme === 'dark' ? 'text-zinc-400' : 'text-indigo-600 font-extrabold'}`}>Notification Preferences</h4>
                  <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${collapseNotificationsPref ? '' : 'rotate-180'} ${theme === 'dark' ? 'text-zinc-400' : 'text-indigo-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
                </div>

                {!collapseNotificationsPref && (
                  <div className="space-y-4 pt-1 animate-in fade-in duration-200">
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          setNotifyFriendRequests(true);
                          setNotifyRecommended(true);
                          setNotifyWatching(true);
                          setNotifyNewStory(true);
                          setNotifyReleaseWatching(true);
                          setNotifyReleaseFavorites(true);
                          if (user) {
                            const ref = doc(db, "users", user.uid, "profile", "data");
                            await setDoc(ref, {
                              notificationPrefs: {
                                notify_friend_requests: true,
                                notify_recommended: true,
                                notify_watching: true,
                                notify_new_story: true,
                                notify_release_watching: true,
                                notify_release_favorites: true
                              }
                            }, { merge: true });
                          }
                          setToast("All notifications enabled!");
                        }}
                        className={`flex-1 py-1.5 rounded-lg text-sm font-black uppercase tracking-wider transition-all bg-indigo-600 text-white`}
                      >
                        All On
                      </button>
                      <button
                        onClick={async () => {
                          setNotifyFriendRequests(false);
                          setNotifyRecommended(false);
                          setNotifyWatching(false);
                          setNotifyNewStory(false);
                          setNotifyReleaseWatching(false);
                          setNotifyReleaseFavorites(false);
                          if (user) {
                            const ref = doc(db, "users", user.uid, "profile", "data");
                            await setDoc(ref, {
                              notificationPrefs: {
                                notify_friend_requests: false,
                                notify_recommended: false,
                                notify_watching: false,
                                notify_new_story: false,
                                notify_release_watching: false,
                                notify_release_favorites: false
                              }
                            }, { merge: true });
                          }
                          setToast("All notifications disabled!");
                        }}
                        className={`flex-1 py-1.5 rounded-lg text-sm font-black uppercase tracking-wider transition-all ${theme === 'dark' ? 'bg-white/5 text-zinc-300 border border-white/5' : 'bg-slate-100 border border-slate-200 text-slate-800'}`}
                      >
                        All Off
                      </button>
                    </div>

                    {[
                      { label: 'Friend requests', state: notifyFriendRequests, setState: setNotifyFriendRequests, key: 'notify_friend_requests' },
                      { label: 'Recommended movies from friends', state: notifyRecommended, setState: setNotifyRecommended, key: 'notify_recommended' },
                      { label: 'Currently watching from friends', state: notifyWatching, setState: setNotifyWatching, key: 'notify_watching' },
                      { label: 'New story from friends', state: notifyNewStory, setState: setNotifyNewStory, key: 'notify_new_story' },
                      { label: 'New release of watching', state: notifyReleaseWatching, setState: setNotifyReleaseWatching, key: 'notify_release_watching' },
                      { label: 'New release of favorites', state: notifyReleaseFavorites, setState: setNotifyReleaseFavorites, key: 'notify_release_favorites' }
                    ].map(pref => (
                      <div key={pref.key} className="flex justify-between items-center py-1">
                        <span className={`text-sm font-bold ${theme === 'dark' ? 'text-zinc-300' : 'text-slate-800'}`}>{pref.label}</span>
                        <button
                          onClick={() => {
                            const newVal = !pref.state;
                            pref.setState(newVal);
                            updateNotifyPref(pref.key, newVal);
                          }}
                          className={`w-9 h-5 rounded-full p-0.5 transition-colors flex items-center ${pref.state ? 'bg-indigo-600' : 'bg-zinc-700'}`}
                        >
                          <div className={`w-4 h-4 bg-white rounded-full transition-transform duration-200 ${pref.state ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Account Management Collapsible */}
              <div className="space-y-3">
                <div
                  onClick={() => setCollapseAccount(!collapseAccount)}
                  className={`flex justify-between items-center cursor-pointer select-none py-1.5 border-b ${theme === 'dark' ? 'border-white/5' : 'border-slate-200'}`}
                >
                  <h4 className={`text-sm font-black uppercase tracking-widest ${theme === 'dark' ? 'text-zinc-400' : 'text-indigo-600 font-extrabold'}`}>Account Management</h4>
                  <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${collapseAccount ? '' : 'rotate-180'} ${theme === 'dark' ? 'text-zinc-400' : 'text-indigo-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
                </div>

                {!collapseAccount && (
                  <div className="space-y-2 pt-1 animate-in fade-in duration-200">
                    <button onClick={() => { setIsDrawerOpen(false); setIsChangeEmailOpen(true); }} className={`w-full p-3 rounded-xl border flex items-center justify-between group transition-all ${theme === 'dark' ? 'bg-white/5 border-white/5 hover:bg-white/10 text-zinc-300' : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700'}`}>
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-sky-500/20 text-sky-500 group-hover:scale-110 transition-transform">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                        </div>
                        <span className="font-bold text-xs uppercase tracking-widest">Change Email</span>
                      </div>
                    </button>

                    <button onClick={() => { setIsDrawerOpen(false); setIsChangePasswordOpen(true); }} className={`w-full p-3 rounded-xl border flex items-center justify-between group transition-all ${theme === 'dark' ? 'bg-white/5 border-white/5 hover:bg-white/10 text-zinc-300' : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700'}`}>
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-500 group-hover:scale-110 transition-transform">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                        </div>
                        <span className="font-bold text-xs uppercase tracking-widest">Change Password</span>
                      </div>
                    </button>

                    <button onClick={() => { setIsDrawerOpen(false); handleExportData(); }} className={`w-full p-3 rounded-xl border flex items-center justify-between group transition-all ${theme === 'dark' ? 'bg-white/5 border-white/5 hover:bg-white/10 text-zinc-300' : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700'}`}>
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-500 group-hover:scale-110 transition-transform">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        </div>
                        <span className="font-bold text-xs uppercase tracking-widest">Export My Data</span>
                      </div>
                    </button>

                    <button onClick={() => {
                      setIsDrawerOpen(false);
                      setIsDeleteAccountOpen(true);
                    }} className={`w-full p-3 rounded-xl border flex items-center justify-between group transition-all ${theme === 'dark' ? 'bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20 text-rose-400' : 'bg-rose-50 border-rose-200 hover:bg-rose-100 text-rose-600'}`}>
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-rose-500/20 text-rose-500 group-hover:scale-110 transition-transform">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </div>
                        <span className="font-bold text-xs uppercase tracking-widest">Delete Account</span>
                      </div>
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className={`pt-6 border-t mt-8 ${theme === 'dark' ? 'border-white/5' : 'border-slate-200'} space-y-3`}>
              <button
                onClick={() => {
                  const url = `https://imaginative-sunburst-23abfd.netlify.app/?ref=${user?.uid}`;
                  navigator.clipboard.writeText(url);
                  setToast("Profile link copied! Share it with friends.");
                }}
                className="w-full py-3.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-500 rounded-2xl text-sm font-black uppercase tracking-[0.2em] transition-colors flex items-center justify-center gap-2 border border-indigo-500/20"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                Share Profile
              </button>

              <button onClick={async () => {
                if (confirm("Are you sure you want to sign out?")) {
                  if (Capacitor.isNativePlatform()) {
                    await FirebaseAuthentication.signOut();
                  }
                  signOut(auth);
                }
              }} className="w-full py-3.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 rounded-2xl text-sm font-black uppercase tracking-[0.2em] transition-colors flex items-center justify-center gap-2 border border-rose-500/20">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 01-3-3h4a3 3 0 013 3v1" /></svg>
                Sign Out
              </button>

              <footer className={`mt-8 py-4 text-center text-[11px] font-semibold tracking-wide ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-400'}`}>
                <p>
                  Created by <span onClick={() => Browser.open({ url: 'https://samuelalalade.com/about/' })} className={`cursor-pointer hover:underline transition-colors ${theme === 'dark' ? 'text-zinc-300' : 'text-slate-600'}`}>a.eskay</span> &copy; {new Date().getFullYear()}.
                </p>
                <p className="mt-1">
                  <span onClick={() => Browser.open({ url: 'https://imaginative-sunburst-23abfd.netlify.app/' })} className={`cursor-pointer hover:underline transition-colors ${theme === 'dark' ? 'text-zinc-400' : 'text-slate-500'}`}>Privacy Policy</span>
                </p>
              </footer>
            </div>
          </div>
        </div>
      )}

      <nav className={`${navGlass} sticky top-0 z-50 px-6 py-5 flex items-center justify-between border-b ${theme === 'dark' ? 'border-white/5' : 'border-zinc-200'}`}>
        <div className="flex items-center gap-4">
          <div>
            <h1 onClick={() => { setView('main'); setActiveTab('vault'); setIsDrawerOpen(false); }} className={`cursor-pointer text-xl font-bold font-questrial tracking-wide uppercase leading-none ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Share Movies</h1>
            <div className="flex items-center gap-2 mt-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]"></div>
              {userProfile && userProfile.avatar?.startsWith('data:image') ? (
                <img src={userProfile.avatar} className="w-3.5 h-3.5 rounded-full object-cover border border-white/10" alt="avatar" />
              ) : null}
              <p className={`text-sm font-black uppercase tracking-[0.1em] ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-500'}`}>
                {userProfile ? (userProfile.avatar?.startsWith('data:image') ? userProfile.username : `${userProfile.avatar} ${userProfile.username}`) : user.email}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 sm:gap-6">
          <div className="relative">
            <button onClick={() => { setIsNotificationsOpen(!isNotificationsOpen); setIsDrawerOpen(false); }} className={`p-2.5 rounded-2xl transition-all shadow-lg ${theme === 'dark' ? 'bg-white/5 text-zinc-300 hover:bg-white/10' : 'bg-zinc-100 text-slate-800 hover:bg-zinc-200 border border-zinc-200'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
            </button>
            {notifications.some(n => !n.read) && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-rose-500 rounded-full border-2 border-white dark:border-[#050505] animate-pulse"></span>
            )}
            {isNotificationsOpen && (
              <div className={`fixed sm:absolute left-4 right-4 sm:left-auto sm:right-0 top-20 sm:top-auto sm:mt-3 sm:w-80 rounded-3xl p-4 border shadow-2xl z-[120] animate-in zoom-in-95 duration-200 ${theme === 'dark' ? 'glass-dark border-white/10 text-white' : 'bg-white border-slate-200 text-slate-800'}`}>
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-sm font-black uppercase tracking-wider">Social Feed</h4>
                  <button onClick={async () => {
                    try {
                      const batch = writeBatch(db);
                      let count = 0;
                      notifications.filter(n => !n.read && !n.isMock).forEach(n => {
                        batch.update(doc(db, "users", user.uid, "notifications", n.id), { read: true });
                        count++;
                      });
                      if (count > 0) {
                        await batch.commit();
                      }
                      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
                      setToast("Marked all as read");
                    } catch (e) {
                      console.error("Failed to mark all as read:", e);
                      setToast("Failed to mark as read");
                    }
                  }} className="text-[9px] font-black uppercase text-indigo-500 hover:underline">Mark all read</button>
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto no-scrollbar">
                  {notifications.map(n => (
                    <div
                      key={n.id}
                      onClick={async () => {
                        if (n.isMock) {
                          setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
                          return;
                        }
                        try {
                          const docRef = doc(db, "users", user.uid, "notifications", n.id);
                          await updateDoc(docRef, { read: true });
                        } catch (e) { }
                      }}
                      className={`p-3 rounded-2xl text-sm transition-colors ${n.read ? (theme === 'dark' ? 'bg-white/5 text-zinc-400' : 'bg-slate-50 text-slate-600') : (theme === 'dark' ? 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20' : 'bg-indigo-50 text-indigo-900 border border-indigo-100')}`}
                    >
                      <p className="font-medium text-left">{n.text}</p>

                      {n.type === 'friend_request' && n.status === 'pending' && (
                        <div className="flex gap-2 mt-2 animate-in fade-in duration-200" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => handleAcceptFriend(n)}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[9px] font-black uppercase tracking-wider"
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => handleDeclineFriend(n)}
                            className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-500 rounded-lg text-[9px] font-black uppercase tracking-wider"
                          >
                            Decline
                          </button>
                        </div>
                      )}

                      <span className={`text-[9px] ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-400'} mt-1 block text-left`}>
                        {n.time && n.time.includes('T') ? new Date(n.time).toLocaleDateString() : n.time}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button onClick={() => { setIsDrawerOpen(true); setIsNotificationsOpen(false); }} className={`p-2.5 rounded-2xl transition-all shadow-lg ${theme === 'dark' ? 'bg-white/5 text-zinc-300 hover:bg-white/10' : 'bg-zinc-100 text-slate-800 hover:bg-zinc-200 border border-zinc-200'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <div className={`hidden sm:flex ${theme === 'dark' ? 'bg-white/5 border-white/5' : 'bg-zinc-100 border-zinc-200'} p-1.5 rounded-2xl border`}>
            {[{ id: 'collection', label: 'Vault' }, { id: 'find', label: 'Find' }, { id: 'friends', label: 'Friends' }, { id: 'board', label: 'Board' }].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id as any)} className={tabBtnClass(t.id)}>{t.label}</button>
            ))}
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto p-6 sm:p-12">
        {activeTab === 'collection' && (
          <div className="space-y-6 animate-in fade-in duration-700">
            {/* Stories Bar */}
            {userProfile && (() => {
              const myStories = storyGroups[user?.uid || ''] || [];
              const sortedFriends = friendsList
                .filter(friend => storyGroups[friend.uid]?.length > 0)
                .sort((a, b) => {
                  const aStories = storyGroups[a.uid] || [];
                  const bStories = storyGroups[b.uid] || [];
                  const aUnread = aStories.some(s => !viewedStoryIds.has(s.id));
                  const bUnread = bStories.some(s => !viewedStoryIds.has(s.id));
                  if (aUnread && !bUnread) return -1;
                  if (!aUnread && bUnread) return 1;
                  return 0;
                });

              return (
                <div className="relative max-w-xl mx-auto w-full">
                  <div className="absolute -top-4 left-0 min-w-max bg-indigo-500 text-white text-[10px] px-2 py-1 rounded-lg rounded-bl-none shadow-md z-10 text-center leading-tight pointer-events-none">
                    What are you<br />watching?
                  </div>
                  <div className="w-full flex gap-4 overflow-x-auto no-scrollbar py-2 px-1 border-b border-zinc-200/50 dark:border-white/5 pb-4">
                    {/* Add Story Circle */}
                    <div className="flex flex-col items-center gap-1.5 flex-shrink-0 cursor-pointer group relative" onClick={() => setIsCreateStoryOpen(true)}>
                      <div className="relative w-16 h-16 rounded-full p-[3px] border border-dashed border-zinc-300 dark:border-zinc-700 transition-all group-hover:scale-105">
                        <div className={`w-full h-full rounded-full overflow-hidden border-2 ${theme === 'dark' ? 'border-[#050505] bg-zinc-950' : 'border-white bg-slate-100'} flex items-center justify-center`}>
                          <svg className="w-6 h-6 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                        </div>
                      </div>
                      <span className={`text-[9px] font-black uppercase tracking-wider ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-700'} group-hover:text-indigo-500 transition-colors`}>Add Shot</span>
                    </div>

                    {/* My Story Circle (shown only if active stories exist) */}
                    {myStories.length > 0 && (
                      <div className="flex flex-col items-center gap-1.5 flex-shrink-0 cursor-pointer group" onClick={() => {
                        const allGroups = [myStories, ...sortedFriends.map(f => storyGroups[f.uid]).filter(g => g?.length > 0)];
                        setActiveStoryState({ groups: allGroups, startIndex: 0 });
                      }}>
                        <div className="relative w-16 h-16 rounded-full p-[3px] bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 transition-all group-hover:scale-105">
                          <div className={`w-full h-full rounded-full overflow-hidden border-2 ${theme === 'dark' ? 'border-[#050505] bg-zinc-950' : 'border-white bg-slate-100'}`}>
                            {userProfile.avatar?.startsWith('data:image') ? (
                              <img src={userProfile.avatar} className="w-full h-full object-cover" alt="avatar" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-xl font-bold bg-indigo-600/10 text-indigo-500">
                                {userProfile.avatar || '👤'}
                              </div>
                            )}
                          </div>
                        </div>
                        <span className={`text-[9px] font-black uppercase tracking-wider ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-700'} group-hover:text-indigo-500 transition-colors`}>My Story</span>
                      </div>
                    )}

                    {/* Friends Story Circles */}
                    {sortedFriends.map(friend => {
                      const friendStories = storyGroups[friend.uid];
                      const hasUnread = friendStories.some(s => !viewedStoryIds.has(s.id));
                      return (
                        <div key={friend.uid} className="flex flex-col items-center gap-1.5 flex-shrink-0 cursor-pointer group" onClick={() => {
                          const allGroups = myStories.length > 0 ? [myStories] : [];
                          const friendGroups = sortedFriends.map(f => storyGroups[f.uid]).filter(g => g?.length > 0);
                          allGroups.push(...friendGroups);
                          const startIndex = allGroups.findIndex(g => g === friendStories);
                          setActiveStoryState({ groups: allGroups, startIndex: startIndex !== -1 ? startIndex : 0 });
                        }}>
                          <div className={`relative w-16 h-16 rounded-full p-[3px] transition-all group-hover:scale-105 ${hasUnread ? 'bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 animate-pulse' : 'border border-zinc-200 dark:border-zinc-800'}`}>
                            <div className={`w-full h-full rounded-full overflow-hidden border-2 ${theme === 'dark' ? 'border-[#050505] bg-zinc-950' : 'border-white bg-slate-100'}`}>
                              {friend.avatar?.startsWith('data:image') ? (
                                <img src={friend.avatar} className="w-full h-full object-cover" alt="avatar" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-xl font-bold bg-purple-600/10 text-purple-500">
                                  {friend.avatar || '👤'}
                                </div>
                              )}
                            </div>
                          </div>
                          <span className={`text-[9px] font-black uppercase tracking-wider truncate max-w-[64px] ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-700'} group-hover:text-indigo-500 transition-colors`}>
                            {friend.displayName || friend.username}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            <div className="max-w-xl mx-auto w-full flex gap-3">
              <div className={`relative flex-1 flex items-center ${theme === 'dark' ? 'bg-white/5' : 'bg-white border border-zinc-200 shadow-sm'} rounded-3xl px-6 py-4 focus-within:ring-2 focus-within:ring-indigo-600/30 transition-all`}>
                <svg className={`w-5 h-5 ${theme === 'dark' ? 'text-zinc-500' : 'text-zinc-400'} mr-4`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <input
                  className="bg-transparent border-none outline-none w-full text-base font-medium placeholder:text-zinc-500"
                  placeholder="Find a movie/series"
                  value={vaultSearch}
                  onChange={(e) => setVaultSearch(e.target.value)}
                />
              </div>
              <button
                onClick={() => setIsManualAddOpen(true)}
                className={`p-4 rounded-3xl transition-all ${theme === 'dark' ? 'bg-white/5 text-indigo-400 hover:bg-white/10' : 'bg-white border border-zinc-200 text-indigo-600 shadow-sm hover:bg-zinc-50'}`}
                title="Manual Add"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
              </button>
            </div>

            {!vaultSearch ? (
              <>
                <div className="flex items-center gap-3 justify-between border-b border-zinc-200/50 dark:border-white/5 pb-3 w-full min-w-0">
                  <div className="flex-1 flex gap-1.5 overflow-x-auto no-scrollbar py-1 min-w-0 pr-6">
                    {([['list', 'To Watch'], ['watching', 'Watching'], ['watched', 'Watched'], ['favorite', 'Favorite']] as const).map(([s, label]) => (
                      <button key={s} onClick={() => setFilter(s)} className={`px-3 sm:px-5 py-2.5 rounded-2xl text-[9px] font-black uppercase tracking-widest transition-all whitespace-nowrap border ${filter === s ? 'bg-indigo-600 border-transparent text-white scale-[1.02] shadow-xl' : `${theme === 'dark' ? 'bg-white/5 border-white/5 text-zinc-400' : 'bg-white border-slate-200 text-slate-800 shadow-sm hover:text-indigo-600 hover:border-indigo-500/30'}`}`}>{label}</button>
                    ))}
                  </div>
                  <button
                    onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
                    className={`p-3 rounded-2xl transition-all flex items-center justify-center border flex-shrink-0 ${isFilterPanelOpen ? 'bg-indigo-600 border-transparent text-white shadow-lg' : `${theme === 'dark' ? 'bg-white/5 border-white/5 text-zinc-300 hover:text-white' : 'bg-white border-slate-200 text-slate-850 hover:text-indigo-600 shadow-sm'}`}`}
                    title="Filters"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
                    {(filterGenre || filterProvider || filterYear || filterMediaType || filterRating || sortBy !== 'added_at_desc') && (
                      <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full ml-1"></span>
                    )}
                  </button>
                </div>

                {isFilterPanelOpen && (
                  <div className={`p-6 rounded-3xl ${theme === 'dark' ? 'glass-dark border-white/5' : 'bg-white border-zinc-200 shadow-xl'} border grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-5 animate-in slide-in-from-top-2 duration-200`}>
                    <div>
                      <label className={filterLabelClass}>Genre</label>
                      <select className={filterSelectClass} value={filterGenre} onChange={(e) => setFilterGenre(e.target.value)}>
                        <option value="">All Genres</option>
                        {uniqueGenres.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={filterLabelClass}>Where to Watch</label>
                      <select className={filterSelectClass} value={filterProvider} onChange={(e) => setFilterProvider(e.target.value)}>
                        <option value="">All Streams</option>
                        {uniqueProviders.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={filterLabelClass}>Release Year</label>
                      <select className={filterSelectClass} value={filterYear} onChange={(e) => setFilterYear(e.target.value)}>
                        <option value="">All Years</option>
                        {uniqueYears.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={filterLabelClass}>Country</label>
                      <select className={filterSelectClass} value={filterCountry} onChange={(e) => setFilterCountry(e.target.value)}>
                        <option value="">All Countries</option>
                        {uniqueCountries.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={filterLabelClass}>Media Type</label>
                      <select className={filterSelectClass} value={filterMediaType} onChange={(e) => setFilterMediaType(e.target.value)}>
                        <option value="">All Types</option>
                        <option value="movie">Movie</option>
                        <option value="tv">TV Show</option>
                      </select>
                    </div>
                    <div>
                      <label className={filterLabelClass}>Min Rating</label>
                      <select className={filterSelectClass} value={filterRating || ''} onChange={(e) => setFilterRating(parseFloat(e.target.value) || 0)}>
                        <option value="">All Ratings</option>
                        <option value="8">★ 8.0+ Excellent</option>
                        <option value="7">★ 7.0+ Good</option>
                        <option value="6">★ 6.0+ Average</option>
                        <option value="5">★ 5.0+ Mediocre</option>
                      </select>
                    </div>
                    <div>
                      <label className={filterLabelClass}>Sort By</label>
                      <select className={filterSelectClass} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                        <option value="added_at_desc">Newest Added</option>
                        <option value="added_at_asc">Oldest Added</option>
                        <option value="title_asc">Title A-Z</option>
                        <option value="title_desc">Title Z-A</option>
                        <option value="rating_desc">Top Rated</option>
                        <option value="year_desc">Newest Released</option>
                      </select>
                    </div>
                    {(filterGenre || filterProvider || filterYear || filterCountry || filterMediaType || filterRating || sortBy !== 'added_at_desc') && (
                      <div className="col-span-2 sm:col-span-3 lg:col-span-7 flex justify-end">
                        <button
                          onClick={() => {
                            setFilterGenre('');
                            setFilterProvider('');
                            setFilterYear('');
                            setFilterCountry('');
                            setFilterMediaType('');
                            setFilterRating(0);
                            setSortBy('added_at_desc');
                          }}
                          className="px-6 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
                        >
                          Clear Filters
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-14">
                  {groupedMovies.length > 0 ? groupedMovies.map(([genre, list]) => (
                    <GenreGroup key={genre} genre={genre} movies={list} theme={theme} existingGenres={uniqueGenres} onMovieClick={setSelectedMovie} onUpdateStatus={updateStatus} onUpdateGenre={updateGenre} onDelete={handleDelete} onShareWatching={shareAsWatching} onAddToRecommended={addToRecommended} />
                  )) : (
                    <div className="py-40 text-center space-y-4 opacity-50">
                      <div className={`w-16 h-16 ${theme === 'dark' ? 'bg-white/5' : 'bg-zinc-100'} rounded-full flex items-center justify-center mx-auto mb-4`}>
                        <svg className={`w-8 h-8 ${theme === 'dark' ? 'text-zinc-700' : 'text-zinc-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </div>
                      <p className={`${theme === 'dark' ? 'text-zinc-500' : 'text-zinc-400'} font-bold italic`}>No items found in cloud.</p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-12 animate-in slide-in-from-top-4 duration-500">
                <div className="space-y-6">
                  <h3 className="text-sm font-black uppercase tracking-[0.3em] text-indigo-500 pl-2">Vault Results</h3>
                  {filteredVault.length > 0 ? (
                    <div className="grid grid-cols-1 gap-4">
                      {filteredVault.map(item => (
                        <div key={item.id || item.title} className={`${theme === 'dark' ? 'glass-dark border-white/5' : 'bg-white border-zinc-200 shadow-md'} p-4 rounded-3xl border flex gap-6 items-center group hover:border-indigo-500/40 transition-all cursor-pointer`} onClick={() => handlePreviewMovie(item)}>
                          <div className="w-16 h-20 rounded-xl overflow-hidden flex-shrink-0 bg-zinc-900 shadow-lg">
                            {item.poster && <img src={item.poster} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt="poster" />}
                          </div>
                          <div className="flex-1">
                            <h4 className={`font-black text-lg leading-tight tracking-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{item.title}</h4>
                            <div className="flex gap-2 mt-2">
                              <span className="bg-indigo-600/20 text-indigo-400 text-sm font-black uppercase px-2 py-1 rounded-md tracking-tighter border border-indigo-600/20">{getStatusLabel(item.status)}</span>
                            </div>
                            {(item.userRating || item.userNote) && (
                              <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-white/10 flex flex-col gap-1">
                                {item.userRating && (
                                  <div className="text-yellow-500 text-[10px] tracking-widest">
                                    {'★'.repeat(item.userRating)}{'☆'.repeat(5 - item.userRating)}
                                  </div>
                                )}
                                {item.userNote && (
                                  <p className={`text-[10px] font-semibold italic line-clamp-2 ${theme === 'dark' ? 'text-zinc-400' : 'text-slate-500'}`}>"{item.userNote}"</p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-zinc-500 text-sm italic pl-2">Nothing matching in database.</p>
                  )}
                </div>
                {vaultSuggestions.length > 0 && (
                  <div className="space-y-6 border-t border-white/5 pt-8">
                    <h3 className="text-sm font-black uppercase tracking-[0.3em] text-zinc-500 pl-2">Suggestions from Web</h3>
                    <div className="grid grid-cols-1 gap-4">
                      {vaultSuggestions.map(item => (
                        <div key={item.id} className={`${theme === 'dark' ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-zinc-50 border-zinc-200 hover:bg-zinc-100'} p-4 rounded-3xl border flex gap-6 items-center group transition-all`}>
                          <div className="w-16 h-20 rounded-xl overflow-hidden flex-shrink-0 bg-zinc-900 shadow-lg cursor-pointer" onClick={() => handlePreviewMovie(item)}>
                            <img src={getPosterUrl(item.poster_path, 200)} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt="poster" />
                          </div>
                          <div className="flex-1 cursor-pointer" onClick={() => handlePreviewMovie(item)}>
                            <h4 className={`font-black text-lg leading-tight tracking-tight ${theme === 'dark' ? 'text-zinc-300' : 'text-slate-700'}`}>{item.title || item.name}</h4>
                            <p className={`text-[9px] ${theme === 'dark' ? 'text-zinc-600' : 'text-zinc-400'} font-black uppercase mt-1`}>{item.release_date?.split('-')[0] || 'TBA'} • Not in Vault</p>
                          </div>
                          <button onClick={async () => { const details = await fetchMovieDetails(item); saveMovie(details); setVaultSearch(''); }} className={`${theme === 'dark' ? 'bg-indigo-600/20 text-indigo-400' : 'bg-indigo-50 text-indigo-600'} p-3 rounded-2xl transition-all shadow-sm`}>
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'find' && (
          <div className="max-w-2xl mx-auto space-y-6 animate-in slide-in-from-bottom-8 duration-700">
            {/* Sub-tab switcher */}
            <div className={`flex p-1 rounded-2xl ${theme === 'dark' ? 'bg-black/50 border border-white/5' : 'bg-white border border-slate-200 shadow-sm'}`}>
              <button
                onClick={() => setFindMode('search')}
                className={`flex-1 py-3 rounded-xl text-sm font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${findMode === 'search' ? 'bg-indigo-600 text-white shadow-lg' : `${theme === 'dark' ? 'text-zinc-500 hover:text-white' : 'text-zinc-400 hover:text-indigo-600'}`}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" /></svg>
                Search
              </button>
              <button
                onClick={() => { setFindMode('ai'); if (recommendations.length === 0) fetchRecommendations(); }}
                className={`flex-1 py-3 rounded-xl text-sm font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${findMode === 'ai' ? 'bg-indigo-600 text-white shadow-lg' : `${theme === 'dark' ? 'text-zinc-500 hover:text-white' : 'text-zinc-400 hover:text-indigo-600'}`}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" /></svg>
                Chat AI
                <span className={`text-sm px-1.5 py-0.5 rounded-full font-black ${findMode === 'ai' ? 'bg-white/20 text-white' : `${theme === 'dark' ? 'bg-white/5 text-zinc-500' : 'bg-slate-100 text-slate-500'}`}`}>{Math.max(0, 2 - aiDailyCount)}/2 left</span>
              </button>
            </div>

            {/* SEARCH MODE */}
            {findMode === 'search' && (
              <div className="space-y-8">
                <div className="relative">
                  <input
                    className={`w-full ${theme === 'dark' ? 'bg-zinc-900 border-white/10 text-white' : 'bg-white border-zinc-200 text-slate-800 shadow-lg'} border rounded-[32px] px-8 py-5 focus:ring-4 focus:ring-indigo-600/20 outline-none transition-all placeholder:text-zinc-400 text-lg font-medium`}
                    placeholder="Search movies, series..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      if (e.target.value.length > 1) handleSearch(e.target.value);
                    }}
                  />
                  {isSearching && (
                    <div className="absolute right-6 top-1/2 -translate-y-1/2">
                      <div className="w-5 h-5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                    </div>
                  )}
                </div>

                {/* Search results */}
                {searchResults.length > 0 && (
                  <div className="space-y-4 animate-in fade-in duration-300">
                    <h3 className="text-sm font-black uppercase tracking-[0.3em] text-indigo-500 pl-2">Search Results</h3>
                    <div className="grid grid-cols-1 gap-4">
                      {searchResults.map((item, idx) => (
                        <div key={item.id || `search-${idx}`} className={`${theme === 'dark' ? 'glass-dark border-white/5' : 'bg-white border-zinc-200 shadow-md'} p-5 rounded-[32px] border flex gap-6 items-center group transition-all`}>
                          <div className="w-16 h-24 rounded-2xl overflow-hidden flex-shrink-0 bg-zinc-900 shadow-lg cursor-pointer" onClick={() => handlePreviewMovie(item)}>
                            <img src={getPosterUrl(item.poster_path, 200)} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt="poster" />
                          </div>
                          <div className="flex-1 cursor-pointer" onClick={() => handlePreviewMovie(item)}>
                            <h4 className={`font-black text-lg leading-tight tracking-tight group-hover:text-indigo-500 transition-colors ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{item.title || item.name}</h4>
                            <p className={`text-[9px] font-black uppercase mt-1 ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-400'}`}>{(item.release_date || item.first_air_date || '').split('-')[0]} • {item.media_type === 'tv' ? 'Series' : 'Movie'}</p>
                          </div>
                          <button onClick={async () => { const details = await fetchMovieDetails(item); saveMovie(details); setActiveTab('collection'); }} className="p-3.5 rounded-2xl bg-indigo-600 text-white hover:bg-indigo-500 transition-all flex-shrink-0">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommendations */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between pl-2">
                    <div>
                      <h3 className={`text-sm font-black uppercase tracking-[0.3em] ${searchResults.length > 0 ? (theme === 'dark' ? 'text-zinc-500' : 'text-zinc-400') : 'text-indigo-500'}`}>
                        {searchResults.length > 0 ? 'You Might Also Like' : '✦ Recommended for You'}
                      </h3>
                      {userProfile?.interests && userProfile.interests.length > 0 && (
                        <p className={`text-[9px] mt-0.5 font-bold ${theme === 'dark' ? 'text-zinc-600' : 'text-slate-400'}`}>
                          Based on: {userProfile.interests.slice(0, 3).join(', ')}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={fetchRecommendations}
                      disabled={isLoadingRecs}
                      className={`p-2 rounded-xl transition-all ${theme === 'dark' ? 'hover:bg-white/5 text-zinc-500 hover:text-white' : 'hover:bg-slate-100 text-slate-400 hover:text-indigo-600'} ${isLoadingRecs ? 'animate-spin' : ''}`}
                      title="Refresh"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    </button>
                  </div>

                  {isLoadingRecs ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      {[...Array(8)].map((_, i) => (
                        <div key={i} className={`rounded-3xl overflow-hidden animate-pulse ${theme === 'dark' ? 'bg-white/5' : 'bg-slate-100'}`}>
                          <div className="aspect-[2/3]" />
                          <div className={`p-3 h-10 ${theme === 'dark' ? 'bg-white/3' : 'bg-slate-50'}`} />
                        </div>
                      ))}
                    </div>
                  ) : recommendations.length > 0 ? (
                    <>
                      {/* Trending section */}
                      {recommendations.filter(r => r._section === 'trending').length > 0 && (
                        <div className="space-y-3">
                          <p className={`text-sm font-black uppercase tracking-widest pl-1 ${theme === 'dark' ? 'text-zinc-600' : 'text-slate-400'}`}>🔥 Trending This Week</p>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {recommendations.filter(r => r._section === 'trending').map((item, idx) => (
                              <div key={item.id || `trending-${idx}`} className={`rounded-3xl overflow-hidden border transition-all shadow-sm hover:shadow-lg hover:scale-[1.02] cursor-pointer group ${theme === 'dark' ? 'bg-zinc-900 border-white/5' : 'bg-white border-zinc-200'}`} onClick={() => handlePreviewMovie(item)}>
                                <div className="aspect-[2/3] overflow-hidden">
                                  <img src={getPosterUrl(item.poster_path, 300)} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt="poster" />
                                </div>
                                <div className="p-3">
                                  <h5 className={`text-sm font-black uppercase truncate tracking-wider ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>{item.title || item.name}</h5>
                                  <button onClick={async (e) => { e.stopPropagation(); const d = await fetchMovieDetails({ ...item, media_type: item.media_type || (item.title ? 'movie' : 'tv') }); saveMovie(d); }} className="mt-2 w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-black rounded-xl uppercase tracking-widest shadow-sm transition-all">+ Vault</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Genre-based section */}
                      {recommendations.filter(r => r._section === 'genre').length > 0 && (
                        <div className="space-y-3 mt-6">
                          <p className={`text-sm font-black uppercase tracking-widest pl-1 ${theme === 'dark' ? 'text-zinc-600' : 'text-slate-400'}`}>🎯 Your Interests</p>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {recommendations.filter(r => r._section === 'genre').map((item, idx) => (
                              <div key={item.id || `genre-${idx}`} className={`rounded-3xl overflow-hidden border transition-all shadow-sm hover:shadow-lg hover:scale-[1.02] cursor-pointer group ${theme === 'dark' ? 'bg-zinc-900 border-white/5' : 'bg-white border-zinc-200'}`} onClick={() => handlePreviewMovie(item)}>
                                <div className="aspect-[2/3] overflow-hidden">
                                  <img src={getPosterUrl(item.poster_path, 300)} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt="poster" />
                                </div>
                                <div className="p-3">
                                  <h5 className={`text-sm font-black uppercase truncate tracking-wider ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>{item.title || item.name}</h5>
                                  <button onClick={async (e) => { e.stopPropagation(); const d = await fetchMovieDetails({ ...item, media_type: 'movie' }); saveMovie(d); }} className="mt-2 w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-black rounded-xl uppercase tracking-widest shadow-sm transition-all">+ Vault</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="py-16 text-center">
                      <button onClick={fetchRecommendations} className={`px-6 py-3 rounded-2xl text-sm font-black uppercase tracking-widest ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10 text-zinc-400' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'} transition-all`}>
                        Load Recommendations
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* AI CHAT MODE */}
            {findMode === 'ai' && (
              <div className={`h-[70vh] flex flex-col ${theme === 'dark' ? 'glass-dark border-white/5' : 'bg-white border-zinc-200 shadow-2xl'} rounded-[40px] overflow-hidden border`}>
                <div className="flex-1 overflow-y-auto p-6 space-y-8 no-scrollbar">
                  {aiHistory.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-5">
                      <div className={`w-20 h-20 rounded-[28px] ${theme === 'dark' ? 'bg-indigo-600/10' : 'bg-indigo-50'} flex items-center justify-center`}>
                        <svg className="w-10 h-10 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                      </div>
                      <div>
                        <h3 className={`text-xl font-black uppercase tracking-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Movie Oracle</h3>
                        <p className={`text-sm mt-1 ${theme === 'dark' ? 'text-zinc-500' : 'text-zinc-400'}`}>Ask me anything about movies & shows</p>
                      </div>
                      <div className={`flex gap-2 items-center px-4 py-2 rounded-full ${theme === 'dark' ? 'bg-white/5' : 'bg-slate-100'}`}>
                        <div className={`w-2 h-2 rounded-full ${aiDailyCount >= 2 ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                        <span className={`text-sm font-black uppercase tracking-widest ${theme === 'dark' ? 'text-zinc-400' : 'text-slate-500'}`}>
                          {Math.max(0, 2 - aiDailyCount)} of 2 AI asks remaining today
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-2 w-full max-w-sm">
                        {["What should I watch tonight?", `Recommend based on my ${userProfile?.interests?.[0] || 'favorite'} taste`, "Find me something like Interstellar"].map(suggestion => (
                          <button key={suggestion} onClick={() => askAi(suggestion)} disabled={aiDailyCount >= 2} className={`w-full px-4 py-3 rounded-2xl text-left text-sm font-semibold transition-all disabled:opacity-40 ${theme === 'dark' ? 'bg-white/5 hover:bg-indigo-600/20 text-zinc-300' : 'bg-slate-50 hover:bg-indigo-50 text-slate-600 border border-slate-200'}`}>
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {aiHistory.map((m, i) => (
                    <div key={i} className={`flex flex-col gap-4 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <div className={`p-5 rounded-[28px] max-w-[85%] text-sm font-semibold leading-relaxed shadow-lg ${m.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : `${theme === 'dark' ? 'bg-white/5 text-zinc-300' : 'bg-zinc-100 text-slate-700'} rounded-tl-none`}`}>{m.content}</div>
                      {m.results && (
                        <div className="flex gap-4 overflow-x-auto w-full no-scrollbar py-2">
                          {m.results.map((r: any, idx: number) => (
                            <div key={r.id || `ai-${idx}`} className={`${theme === 'dark' ? 'bg-zinc-900 border-white/5' : 'bg-white border-zinc-200'} min-w-[160px] rounded-[28px] overflow-hidden border transition-all shadow-md`}>
                              <img src={getPosterUrl(r.poster_path, 200)} className="aspect-[2/3] object-cover cursor-pointer" alt="poster" onClick={() => handlePreviewMovie(r)} />
                              <div className="p-3">
                                <h5 className={`text-[9px] font-black uppercase truncate tracking-wider ${theme === 'dark' ? 'text-white' : 'text-slate-700'}`}>{r.title || r.name}</h5>
                                <button onClick={async () => { const d = await fetchMovieDetails({ ...r, media_type: r.title ? 'movie' : 'tv' }); saveMovie(d); }} className="mt-2 w-full py-2.5 bg-indigo-600 text-white text-sm font-black rounded-xl uppercase tracking-widest shadow-lg shadow-indigo-600/20">+ Vault</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {isAiThinking && (
                    <div className="flex items-start gap-3">
                      <div className={`p-4 rounded-[28px] ${theme === 'dark' ? 'bg-white/5' : 'bg-zinc-100'} rounded-tl-none`}>
                        <div className="flex gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                          <div className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                          <div className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div className={`p-4 flex gap-3 items-center ${theme === 'dark' ? 'bg-black/40 border-white/5' : 'bg-zinc-50 border-zinc-200'} border-t`}>
                  {aiDailyCount >= 2 ? (
                    <div className={`flex-1 px-6 py-4 rounded-3xl text-center text-sm font-bold ${theme === 'dark' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-rose-50 text-rose-500 border border-rose-100'}`}>
                      🔒 Daily limit reached. 2 AI chats per day on Free Plan.
                    </div>
                  ) : (
                    <>
                      <input
                        className={`flex-1 ${theme === 'dark' ? 'bg-zinc-900 border-white/5 text-white' : 'bg-white border-zinc-200 text-slate-800'} border rounded-3xl px-6 py-4 focus:ring-4 focus:ring-indigo-600/10 outline-none transition-all placeholder:text-zinc-500 text-sm`}
                        placeholder={`Ask the Oracle... (${2 - aiDailyCount} left today)`}
                        value={aiInput}
                        onChange={(e) => setAiInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !isAiThinking) askAi(aiInput); }}
                        disabled={isAiThinking}
                      />
                      <button
                        onClick={() => askAi(aiInput)}
                        disabled={isAiThinking || !aiInput.trim()}
                        className="p-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl transition-all disabled:opacity-40 flex-shrink-0"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 12h14M12 5l7 7-7 7" /></svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'friends' && (() => {
          // Friend card component defined inline for state isolation per card
          const FriendCard = ({ friend, isMe }: { friend: any; isMe?: boolean }) => {
            const [isExpanded, setIsExpanded] = useState(false);
            const [friendProfile, setFriendProfile] = useState<any>({
              username: friend.username || "",
              avatar: friend.avatar || "👤",
              displayName: friend.displayName || friend.username || ""
            });
            const [sharedWatching, setSharedWatching] = useState<any>(null);
            const [recommendedMovies, setRecommendedMovies] = useState<any[]>([]);
            const [recommendedCount, setRecommendedCount] = useState<number>(0);
            const [activeRecMenuId, setActiveRecMenuId] = useState<string | null>(null);

            useEffect(() => {
              if (!friend.uid) return;

              // Subscribe to profile (keeps username & avatar fresh in real-time)
              const profileRef = doc(db, "users", friend.uid, "profile", "data");
              const unsubProfile = onSnapshot(profileRef, (snap) => {
                if (snap.exists()) {
                  setFriendProfile(snap.data());
                }
              });

              // Subscribe to shared watching status (keeps header & body fresh)
              const watchRef = doc(db, "users", friend.uid, "shared_watching", "current");
              const unsubWatch = onSnapshot(watchRef, (snap) => {
                setSharedWatching(snap.exists() ? snap.data() : null);
              });
              {/* Subscribe to recommended movies (keeps grid & count fresh) */ }
              const recsRef = collection(db, "users", friend.uid, "recommended");
              const unsubRecs = onSnapshot(recsRef, (snap) => {
                setRecommendedCount(snap.size);
                const recs: any[] = [];
                snap.forEach(d => recs.push({ id: d.id, ...d.data() }));
                setRecommendedMovies(recs);
              });

              return () => {
                unsubProfile();
                unsubWatch();
                unsubRecs();
              };
            }, [friend.uid]);

            return (
              <div className={`rounded-[28px] border transition-all ${isMe ? (theme === 'dark' ? 'bg-indigo-950/20 border-indigo-500/30' : 'bg-indigo-50/50 border-indigo-100') : (theme === 'dark' ? 'bg-white/3 border-white/5' : 'bg-white border-slate-100 shadow-sm')}`}>
                {/* Collapsed header */}
                <div className="w-full p-5 flex items-center gap-4 text-left relative">
                  <div className="flex-shrink-0">
                    {friendProfile.avatar?.startsWith('data:image') ? (
                      <img src={friendProfile.avatar} onClick={() => setViewProfilePicModal({ src: friendProfile.avatar, username: friendProfile.username || friendProfile.displayName })} className="w-12 h-12 rounded-full object-cover border-2 border-indigo-500/30 cursor-pointer hover:scale-105 transition-transform" alt="avatar" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center text-2xl border border-indigo-500/20 cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
                        {friendProfile.avatar || '👤'}
                      </div>
                    )}
                  </div>

                  <div className="flex-grow min-w-0 cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
                    <div className="flex items-center gap-2">
                      <h5 className={`font-black text-sm truncate ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>
                        {friendProfile.displayName || friendProfile.username}
                      </h5>
                      {isMe && (
                        <span className="px-2 py-0.5 bg-indigo-600 text-white rounded-md text-[7px] font-black uppercase tracking-widest">You</span>
                      )}
                    </div>
                    <p className={`text-sm font-semibold truncate ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-400'}`}>
                      @{friendProfile.username}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5">
                      {sharedWatching ? (
                        <span className={`flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-amber-500`}>
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l-3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          {sharedWatching.title}
                        </span>
                      ) : (
                        <span className={`text-[9px] font-bold ${theme === 'dark' ? 'text-zinc-600' : 'text-slate-300'}`}>Not sharing anything</span>
                      )}
                      {recommendedCount > 0 && (
                        <span className={`flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-indigo-400`}>
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" /></svg>
                          {recommendedCount} recommended
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex-shrink-0 flex items-center gap-2">
                    <button onClick={() => setIsExpanded(!isExpanded)} className={`p-1.5 ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-400'} transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    {!isMe && (
                      <div className="relative">
                         <button onClick={(e) => { e.stopPropagation(); setActiveRecMenuId(activeRecMenuId === `friendMenu-${friend.uid}` ? null : `friendMenu-${friend.uid}`); }} className={`p-1.5 rounded-full ${theme === 'dark' ? 'text-zinc-400 hover:bg-white/5' : 'text-slate-400 hover:bg-slate-100'}`}>
                           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v.01M12 12v.01M12 19v.01" /></svg>
                         </button>
                         {activeRecMenuId === `friendMenu-${friend.uid}` && (
                           <div className={`absolute right-0 top-full mt-2 w-48 rounded-2xl shadow-xl border z-50 overflow-hidden ${theme === 'dark' ? 'bg-[#18181b] border-white/10' : 'bg-white border-slate-200'}`}>
                              <button onClick={async (e) => {
                                e.stopPropagation();
                                setActiveRecMenuId(null);
                                setConfirmModal({
                                  title: "Remove Friend",
                                  message: `Are you sure you want to remove ${friendProfile.username} from your friends?`,
                                  onConfirm: async () => {
                                    try {
                                      await deleteDoc(doc(db, "users", user.uid, "friends", friend.uid));
                                      await setDoc(doc(db, "users", friend.uid, "notifications", `remove_${user.uid}`), {
                                        type: "friend_removed",
                                        senderId: user.uid,
                                        time: new Date().toISOString(),
                                        read: false
                                      });
                                      setToast("Friend removed.");
                                    } catch(err) { console.error(err); setToast("Failed to remove friend."); }
                                    setConfirmModal(null);
                                  }
                                });
                              }} className={`w-full text-left px-4 py-3 text-sm font-bold ${theme === 'dark' ? 'text-zinc-300 hover:bg-white/5' : 'text-slate-700 hover:bg-slate-50'}`}>Remove Friend</button>
                              <button onClick={async (e) => {
                                e.stopPropagation();
                                setActiveRecMenuId(null);
                                setConfirmModal({
                                  title: "Block User",
                                  message: `Are you sure you want to block ${friendProfile.username}? They will be removed from your friends and you won't see them anymore.`,
                                  onConfirm: async () => {
                                    try {
                                      const newBlocked = [...(userProfile?.blockedUsers || []), friend.uid];
                                      await updateDoc(doc(db, "users", user.uid, "profile", "data"), { blockedUsers: newBlocked });
                                      await deleteDoc(doc(db, "users", user.uid, "friends", friend.uid));
                                      await setDoc(doc(db, "users", friend.uid, "notifications", `remove_${user.uid}`), {
                                        type: "friend_removed",
                                        senderId: user.uid,
                                        time: new Date().toISOString(),
                                        read: false
                                      });
                                      setToast("User blocked.");
                                    } catch(err) { console.error(err); setToast("Failed to block user."); }
                                    setConfirmModal(null);
                                  }
                                });
                              }} className={`w-full text-left px-4 py-3 text-sm font-bold ${theme === 'dark' ? 'text-rose-400 hover:bg-rose-500/10' : 'text-rose-600 hover:bg-rose-50'}`}>Block User</button>
                              <button onClick={async (e) => {
                                e.stopPropagation();
                                setActiveRecMenuId(null);
                                setConfirmModal({
                                  title: "Report User",
                                  message: `Report ${friendProfile.username} for inappropriate content?`,
                                  onConfirm: async () => {
                                    try {
                                      await addDoc(collection(db, "reports"), {
                                        reporter_uid: user.uid,
                                        reported_uid: friend.uid,
                                        type: "user",
                                        timestamp: new Date().toISOString()
                                      });
                                      setToast("User reported. Thank you.");
                                    } catch(err) { console.error(err); setToast("Failed to submit report."); }
                                    setConfirmModal(null);
                                  }
                                });
                              }} className={`w-full text-left px-4 py-3 text-sm font-bold ${theme === 'dark' ? 'text-rose-400 hover:bg-rose-500/10' : 'text-rose-600 hover:bg-rose-50'}`}>Report User</button>
                           </div>
                         )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Expanded view */}
                {isExpanded && (
                  <div className={`border-t ${theme === 'dark' ? 'border-white/5' : 'border-slate-100'} p-5 space-y-6 animate-in slide-in-from-top-2 duration-300`}>
                    {/* Shared Watching */}
                    <div>
                      <h6 className={`text-sm font-black uppercase tracking-widest mb-3 ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-400'}`}>Currently Watching</h6>
                      {sharedWatching ? (
                        <div className={`flex gap-4 p-4 rounded-2xl relative group cursor-pointer ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10' : 'bg-slate-50 border border-slate-100 hover:shadow-md'} transition-all`} onClick={() => handlePreviewMovie(sharedWatching)}>
                          {sharedWatching.poster ? (
                            <img src={sharedWatching.poster} className="w-20 h-28 rounded-xl object-cover flex-shrink-0 shadow-lg hover:scale-105 transition-transform duration-300" alt={sharedWatching.title} />
                          ) : (
                            <div className={`w-20 h-28 rounded-xl flex-shrink-0 flex items-center justify-center text-2xl ${theme === 'dark' ? 'bg-white/10' : 'bg-slate-200'}`}>🎬</div>
                          )}
                          <div className="min-w-0 flex-grow flex flex-col justify-center">
                            <div className="flex justify-between items-start gap-4">
                              <div>
                                <h4 className={`font-black text-sm leading-tight ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>{sharedWatching.title}</h4>
                                <p className={`text-sm font-semibold mb-2 ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-400'}`}>{sharedWatching.release_year || ''} {sharedWatching.genre ? `• ${sharedWatching.genre}` : ''}</p>
                              </div>
                              <div className="flex-shrink-0">
                                {isMe ? (
                                  <button
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      setConfirmModal({
                                        title: "Remove Watching Status",
                                        message: `Are you sure you want to stop sharing "${sharedWatching.title}" as your currently watching status?`,
                                        onConfirm: async () => {
                                          try {
                                            const ref = doc(db, "users", user.uid, "shared_watching", "current");
                                            await deleteDoc(ref);
                                            setSharedWatching(null);
                                            setToast("Removed watching status.");
                                          } catch (err) {
                                            console.error("Failed to delete watching status:", err);
                                          } finally {
                                            setConfirmModal(null);
                                          }
                                        }
                                      });
                                    }}
                                    className="px-4 py-2 bg-rose-600/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/20 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                                  >
                                    Remove
                                  </button>
                                ) : (
                                  <div className="flex flex-col gap-2 items-end">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const movieToAdd = {
                                          title: sharedWatching.title,
                                          poster: sharedWatching.poster || '',
                                          genre: sharedWatching.genre || 'Uncategorized',
                                          release_year: sharedWatching.release_year || 0,
                                          description: sharedWatching.description || '',
                                          rating: sharedWatching.rating || 0,
                                          tmdb_id: sharedWatching.tmdb_id,
                                          media_type: sharedWatching.media_type || 'movie',
                                          status: 'list' as const,
                                          trailer: '', cast: '', director: '', language: 'English',
                                          added_at: new Date().toISOString()
                                        };
                                        saveMovie(movieToAdd);
                                      }}
                                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all w-full"
                                    >
                                      + Vault
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setConfirmModal({
                                          title: "Report Status",
                                          message: `Report this watching status from ${friendProfile.username} for inappropriate content?`,
                                          onConfirm: async () => {
                                            try {
                                              await addDoc(collection(db, "reports"), {
                                                reporter_uid: user.uid,
                                                reported_uid: friend.uid,
                                                type: "status",
                                                content: sharedWatching,
                                                timestamp: new Date().toISOString()
                                              });
                                              setToast("Content reported. Thank you.");
                                            } catch(err) { console.error(err); setToast("Failed to submit report."); }
                                            setConfirmModal(null);
                                          }
                                        });
                                      }}
                                      className="px-4 py-1 bg-transparent hover:bg-rose-500/10 text-rose-500 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all w-full text-right"
                                    >
                                      Report
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div>
                              {sharedWatching.userRating ? (
                                <div className="flex items-center gap-1.5 mb-1">
                                  <span className={`text-[9px] font-black uppercase ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-400'}`}>{isMe ? 'Your' : `${friendProfile.username}'s`} Rating:</span>
                                  <div className="flex text-amber-400 text-[10px]">
                                    {'★'.repeat(sharedWatching.userRating)}{'☆'.repeat(5 - sharedWatching.userRating)}
                                  </div>
                                </div>
                              ) : null}
                              {sharedWatching.userNote ? (
                                <div>
                                  <span className={`text-[9px] font-black uppercase ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-400'}`}>{isMe ? 'Your' : `${friendProfile.username}'s`} Comment:</span>
                                  <p className={`text-sm italic leading-relaxed line-clamp-2 ${theme === 'dark' ? 'text-zinc-300' : 'text-slate-600'}`}>"{sharedWatching.userNote}"</p>
                                </div>
                              ) : sharedWatching.description ? (
                                <p className={`text-sm leading-relaxed line-clamp-2 ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-400'}`}>{sharedWatching.description}</p>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className={`text-sm italic ${theme === 'dark' ? 'text-zinc-600' : 'text-slate-300'}`}>Not sharing anything right now.</p>
                      )}
                    </div>

                    {/* Recommendations */}
                    <div>
                      <h6 className={`text-sm font-black uppercase tracking-widest mb-3 ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-400'}`}>
                        Recommended {recommendedMovies.length > 0 ? `(${recommendedMovies.length})` : ''}
                      </h6>
                      {recommendedMovies.length > 0 ? (
                        <div className="flex flex-col gap-4 animate-in slide-in-from-top-2 duration-300">
                          {recommendedMovies.map((rec: any) => {
                            const isSaved = isMovieSaved(rec.tmdb_id, rec.title);
                            const recMenuOpen = activeRecMenuId === rec.id;
                            return (
                              <div key={rec.id} className={`flex gap-4 p-4 rounded-2xl relative group cursor-pointer ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10' : 'bg-slate-50 border border-slate-100 hover:shadow-md'} transition-all`} onClick={() => handlePreviewMovie(rec)}>
                                {rec.poster ? (
                                  <img src={rec.poster} className="w-20 h-28 rounded-xl object-cover flex-shrink-0 shadow-lg hover:scale-105 transition-transform duration-300" alt={rec.title} />
                                ) : (
                                  <div className={`w-20 h-28 rounded-xl flex-shrink-0 flex items-center justify-center text-2xl ${theme === 'dark' ? 'bg-white/10' : 'bg-slate-200'}`}>🎬</div>
                                )}

                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveRecMenuId(recMenuOpen ? null : rec.id);
                                    }}
                                    className={`absolute top-2 right-2 p-2.5 rounded-full transition-all backdrop-blur-md z-20 shadow-lg ${recMenuOpen ? 'bg-indigo-600 text-white scale-110' : 'bg-black/70 text-zinc-100 hover:bg-black/95'} opacity-0 group-hover:opacity-100`}
                                  >
                                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" /></svg>
                                  </button>

                                {recMenuOpen && (
                                  <div className="absolute top-10 right-2 z-30" onClick={(e) => e.stopPropagation()}>
                                    <MovieActionMenu
                                      movie={rec}
                                      theme={theme}
                                      existingGenres={uniqueGenres}
                                      onUpdateStatus={(s) => { updateStatus(rec, s); setActiveRecMenuId(null); }}
                                      onUpdateGenre={(g) => { updateGenre(rec, g); setActiveRecMenuId(null); }}
                                      onDelete={async () => {
                                        if (isMe) {
                                          setConfirmModal({
                                            title: "Remove Recommendation",
                                            message: `Remove "${rec.title}" from your recommendations list?`,
                                            onConfirm: async () => {
                                              try {
                                                const ref = doc(db, "users", user.uid, "recommended", rec.id);
                                                await deleteDoc(ref);
                                                setRecommendedMovies(prev => prev.filter(r => r.id !== rec.id));
                                                setToast("Removed recommendation.");
                                              } catch (e) {
                                                console.error("Failed to delete recommendation:", e);
                                              } finally {
                                                setConfirmModal(null);
                                              }
                                            }
                                          });
                                        } else {
                                          handleDelete(rec);
                                        }
                                        setActiveRecMenuId(null);
                                      }}
                                      onReport={!isMe ? () => {
                                        setConfirmModal({
                                          title: "Report Recommendation",
                                          message: `Report this movie recommendation from ${friendProfile.username}?`,
                                          onConfirm: async () => {
                                            try {
                                              await addDoc(collection(db, "reports"), {
                                                reporter_uid: user.uid,
                                                reported_uid: friend.uid,
                                                type: "recommendation",
                                                content: rec,
                                                timestamp: new Date().toISOString()
                                              });
                                              setToast("Recommendation reported.");
                                            } catch(err) { console.error(err); setToast("Failed to submit report."); }
                                            setConfirmModal(null);
                                          }
                                        });
                                      } : undefined}
                                      onClose={() => setActiveRecMenuId(null)}
                                    />
                                  </div>
                                )}

                                <div className="min-w-0 flex-grow flex flex-col justify-center">
                                  <div className="flex justify-between items-start gap-4">
                                    <div>
                                      <h4 className={`font-black text-sm leading-tight ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>{rec.title}</h4>
                                      <p className={`text-sm font-semibold mb-2 ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-400'}`}>{rec.release_year || ''} {rec.genre ? `• ${rec.genre}` : ''}</p>
                                    </div>

                                    <div className="flex-shrink-0">
                                      {!isMe && !isSaved && (
                                        <button
                                          onClick={async (e) => {
                                            e.stopPropagation();
                                            const movieToAdd = {
                                              title: rec.title,
                                              poster: rec.poster || '',
                                              genre: rec.genre || 'Uncategorized',
                                              release_year: rec.release_year || 0,
                                              description: rec.description || '',
                                              rating: rec.rating || 0,
                                              tmdb_id: rec.tmdb_id,
                                              media_type: rec.media_type || 'movie',
                                              status: 'list' as const,
                                              trailer: '', cast: '', director: '', language: 'English',
                                              added_at: new Date().toISOString()
                                            };
                                            saveMovie(movieToAdd);
                                          }}
                                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                                        >
                                          + Vault
                                        </button>
                                      )}
                                      {!isMe && isSaved && (
                                        <span className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-500 bg-emerald-500/10 border border-emerald-500/10 rounded-xl">Saved</span>
                                      )}
                                      {isMe && (
                                        <button
                                          onClick={async (e) => {
                                            e.stopPropagation();
                                            setConfirmModal({
                                              title: "Remove Recommendation",
                                              message: `Remove "${rec.title}" from your recommendations list?`,
                                              onConfirm: async () => {
                                                try {
                                                  const ref = doc(db, "users", user.uid, "recommended", rec.id);
                                                  await deleteDoc(ref);
                                                  setRecommendedMovies(prev => prev.filter(r => r.id !== rec.id));
                                                  setToast("Removed recommendation.");
                                                } catch (e) {
                                                  console.error("Failed to delete recommendation:", e);
                                                } finally {
                                                  setConfirmModal(null);
                                                }
                                              }
                                            });
                                          }}
                                          className="px-4 py-2 bg-rose-600/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/20 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                                        >
                                          Remove
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  <div>
                                    {rec.userRating ? (
                                      <div className="flex items-center gap-1.5 mb-1">
                                        <span className={`text-[9px] font-black uppercase ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-400'}`}>{isMe ? 'Your' : `${friendProfile.username}'s`} Rating:</span>
                                        <div className="flex text-amber-400 text-[10px]">
                                          {'★'.repeat(rec.userRating)}{'☆'.repeat(5 - rec.userRating)}
                                        </div>
                                      </div>
                                    ) : null}
                                    {rec.userNote ? (
                                      <div>
                                        <span className={`text-[9px] font-black uppercase ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-400'}`}>{isMe ? 'Your' : `${friendProfile.username}'s`} Comment:</span>
                                        <p className={`text-sm italic leading-relaxed line-clamp-2 ${theme === 'dark' ? 'text-zinc-300' : 'text-slate-600'}`}>"{rec.userNote}"</p>
                                      </div>
                                    ) : rec.description ? (
                                      <p className={`text-sm leading-relaxed line-clamp-2 ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-400'}`}>{rec.description}</p>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className={`text-sm italic ${theme === 'dark' ? 'text-zinc-600' : 'text-slate-300'}`}>No recommendations yet.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          };

          const mySelfFriend = userProfile ? {
            uid: user?.uid,
            username: userProfile.username,
            displayName: userProfile.username,
            avatar: userProfile.avatar,
            sharedWatching: mySharedWatching?.title || "",
            recommendedCount: myRecommendedCount
          } : null;

          return (
            <div className="max-w-2xl mx-auto space-y-8 animate-in slide-in-from-bottom-8 duration-700">
              {/* Header */}
              <div className="space-y-1">
                <h2 className={`text-2xl font-black uppercase tracking-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Friends</h2>
                <p className={`text-sm font-semibold ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-400'}`}>
                  Discover, share, and get movie picks from your friends
                </p>
              </div>

              {/* Search bar */}
              <form onSubmit={async (e) => {
                e.preventDefault();
                const target = e.currentTarget.elements.namedItem('friendName') as HTMLInputElement;
                if (!target || !target.value.trim() || !user || !userProfile) return;
                const query = target.value.trim();

                // Self check
                if (query.toLowerCase() === userProfile.username.toLowerCase() || query.toLowerCase() === user.email?.toLowerCase()) {
                  setToast("You cannot add yourself!");
                  return;
                }

                setToast("Searching for user...");
                try {
                  let friendUid: string | null = null;
                  let friendUsername = query;

                  if (query.includes('@')) {
                    // Email lookup
                    const emailKey = query.toLowerCase().trim().replace(/\./g, '_dot_');
                    const emailRef = doc(db, "emails", emailKey);
                    const emailSnap = await getDoc(emailRef);
                    if (!emailSnap.exists()) {
                      setToast(`No user found with email "${query}"`);
                      return;
                    }
                    const data = emailSnap.data();
                    friendUid = data.uid;
                    friendUsername = data.username || query;
                  } else {
                    // Username lookup
                    const usernameRef = doc(db, "usernames", query.toLowerCase());
                    const lookupSnap = await getDoc(usernameRef);
                    if (!lookupSnap.exists()) {
                      setToast(`User "${query}" does not exist!`);
                      return;
                    }
                    const friendData = lookupSnap.data();
                    friendUid = friendData.uid;
                    friendUsername = friendData.username || query;
                  }

                  if (!friendUid) { setToast("User not found."); return; }

                  // Fetch their profile to get avatar
                  const profileSnap = await getDoc(doc(db, "users", friendUid, "profile", "data"));
                  const profileData = profileSnap.exists() ? profileSnap.data() : { avatar: "🍿" };

                  setSearchUserModal({
                    uid: friendUid,
                    username: friendUsername,
                    avatar: profileData.avatar || "🍿"
                  });
                  
                  target.value = '';
                  setToast("");
                } catch (err: any) {
                  console.error(err);
                  setToast("Search failed.");
                }
              }} className={`flex gap-3 p-4 rounded-[28px] border ${theme === 'dark' ? 'bg-white/3 border-white/5' : 'bg-white border-slate-200 shadow-sm'}`}>
                <div className="flex-grow relative">
                  <svg className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" /></svg>
                  <input
                    name="friendName"
                    placeholder="Search by username or email..."
                    className={`w-full pl-9 pr-4 py-3 border rounded-2xl text-sm outline-none ${theme === 'dark' ? 'bg-black/50 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'} placeholder:text-zinc-500`}
                  />
                </div>
                <button type="submit" className="px-5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-sm font-black uppercase tracking-wider transition-all">Search</button>
              </form>

              {/* Friend count + list label */}
              {(friendsList.length > 0 || mySelfFriend) && (
                <div className={`flex items-center gap-2 text-sm font-black uppercase tracking-widest ${theme === 'dark' ? 'text-zinc-600' : 'text-slate-400'}`}>
                  <span className="w-4 h-px bg-current opacity-50"></span>
                  <span>Connections ({friendsList.length + (mySelfFriend ? 1 : 0)})</span>
                  <span className="flex-grow h-px bg-current opacity-20"></span>
                </div>
              )}

              {/* Friends list */}
              <div className="space-y-3">
                {mySelfFriend && (
                  <FriendCard friend={mySelfFriend} isMe={true} />
                )}
                {friendsList.length === 0 && !mySelfFriend ? (
                  <div className={`py-16 text-center rounded-[32px] border ${theme === 'dark' ? 'border-white/5 bg-white/2' : 'border-slate-100 bg-slate-50'}`}>
                    <div className="text-4xl mb-3">👥</div>
                    <p className={`text-sm font-bold ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-400'}`}>No friends yet</p>
                    <p className={`text-sm mt-1 ${theme === 'dark' ? 'text-zinc-600' : 'text-slate-300'}`}>Search by username or email to add friends</p>
                  </div>
                ) : (
                  friendsList.map((friend: any) => (
                    <FriendCard key={friend.uid || friend.username} friend={friend} />
                  ))
                )}
              </div>
            </div>
          );
        })()}

        {activeTab === 'board' && (
          <div className="max-w-2xl mx-auto pb-24 px-4 sm:px-6">
            <div className="mb-8 mt-6">
              <h2 className={`text-2xl font-black uppercase tracking-wider mb-2 ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>Trending Board</h2>
              <p className={`text-sm font-semibold ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-500'}`}>Discover the top recommended movies.</p>
            </div>

            <div className={`flex items-center justify-between p-1.5 rounded-2xl mb-6 border ${theme === 'dark' ? 'bg-black/50 border-white/10' : 'bg-slate-100 border-slate-200'}`}>
              <button onClick={() => setBoardScope('friends')} className={`flex-1 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl transition-all ${boardScope === 'friends' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}>Friends</button>
              <button onClick={() => setBoardScope('global')} className={`flex-1 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl transition-all ${boardScope === 'global' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}>Global</button>
            </div>

            <div className="flex gap-3 overflow-x-auto pb-2 mb-6 scrollbar-hide">
              {['day', 'week', 'month'].map(tf => (
                <button
                  key={tf}
                  onClick={() => setBoardTimeframe(tf as any)}
                  className={`flex-1 min-w-[100px] px-4 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] whitespace-nowrap border transition-all ${boardTimeframe === tf ? 'bg-indigo-500/10 text-indigo-500 border-indigo-500/30' : theme === 'dark' ? 'bg-white/5 border-white/10 text-zinc-400 hover:bg-white/10' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 shadow-sm'}`}
                >
                  {tf === 'day' ? 'Today' : tf === 'week' ? 'This Week' : 'This Month'}
                </button>
              ))}
            </div>

            {isBoardLoading ? (
              <div className="py-24 text-center">
                <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-6 shadow-lg shadow-indigo-500/20"></div>
                <p className={`text-[10px] font-black uppercase tracking-[0.3em] ${theme === 'dark' ? 'text-zinc-600' : 'text-slate-400'}`}>Compiling Charts...</p>
              </div>
            ) : boardMovies.length === 0 ? (
              <div className={`py-20 text-center rounded-[32px] border ${theme === 'dark' ? 'border-white/5 bg-white/2' : 'border-slate-100 bg-slate-50'}`}>
                <div className="text-4xl mb-4">📉</div>
                <p className={`text-sm font-black uppercase tracking-widest ${theme === 'dark' ? 'text-zinc-500' : 'text-slate-400'}`}>No trends found</p>
                <p className={`text-xs mt-2 font-semibold ${theme === 'dark' ? 'text-zinc-600' : 'text-slate-400'}`}>Try changing the timeframe or scope.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-5 animate-in slide-in-from-bottom-4 duration-500">
                {boardMovies.map((movie: any, idx: number) => {
                  const isSaved = isMovieSaved(movie.tmdb_id, movie.title);
                  return (
                    <div key={movie.id || movie.tmdb_id || idx} className={`flex gap-5 p-5 rounded-3xl relative group cursor-pointer ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10 border-white/5' : 'bg-slate-50 border-slate-100 hover:shadow-xl hover:shadow-indigo-500/5'} border transition-all duration-300`} onClick={() => setSelectedMovie(movie)}>

                      <div className={`absolute -left-3 -top-3 w-10 h-10 rounded-2xl ${idx === 0 ? 'bg-amber-400 text-amber-950' : idx === 1 ? 'bg-slate-300 text-slate-800' : idx === 2 ? 'bg-amber-700 text-amber-100' : 'bg-indigo-600 text-white'} flex items-center justify-center font-black text-lg shadow-xl z-10 border-[3px] ${theme === 'dark' ? 'border-[#050505]' : 'border-white'} rotate-[-6deg] group-hover:rotate-0 transition-transform duration-300`}>
                        {idx + 1}
                      </div>

                      {movie.poster ? (
                        <img src={movie.poster} className="w-24 h-36 rounded-2xl object-cover flex-shrink-0 shadow-lg group-hover:scale-105 transition-transform duration-500" alt={movie.title} />
                      ) : (
                        <div className={`w-24 h-36 rounded-2xl flex-shrink-0 flex items-center justify-center text-3xl shadow-inner ${theme === 'dark' ? 'bg-white/10' : 'bg-slate-200'}`}>🎬</div>
                      )}

                      <div className="min-w-0 flex-grow flex flex-col justify-center">
                        <div className="flex justify-between items-start gap-4 mb-3">
                          <div>
                            <h4 className={`font-black text-base leading-tight mb-1 ${theme === 'dark' ? 'text-white' : 'text-slate-800'}`}>{movie.title}</h4>
                            <p className={`text-xs font-bold uppercase tracking-wider ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'}`}>{movie.release_year || ''} {movie.genre ? `• ${movie.genre}` : ''}</p>
                          </div>

                          <div className="flex-shrink-0">
                            {!isSaved ? (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const movieToAdd = {
                                    title: movie.title,
                                    poster: movie.poster || '',
                                    genre: movie.genre || 'Uncategorized',
                                    release_year: movie.release_year || 0,
                                    description: movie.description || '',
                                    rating: movie.rating || 0,
                                    tmdb_id: movie.tmdb_id,
                                    media_type: movie.media_type || 'movie',
                                    status: 'list' as const,
                                    trailer: '', cast: '', director: '', language: 'English',
                                    added_at: new Date().toISOString()
                                  };
                                  saveMovie(movieToAdd);
                                }}
                                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 transition-all hover:-translate-y-0.5"
                              >
                                + Vault
                              </button>
                            ) : (
                              <span className="px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">Saved</span>
                            )}
                          </div>
                        </div>

                        <div>
                          {movie.description && (
                            <p className={`text-sm font-semibold leading-relaxed line-clamp-3 ${theme === 'dark' ? 'text-zinc-400' : 'text-slate-500'}`}>{movie.description}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </main>

      {/* Mobile bottom nav */}
      <nav className={`sm:hidden fixed bottom-0 left-0 w-full ${theme === 'dark' ? 'glass-dark border-white/5' : 'bg-white/90 border-zinc-200 shadow-2xl'} border-t px-10 pt-5 pb-12 flex justify-between safe-bottom z-50 backdrop-blur-3xl`}>
        {[
          { id: 'collection', label: 'Vault', icon: 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4' },
          { id: 'find', label: 'Find', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0' },
          { id: 'friends', label: 'Friends', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
          { id: 'board', label: 'Board', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' }
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`flex flex-col items-center gap-2 transition-all duration-300 ${activeTab === tab.id ? 'text-indigo-500 scale-110' : 'text-zinc-400'}`}>
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={tab.icon} /></svg>
            <span className="text-[9px] font-black uppercase tracking-[0.2em]">{tab.label}</span>
          </button>
        ))}
      </nav>

      {isManualAddOpen && (
        <ManualAddModal theme={theme} existingGenres={uniqueGenres} onClose={() => setIsManualAddOpen(false)} onSave={saveMovie} />
      )}
      {searchUserModal && userProfile && user && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSearchUserModal(null)}></div>
          <div className={`relative ${theme === 'dark' ? 'glass-dark border-white/10' : 'bg-white border-slate-200 shadow-2xl'} rounded-[32px] w-full max-w-sm p-6 flex flex-col items-center text-center animate-in zoom-in-95 duration-200`}>
            <div className="w-24 h-24 mb-4 rounded-full border-4 shadow-xl flex items-center justify-center text-5xl overflow-hidden bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border-indigo-500/30">
              {searchUserModal.avatar?.startsWith('data:image') ? (
                <img src={searchUserModal.avatar} className="w-full h-full object-cover" alt="avatar" />
              ) : (
                searchUserModal.avatar || '🍿'
              )}
            </div>
            <h3 className={`text-xl font-black mb-1 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{searchUserModal.username}</h3>
            
            <div className="mt-6 w-full space-y-3">
              {userProfile.blockedUsers?.includes(searchUserModal.uid) ? (
                <button onClick={async () => {
                  try {
                    const newBlocked = userProfile.blockedUsers!.filter(id => id !== searchUserModal.uid);
                    await updateDoc(doc(db, "users", user.uid, "profile", "data"), { blockedUsers: newBlocked });
                    setToast("User unblocked!");
                    setSearchUserModal(null);
                  } catch (err) {
                    console.error(err);
                    setToast("Failed to unblock user.");
                  }
                }} className="w-full py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-2xl text-sm font-black uppercase tracking-wider transition-all">
                  Unblock User
                </button>
              ) : friendsList.some(f => f.uid === searchUserModal.uid) ? (
                <button disabled className={`w-full py-3 rounded-2xl text-sm font-black uppercase tracking-wider ${theme === 'dark' ? 'bg-white/5 text-zinc-500' : 'bg-slate-100 text-slate-400'}`}>
                  Already Friends
                </button>
              ) : (
                <button onClick={async () => {
                  try {
                    const reqRef = doc(db, "users", searchUserModal.uid, "notifications", `req_${user.uid}_${Date.now()}`);
                    await setDoc(reqRef, {
                      type: "friend_request",
                      senderId: user.uid,
                      senderUsername: userProfile.username,
                      senderAvatar: userProfile.avatar || null,
                      status: "pending",
                      text: `${userProfile.username} sent you a friend request!`,
                      time: new Date().toISOString(),
                      read: false
                    });
                    setToast(`Friend request sent to ${searchUserModal.username}!`);
                    setSearchUserModal(null);
                  } catch (err: any) {
                    console.error(err);
                    if (err.message?.includes("permissions") || err.code === 'permission-denied') {
                      setToast("Cannot send request. This user may not be accepting requests right now.");
                    } else {
                      setToast("Failed to send request.");
                    }
                    setSearchUserModal(null);
                  }
                }} className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-sm font-black uppercase tracking-wider transition-all shadow-lg shadow-indigo-600/30">
                  Send Request
                </button>
              )}
              
              <button onClick={() => setSearchUserModal(null)} className={`w-full py-3 rounded-2xl text-sm font-black uppercase tracking-wider transition-all ${theme === 'dark' ? 'hover:bg-white/5 text-zinc-400' : 'hover:bg-slate-50 text-slate-500'}`}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {displayedModalMovie && (
        <DetailModal
          movie={displayedModalMovie}
          theme={theme}
          isSaved={isMovieSaved(displayedModalMovie.tmdb_id, displayedModalMovie.title)}
          onClose={() => setSelectedMovie(null)}
          onUpdateStatus={(s) => updateStatus(displayedModalMovie, s)}
          onDelete={() => handleDelete(displayedModalMovie)}
          setConfirmModal={setConfirmModal}
          onUpdatePersonal={async (rating, note) => {
            if (user) {
              const saved = getSavedMovie(displayedModalMovie.tmdb_id, displayedModalMovie.id, displayedModalMovie.title);
              if (saved && saved.id) {
                await updateDoc(doc(db, "users", user.uid, "movies", saved.id), {
                  userRating: rating,
                  userNote: note
                });
                setToast("Opinion saved!");
              } else {
                await saveMovie({ ...displayedModalMovie, userRating: rating, userNote: note, status: 'list' });
                setToast("Movie saved with your opinion!");
              }
            }
          }}
        />
      )}
      {confirmModal && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={() => setConfirmModal(null)}></div>
          <div className={`relative ${theme === 'dark' ? 'glass-dark border-white/10' : 'bg-white border-slate-200 shadow-2xl'} rounded-[32px] max-w-sm w-full p-6 space-y-6 text-center animate-in zoom-in-95 duration-200`}>
            <div className="space-y-2">
              <h3 className={`text-lg font-black uppercase tracking-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{confirmModal.title}</h3>
              <p className={`text-sm font-semibold leading-relaxed ${theme === 'dark' ? 'text-zinc-400' : 'text-slate-500'}`}>{confirmModal.message}</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmModal(null)} className={`flex-1 py-3.5 rounded-2xl text-sm font-black uppercase tracking-wider transition-all ${theme === 'dark' ? 'bg-white/5 border border-white/10 text-zinc-400 hover:bg-white/10' : 'bg-slate-100 border border-slate-200 text-slate-500 hover:bg-slate-200'}`}>Cancel</button>
              <button onClick={() => confirmModal.onConfirm()} className="flex-1 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-sm font-black uppercase tracking-wider transition-all shadow-lg shadow-indigo-600/30">Confirm</button>
            </div>
          </div>
        </div>
      )}

      {shareOpinionModal && (
        <ShareOpinionModal
          movie={shareOpinionModal.movie}
          type={shareOpinionModal.type}
          theme={theme}
          onClose={() => setShareOpinionModal(null)}
          onSubmit={async (rating, note) => {
            if (!user) return;
            const movie = shareOpinionModal.movie;
            try {
              // Optionally update local vault copy
              await handleUpdatePersonal(movie, rating, note);

              if (shareOpinionModal.type === 'watching') {
                const ref = doc(db, "users", user.uid, "shared_watching", "current");
                await setDoc(ref, sanitizePayload({
                  title: movie.title,
                  poster: movie.poster || null,
                  genre: movie.genre || null,
                  release_year: movie.release_year || null,
                  description: movie.description || null,
                  rating: movie.rating || null,
                  tmdb_id: movie.tmdb_id || null,
                  media_type: movie.media_type || 'movie',
                  userRating: rating,
                  userNote: note,
                  shared_at: new Date().toISOString()
                }));
                // Notify all friends so FCM push fires
                if (userProfile && friendsList.length > 0) {
                  const senderName = userProfile.username;
                  await Promise.allSettled(friendsList.map(friend => {
                    const notifId = `watch_${user.uid}_${Date.now()}_${friend.uid}`;
                    return setDoc(doc(db, "users", friend.uid, "notifications", notifId), {
                      type: "friend_watching",
                      senderId: user.uid,
                      senderUsername: senderName,
                      senderAvatar: userProfile.avatar || null,
                      text: `${senderName} is now watching "${movie.title}"!`,
                      time: new Date().toISOString(),
                      read: false
                    });
                  }));
                }
                setToast(`Sharing "${movie.title}" with friends!`);
              } else {
                const movieKey = movie.id || movie.tmdb_id?.toString() || movie.title.replace(/\s+/g, '_').toLowerCase();
                const ref = doc(db, "users", user.uid, "recommended", movieKey);
                await setDoc(ref, sanitizePayload({
                  title: movie.title,
                  poster: movie.poster || null,
                  genre: movie.genre || null,
                  release_year: movie.release_year || null,
                  description: movie.description || null,
                  rating: movie.rating || null,
                  tmdb_id: movie.tmdb_id || null,
                  media_type: movie.media_type || 'movie',
                  userRating: rating,
                  userNote: note,
                  recommended_at: new Date().toISOString()
                }));
                // Notify all friends so FCM push fires
                if (userProfile && friendsList.length > 0) {
                  const senderName = userProfile.username;
                  await Promise.allSettled(friendsList.map(friend => {
                    const notifId = `rec_${user.uid}_${Date.now()}_${friend.uid}`;
                    return setDoc(doc(db, "users", friend.uid, "notifications", notifId), {
                      type: "friend_recommended",
                      senderId: user.uid,
                      senderUsername: senderName,
                      senderAvatar: userProfile.avatar || null,
                      text: `${senderName} recommends "${movie.title}"!`,
                      time: new Date().toISOString(),
                      read: false
                    });
                  }));
                }
                setToast(`"${movie.title}" added to your Recommended list!`);
              }
              setShareOpinionModal(null);
            } catch (e: any) {
              console.error("Share error:", e);
              setToast("Failed to share. Please try again.");
            }
          }}
        />
      )}

      {/* Story Creator Modal */}
      {isCreateStoryOpen && (
        <StoryCreatorModal
          theme={theme}
          user={user}
          userProfile={userProfile}
          friendsList={friendsList}
          onClose={() => setIsCreateStoryOpen(false)}
          setToast={setToast}
        />
      )}

      {/* Story Viewer Modal */}
      {activeStoryState && activeStoryState.groups.length > 0 && (
        <StoryViewerModal
          theme={theme}
          allGroups={activeStoryState.groups}
          initialGroupIndex={activeStoryState.startIndex}
          currentUserUid={user?.uid || ''}
          currentUserProfile={userProfile}
          onClose={() => setActiveStoryState(null)}
          setToast={setToast}
          onViewStory={handleViewStory}
          onMovieClick={async (title, id) => {
            if (id) {
              const details = await fetchMovieDetails({ id, media_type: 'movie', title });
              setSelectedMovie(details);
            } else {
              setVaultSearch(title);
            }
          }}
        />
      )}

      {/* View Profile Picture Modal */}
      {viewProfilePicModal && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-4" onClick={() => setViewProfilePicModal(null)}>
          <div className="absolute inset-0 bg-black/90 backdrop-blur-md" />
          <div className="relative flex flex-col items-center gap-4 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <button onClick={() => setViewProfilePicModal(null)} className="absolute -top-10 right-0 p-2 text-white/60 hover:text-white transition-colors">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <img src={viewProfilePicModal.src} className="max-w-[85vw] max-h-[75vh] rounded-3xl object-contain shadow-2xl border border-white/10" alt="profile" />
            <p className="text-white/70 text-sm font-black uppercase tracking-widest">{viewProfilePicModal.username}</p>
          </div>
        </div>
      )}

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
};


export interface StoryElement {
  id: string;
  type: 'text' | 'movie' | 'mention';
  content: string; // The text, movie ID, or friend UID
  label?: string; // e.g. movie title or friend username
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  color?: string;
  bg?: string;
  size?: number;
  posterUrl?: string;
}


const StoryCreatorModal = ({ theme, user, userProfile, friendsList, onClose, setToast }: { theme: Theme, user: User, userProfile: any, friendsList: any[], onClose: () => void, setToast: (s: string) => void }) => {
  const [imageUrl, setImageUrl] = useState('');
  const [elements, setElements] = useState<StoryElement[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Dragging state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sub-modals
  const [showMovieSearch, setShowMovieSearch] = useState(false);
  const [movieQuery, setMovieQuery] = useState('');
  const [movieResults, setMovieResults] = useState<any[]>([]);
  const [isPickingBackgroundPoster, setIsPickingBackgroundPoster] = useState(false);

  // Text editor state
  const [editingElementId, setEditingElementId] = useState<string | null>(null);

  const [bgScale, setBgScale] = useState(1);
  const [bgTranslate, setBgTranslate] = useState({ x: 0, y: 0 });
  const [initialPinch, setInitialPinch] = useState<{ distance: number, scale: number, center: {x:number, y:number}, translate: {x:number, y:number} } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const center = { x: (t1.clientX + t2.clientX)/2, y: (t1.clientY + t2.clientY)/2 };
      setInitialPinch({ distance: dist, scale: bgScale, center, translate: bgTranslate });
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && initialPinch) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const center = { x: (t1.clientX + t2.clientX)/2, y: (t1.clientY + t2.clientY)/2 };
      
      const newScale = Math.max(0.5, Math.min(5, initialPinch.scale * (dist / initialPinch.distance)));
      const dx = center.x - initialPinch.center.x;
      const dy = center.y - initialPinch.center.y;
      
      setBgScale(newScale);
      setBgTranslate({ 
        x: initialPinch.translate.x + dx, 
        y: initialPinch.translate.y + dy 
      });
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) setInitialPinch(null);
  };


  // New Story Entry State
  const [showEntryMenu, setShowEntryMenu] = useState(true);
  const [bgColor, setBgColor] = useState<string | null>(null);
  const [isOverTrash, setIsOverTrash] = useState(false);

  const textBgOptions = [
    { label: 'None', value: 'transparent' },
    { label: 'Highlight', value: 'rgba(0, 0, 0, 0.65)' },
    { label: 'Solid White', value: '#ffffff' },
    { label: 'Indigo', value: '#4f46e5' }
  ];

  const textColorOptions = [
    { label: 'White', value: '#ffffff' },
    { label: 'Black', value: '#09090b' },
    { label: 'Yellow', value: '#eab308' },
    { label: 'Indigo', value: '#818cf8' }
  ];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1500000) {
      setToast("Image too large. Please select a photo under 1.5MB.");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setImageUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (elements.length === 0 && !imageUrl) {
      setToast("Please add some text, stickers, or an image.");
      return;
    }
    setIsSubmitting(true);
    try {
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const storyRef = doc(collection(db, "stories"));
      await setDoc(storyRef, {
        uid: user.uid,
        username: userProfile.username || 'Anonymous',
        avatar: userProfile.avatar || null,
        imageUrl: imageUrl || null,
        imageTransform: { scale: bgScale, x: bgTranslate.x, y: bgTranslate.y },
        bgColor: bgColor || null,
        elements: elements.map(el => ({
          ...el,
          content: el.content || '',
          color: el.color || null,
          bg: el.bg || null,
          size: el.size || 16,
          label: el.label || null,
          posterUrl: el.posterUrl || null
        })),
        createdAt,
        expiresAt
      });
      setToast("Story shared!");
      // Notify all friends so FCM push fires
      if (userProfile && friendsList && friendsList.length > 0) {
        const senderName = userProfile.username;
        await Promise.allSettled(friendsList.map((friend: any) => {
          const notifId = `story_${user.uid}_${Date.now()}_${friend.uid}`;
          return setDoc(doc(db, "users", friend.uid, "notifications", notifId), {
            type: "new_story",
            senderId: user.uid,
            senderUsername: senderName,
            senderAvatar: userProfile.avatar || null,
            text: `${senderName} posted a new story!`,
            time: new Date().toISOString(),
            read: false
          });
        }));
      }
      onClose();
    } catch (err) {
      console.error(err);
      setToast("Failed to share story.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const addText = () => {
    const newId = Math.random().toString(36).substr(2, 9);
    setElements([...elements, {
      id: newId,
      type: 'text',
      content: 'Tap to edit',
      x: 50,
      y: 50,
      color: '#ffffff',
      bg: 'rgba(0, 0, 0, 0.65)',
      size: 16
    }]);
    setEditingElementId(newId);
  };

  const handlePointerDown = (e: React.PointerEvent, id: string) => {
    if (editingElementId) return; // Disable drag while editing
    e.stopPropagation();
    setDraggingId(id);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingId || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));

    setIsOverTrash(y > 85 && x > 35 && x < 65);
    setElements(prev => prev.map(el => el.id === draggingId ? { ...el, x, y } : el));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggingId) {
      if (isOverTrash) {
        setElements(prev => prev.filter(el => el.id !== draggingId));
      }
      setIsOverTrash(false);
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      setDraggingId(null);
    }
  };

  const activeEditingElement = elements.find(e => e.id === editingElementId);

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-black/85 backdrop-blur-md" onClick={onClose}></div>
      <div className={`relative ${theme === 'dark' ? 'glass-dark border-white/10' : 'bg-white border-slate-200 shadow-2xl'} rounded-[32px] max-w-4xl w-full p-6 grid grid-cols-1 max-w-[450px] w-full p-0 flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden h-[90vh] md:h-[95vh] mx-auto`}>

        {/* Left Side: Portrait Interactive Live Preview */}
        <div
          ref={containerRef}
          className="relative w-full h-full bg-zinc-950 flex flex-col justify-center items-center shadow-inner touch-none select-none overflow-hidden"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onClick={(e) => {
            if (e.target === containerRef.current || (e.target as HTMLElement).tagName === 'IMG' || (e.target as HTMLElement).classList.contains('absolute')) {
              if (editingElementId && !draggingId) {
                setEditingElementId(null);
              }
            }
          }}
        >
          {(!imageUrl && !bgColor && showEntryMenu) ? (
            <div className="absolute inset-0 z-[200] bg-zinc-950 flex flex-col items-center justify-center p-6 gap-4">
              <h3 className="text-white font-black text-xl mb-4 tracking-tight">Create Story</h3>
              <button 
                onClick={() => { setIsPickingBackgroundPoster(true); setShowMovieSearch(true); }}
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 rounded-2xl text-white font-black flex items-center justify-center gap-3 shadow-lg shadow-indigo-600/30 transition-all active:scale-95"
              >
                <span className="text-2xl">🎬</span>
                Movie Poster
              </button>
              <button 
                onClick={() => { setBgColor('linear-gradient(to bottom right, #312e81, #4c1d95, #09090b)'); setShowEntryMenu(false); }}
                className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 rounded-2xl text-white font-black flex items-center justify-center gap-3 border border-white/10 transition-all active:scale-95"
              >
                <span className="text-2xl">🎨</span>
                Blank Canvas
              </button>
              <div className="flex gap-4 w-full mt-4">
                <button 
                  onClick={async () => {
                    try {
                      const image = await Camera.getPhoto({ quality: 60, allowEditing: false, resultType: CameraResultType.DataUrl, source: CameraSource.Camera });
                      if (image.dataUrl) { setImageUrl(image.dataUrl); setShowEntryMenu(false); }
                    } catch (e) { console.error(e); }
                  }}
                  className="flex-1 py-4 bg-zinc-800 hover:bg-zinc-700 rounded-2xl text-white font-black flex flex-col items-center justify-center gap-2 border border-white/10 transition-all active:scale-95"
                >
                  <span className="text-2xl">📷</span>
                  Camera
                </button>
                <button 
                  onClick={async () => {
                    try {
                      const image = await Camera.getPhoto({ quality: 60, allowEditing: false, resultType: CameraResultType.DataUrl, source: CameraSource.Photos });
                      if (image.dataUrl) { setImageUrl(image.dataUrl); setShowEntryMenu(false); }
                    } catch (e) { console.error(e); }
                  }}
                  className="flex-1 py-4 bg-zinc-800 hover:bg-zinc-700 rounded-2xl text-white font-black flex flex-col items-center justify-center gap-2 border border-white/10 transition-all active:scale-95"
                >
                  <span className="text-2xl">🖼️</span>
                  Gallery
                </button>
              </div>
            </div>
          ) : imageUrl ? (
            <img src={imageUrl} className="absolute w-full h-full object-cover pointer-events-none" style={{ transform: `translate(${bgTranslate.x}px, ${bgTranslate.y}px) scale(${bgScale})`, transition: initialPinch ? "none" : "transform 0.1s ease-out" }} alt="preview" />
          ) : (
            <div className="absolute inset-0 pointer-events-none" style={{ background: bgColor || 'linear-gradient(to bottom right, #1e1b4b, #3b0764, #09090b)' }}></div>
          )}

          {elements.map(el => (
            <div
              key={el.id}
              className={`absolute p-3 rounded-xl border text-center shadow-2xl transition-transform ${draggingId === el.id ? 'scale-105 cursor-grabbing opacity-90' : 'cursor-grab'} ${editingElementId === el.id ? 'ring-2 ring-indigo-500 scale-105' : ''}`}
              style={{
                left: `${el.x}%`,
                top: `${el.y}%`,
                transform: 'translate(-50%, -50%)',
                color: el.color || '#ffffff',
                backgroundColor: el.bg || 'rgba(0,0,0,0.65)',
                borderColor: el.bg === 'transparent' ? 'transparent' : 'rgba(255,255,255,0.1)',
                fontSize: `${el.size || 16}px`,
                zIndex: draggingId === el.id || editingElementId === el.id ? 50 : 10,
              }}
              onPointerDown={(e) => handlePointerDown(e, el.id)}
              onClick={() => { if (!draggingId) setEditingElementId(el.id); }}
            >
              {el.type === 'text' && (
                editingElementId === el.id ? (
                  <>
                    <textarea
                      autoFocus
                      value={el.content}
                      onFocus={() => {
                        if (el.content === 'Tap to edit') {
                          setElements(prev => prev.map(item => item.id === el.id ? { ...item, content: '' } : item));
                        }
                      }}
                      onChange={(e) => setElements(prev => prev.map(item => item.id === el.id ? { ...item, content: e.target.value } : item))}
                      className="bg-transparent border-none outline-none font-semibold leading-relaxed text-center p-0 m-0 overflow-hidden resize-none"
                      style={{
                        color: el.color || '#ffffff',
                        fontSize: 'inherit',
                        width: `${Math.max(100, el.content.length * (el.size || 16) * 0.6)}px`,
                        minHeight: '1.5em'
                      }}
                      rows={el.content.split('\n').length || 1}
                    />
                    <div className="absolute top-[115%] left-1/2 -translate-x-1/2 flex flex-col gap-2 bg-black/80 backdrop-blur-xl p-3 rounded-2xl shadow-2xl border border-white/10 whitespace-nowrap z-[100]" onPointerDown={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-between gap-4">
                        <label className="text-[9px] font-black uppercase text-zinc-400">Size</label>
                        <input
                          type="range" min="12" max="48"
                          value={el.size || 16}
                          onChange={(e) => setElements(prev => prev.map(item => item.id === el.id ? { ...item, size: Number(e.target.value) } : item))}
                          className="w-24 h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-white"
                        />
                      </div>
                      <div className="flex items-center gap-2 border-t border-white/10 pt-2">
                        <div className="flex gap-1">
                          {textBgOptions.map(opt => (
                            <button
                              key={opt.value}
                              onClick={(e) => { e.stopPropagation(); setElements(prev => prev.map(item => item.id === el.id ? { ...item, bg: opt.value } : item)); }}
                              className={`w-6 h-6 rounded-full border hover:scale-110 transition-transform ${el.bg === opt.value ? 'ring-2 ring-indigo-500 border-transparent' : 'border-white/20'}`}
                              style={{ backgroundColor: opt.value === 'transparent' ? '#333' : opt.value }}
                              title={`BG: ${opt.label}`}
                            />
                          ))}
                        </div>
                        <div className="w-px h-4 bg-white/20 mx-1"></div>
                        <div className="flex gap-1">
                          {textColorOptions.map(opt => (
                            <button
                              key={opt.value}
                              onClick={(e) => { e.stopPropagation(); setElements(prev => prev.map(item => item.id === el.id ? { ...item, color: opt.value } : item)); }}
                              className={`w-6 h-6 rounded-full border hover:scale-110 transition-transform ${el.color === opt.value ? 'ring-2 ring-indigo-500 border-transparent' : 'border-white/20'}`}
                              style={{ backgroundColor: opt.value }}
                              title={`Text: ${opt.label}`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="font-semibold leading-relaxed whitespace-pre-wrap">{el.content}</p>
                )
              )}
              {el.type === 'movie' && (
                <div className="flex items-center gap-2">
                  {el.posterUrl ? (
                    <img src={el.posterUrl} className="w-8 h-12 object-cover rounded shadow-sm" alt="poster" />
                  ) : (
                    <span className="text-xl">🎬</span>
                  )}
                  <span className="font-black uppercase tracking-widest text-[10px]">{el.label}</span>
                </div>
              )}
              {el.type === 'mention' && (
                <div className="flex items-center gap-2">
                  <span className="text-xl">👤</span>
                  <span className="font-black uppercase tracking-widest text-[10px]">@{el.label}</span>
                </div>
              )}
            </div>
          ))}

          {!imageUrl && elements.length === 0 && !showEntryMenu && (
            <span className="text-zinc-500 text-sm font-black uppercase tracking-wider pointer-events-none">Live Preview</span>
          )}

          {draggingId && (
            <div className={`absolute bottom-8 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full flex items-center justify-center transition-all duration-200 z-[100] ${isOverTrash ? 'bg-red-500 scale-125 shadow-lg shadow-red-500/50' : 'bg-black/50 backdrop-blur-md border border-white/20'}`}>
              <svg className={`w-6 h-6 ${isOverTrash ? 'text-white' : 'text-zinc-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </div>
          )}
        </div>
          {/* Action Buttons Overlay (Right side) */}
          {(!showEntryMenu && (imageUrl || bgColor)) && (
            <div className="absolute top-20 right-4 flex flex-col gap-4 z-[200]">
              <button
                onClick={addText}
                className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl shadow-xl transition-transform hover:scale-110 active:scale-95 ${theme === 'dark' ? 'bg-zinc-800/80 text-white border border-white/10' : 'bg-white/90 text-slate-800 border border-slate-200'}`}
                title="Add Text"
              >
                📝
              </button>
              <button
                onClick={() => setShowMovieSearch(true)}
                className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl shadow-xl transition-transform hover:scale-110 active:scale-95 ${theme === 'dark' ? 'bg-zinc-800/80 text-white border border-white/10' : 'bg-white/90 text-slate-800 border border-slate-200'}`}
                title="Tag Movie"
              >
                🎬
              </button>
              <button
                onClick={() => setToast('Friend tagging coming soon!')}
                className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl shadow-xl transition-transform hover:scale-110 active:scale-95 ${theme === 'dark' ? 'bg-zinc-800/80 text-white border border-white/10' : 'bg-white/90 text-slate-800 border border-slate-200'}`}
                title="Mention"
              >
                👤
              </button>
            </div>
          )}

          {/* Share Story Button Overlay */}
          {(!showEntryMenu && (elements.length > 0 || imageUrl || bgColor)) && (
            <div className="absolute bottom-6 right-6 z-[200]">
              <button
                onClick={handlePost}
                disabled={isSubmitting}
                className="px-6 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full text-sm font-black uppercase tracking-wider shadow-[0_0_20px_rgba(79,70,229,0.5)] transition-transform active:scale-95 flex items-center gap-2"
              >
                {isSubmitting ? "Sharing..." : "Post Story"}
                {!isSubmitting && <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>}
              </button>
            </div>
          )}
          
          {/* Close button Overlay */}
          <button onClick={onClose} className={`absolute top-6 left-6 w-10 h-10 rounded-full flex items-center justify-center shadow-lg z-[200] transition-transform active:scale-95 ${theme === 'dark' ? 'bg-zinc-800/80 text-white hover:bg-zinc-700 border border-white/10' : 'bg-white/90 text-slate-800 hover:bg-slate-100 border border-slate-200'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>

            {/* Movie Tag Search Overlay */}
            {showMovieSearch && (
              <div className="absolute inset-0 z-[300] bg-black/95 rounded-[32px] p-6 flex flex-col animate-in fade-in">
                <div className="flex justify-between items-center mb-4">
                  <h4 className="text-sm font-black uppercase tracking-widest text-white">Search Movie</h4>
                  <button onClick={() => setShowMovieSearch(false)} className="text-zinc-500 hover:text-white"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
                </div>
                <input
                  type="text"
                  autoFocus
                  placeholder="Type a movie name..."
                  value={movieQuery}
                  onChange={async (e) => {
                    const q = e.target.value;
                    setMovieQuery(q);
                    if (q.length > 2) {
                      const res = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=86eda413b6a6563e449850347d1d7927&query=${encodeURIComponent(q)}`);
                      const data = await res.json();
                      setMovieResults((data.results || []).filter((r: any) => r.media_type === 'movie' || r.media_type === 'tv').slice(0, 5));
                    } else {
                      setMovieResults([]);
                    }
                  }}
                  className="w-full px-4 py-3 rounded-2xl bg-white/10 text-white border border-white/20 outline-none mb-4"
                />
                <div className="flex-1 overflow-y-auto space-y-2">
                  {movieResults.map(m => (
                    <div
                      key={m.id}
                      className="flex items-center gap-3 p-2 hover:bg-white/10 rounded-xl cursor-pointer transition-colors"
                      onClick={() => {
                        if (isPickingBackgroundPoster) {
                          setImageUrl(`https://image.tmdb.org/t/p/w780${m.poster_path}`);
                          setShowEntryMenu(false);
                          setIsPickingBackgroundPoster(false);
                        } else {
                          const newId = Math.random().toString(36).substr(2, 9);
                          setElements([...elements, {
                            id: newId,
                            type: 'movie',
                            content: String(m.id),
                            label: m.title || m.name,
                            posterUrl: m.poster_path ? `https://image.tmdb.org/t/p/w200${m.poster_path}` : undefined,
                            x: 50,
                            y: 50,
                            bg: 'rgba(79, 70, 229, 0.9)', // Indigo
                            color: '#ffffff'
                          }]);
                        }
                        setShowMovieSearch(false);
                        setMovieQuery('');
                        setMovieResults([]);
                      }}
                    >
                      {m.poster_path ? (
                        <img src={`https://image.tmdb.org/t/p/w92${m.poster_path}`} className="w-10 h-14 object-cover rounded-lg" alt="poster" />
                      ) : (
                        <div className="w-10 h-14 bg-white/10 rounded-lg flex items-center justify-center text-xs">No img</div>
                      )}
                      <div>
                        <p className="text-white font-bold text-sm">{m.title || m.name}</p>
                        <p className="text-zinc-400 text-xs">{m.release_date || m.first_air_date}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

      </div>
    </div>
  );
};

const StoryViewerModal = ({ theme, allGroups, initialGroupIndex, currentUserUid, currentUserProfile, onClose, setToast, onViewStory, onMovieClick }: { theme: Theme, allGroups: any[][], initialGroupIndex: number, currentUserUid: string, currentUserProfile: any, onClose: () => void, setToast: (s: string) => void, onViewStory: (id: string) => void, onMovieClick?: (title: string, id: string) => void }) => {
  const [groupIndex, setGroupIndex] = useState(initialGroupIndex);
  const [currentIndex, setCurrentIndex] = useState(0);
  const activeStoryGroup = allGroups[groupIndex];
  const activeStory = activeStoryGroup[currentIndex];
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [showLikesList, setShowLikesList] = useState(false);
  const [optimisticLikes, setOptimisticLikes] = useState<any[]>([]);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);

  useEffect(() => {
    setOptimisticLikes(activeStory?.likes || []);
  }, [activeStory]);

  const toggleLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const storyRef = doc(db, 'stories', activeStory.id);
    const hasLiked = optimisticLikes.some((l: any) => l.uid === currentUserUid);

    if (hasLiked) {
      const newLikes = optimisticLikes.filter((l: any) => l.uid !== currentUserUid);
      setOptimisticLikes(newLikes);
      await updateDoc(storyRef, { likes: newLikes });
    } else {
      const userLikeObj = { uid: currentUserUid, username: currentUserProfile?.username || 'Unknown', avatar: currentUserProfile?.avatar || '' };
      const newLikes = [...optimisticLikes, userLikeObj];
      setOptimisticLikes(newLikes);
      await updateDoc(storyRef, { likes: arrayUnion(userLikeObj) });

      if (activeStory.uid && activeStory.uid !== currentUserUid) {
        const notifRef = doc(db, "users", activeStory.uid, "notifications", `like_${activeStory.id}_${currentUserUid}`);
        await setDoc(notifRef, {
          type: 'story_like',
          senderId: currentUserUid,
          senderName: currentUserProfile?.username || 'Unknown',
          senderAvatar: currentUserProfile?.avatar || '',
          message: `liked your story`,
          createdAt: Date.now(),
          read: false,
          storyId: activeStory.id
        });
      }
    }
  };

  const onViewStoryRef = useRef(onViewStory);
  const activeStoryGroupRef = useRef(activeStoryGroup);

  useEffect(() => {
    onViewStoryRef.current = onViewStory;
    activeStoryGroupRef.current = activeStoryGroup;
  }, [onViewStory, activeStoryGroup]);

  useEffect(() => {
    if (isPaused) return;

    const duration = 5000;
    const interval = 50;
    const step = (interval / duration) * 100;

    const timer = setInterval(() => {
      setProgress(prev => prev + step);
    }, interval);

    return () => clearInterval(timer);
  }, [isPaused]);

  useEffect(() => {
    if (progress >= 100) {
      if (currentIndex < activeStoryGroup.length - 1) {
        setCurrentIndex(c => c + 1);
      } else {
        if (groupIndex < allGroups.length - 1) {
          setGroupIndex(g => g + 1);
          setCurrentIndex(0);
        } else {
          onClose();
        }
      }
    }
  }, [progress, currentIndex, groupIndex, activeStoryGroup.length, allGroups.length, onClose]);

  useEffect(() => {
    setProgress(0);
    setActiveTagId(null);
    if (activeStory && activeStory.id) {
      onViewStoryRef.current(activeStory.id);
    }
  }, [activeStory, groupIndex]);

  if (!activeStory) return null;

  const handleNext = () => {
    if (currentIndex < activeStoryGroup.length - 1) {
      setCurrentIndex(c => c + 1);
    } else {
      if (groupIndex < allGroups.length - 1) {
        setGroupIndex(g => g + 1);
        setCurrentIndex(0);
      } else {
        onClose();
      }
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(c => c - 1);
    } else if (groupIndex > 0) {
      setGroupIndex(g => g - 1);
      setCurrentIndex(allGroups[groupIndex - 1].length - 1);
    }
  };

  const elements: StoryElement[] = activeStory.elements || [];

  // Backwards compatibility for old stories
  if (!activeStory.elements && activeStory.textContent) {
    elements.push({
      id: 'legacy-1',
      type: 'text',
      content: activeStory.textContent,
      x: 50,
      y: activeStory.textY || 50,
      color: activeStory.textColor,
      bg: activeStory.textBg,
      size: activeStory.textSize || 16
    });
  }

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-0 md:p-4 animate-in zoom-in-95 duration-200">
      <div className="absolute inset-0 bg-black/95" onClick={onClose}></div>
      <div className="relative w-full h-full md:max-w-[400px] md:h-[85vh] md:rounded-[32px] overflow-hidden bg-zinc-950 shadow-2xl border border-white/10 flex flex-col justify-center items-center select-none">

        {/* Progress Bars */}
        <div className="absolute top-4 inset-x-4 flex gap-1 z-50">
          {activeStoryGroup.map((s, idx) => (
            <div key={s.id || idx} className="h-1 flex-1 bg-white/30 rounded-full overflow-hidden">
              <div
                className="h-full bg-white transition-all duration-75 ease-linear"
                style={{ width: idx < currentIndex ? '100%' : idx === currentIndex ? `${progress}%` : '0%' }}
              ></div>
            </div>
          ))}
        </div>

        {/* Header */}
        <div className="absolute top-8 inset-x-4 flex justify-between items-center z-50">
          <div className="flex items-center gap-3">
            {activeStory.avatar?.startsWith('data:image') ? (
              <img src={activeStory.avatar} className="w-10 h-10 rounded-full border-2 border-indigo-500 object-cover shadow-lg" alt="avatar" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center text-xl border-2 border-indigo-500 shadow-lg">
                {activeStory.avatar || '🍿'}
              </div>
            )}
            <div>
              <p className="text-white font-black uppercase tracking-widest text-xs drop-shadow-md">{activeStory.username}</p>
              <p className="text-white/70 font-bold text-[10px] drop-shadow-md">{new Date(activeStory.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeStory.uid === currentUserUid && (
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  setIsPaused(true);
                  if (confirm("Delete this story?")) {
                    try {
                      await deleteDoc(doc(db, "stories", activeStory.id));
                      setToast("Story deleted");
                      onClose();
                    } catch (err) {
                      console.error("Failed to delete story:", err);
                      setToast("Failed to delete story");
                      setIsPaused(false);
                    }
                  } else {
                    setIsPaused(false);
                  }
                }}
                className="p-2 text-rose-500 hover:text-rose-400 drop-shadow-md transition-colors"
                title="Delete Story"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            )}
            <button onClick={onClose} className="p-2 text-white/70 hover:text-white drop-shadow-md">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div
          className="absolute inset-0 z-40 touch-none flex"
          onPointerDown={() => setIsPaused(true)}
          onPointerUp={() => setIsPaused(false)}
          onPointerLeave={() => setIsPaused(false)}
        >
          {/* Navigation invisible halves */}
          <div className="flex-1" onClick={(e) => { e.stopPropagation(); setActiveTagId(null); handlePrev(); }}></div>
          <div className="flex-1" onClick={(e) => { e.stopPropagation(); setActiveTagId(null); handleNext(); }}></div>
        </div>

        {/* Story Visuals */}
        <div className="w-full h-full relative pointer-events-none flex flex-col items-center justify-center bg-zinc-900">
          {activeStory.imageUrl ? (
            <img src={activeStory.imageUrl} className="absolute inset-0 w-full h-full object-cover" style={{ transform: activeStory.imageTransform ? `translate(${activeStory.imageTransform.x}px, ${activeStory.imageTransform.y}px) scale(${activeStory.imageTransform.scale})` : "none" }} alt="story" />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-950 via-purple-950 to-zinc-950"></div>
          )}

          {elements.map(el => (
            <div
              key={el.id}
              className={`absolute p-3 rounded-xl border text-center shadow-2xl pointer-events-auto ${el.type === 'movie' || el.type === 'mention' ? 'cursor-pointer hover:scale-105 transition-transform active:scale-95' : ''}`}
              style={{
                left: `${el.x}%`,
                top: `${el.y}%`,
                transform: 'translate(-50%, -50%)',
                color: el.color || '#ffffff',
                backgroundColor: el.bg || 'rgba(0,0,0,0.65)',
                borderColor: el.bg === 'transparent' ? 'transparent' : 'rgba(255,255,255,0.1)',
                fontSize: `${el.size || 16}px`,
                zIndex: 60
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (el.type === 'movie') {
                  if (activeTagId === el.id) {
                    setActiveTagId(null);
                    if (onMovieClick) {
                      onClose();
                      onMovieClick(el.label || el.content, el.content);
                    } else {
                      const event = new CustomEvent('openMovieDetails', { detail: { id: parseInt(el.content) } });
                      window.dispatchEvent(event);
                    }
                  } else {
                    setActiveTagId(el.id);
                  }
                } else if (el.type === 'mention') {
                  setToast(`Mentioned: @${el.label}`);
                }
              }}
            >
              {el.type === 'text' && (
                <p className="font-semibold leading-relaxed whitespace-pre-wrap">{el.content}</p>
              )}
              {el.type === 'movie' && (
                <div className="flex items-center gap-2 relative">
                  {el.posterUrl ? (
                    <img src={el.posterUrl} className="w-8 h-12 object-cover rounded shadow-sm" alt="poster" />
                  ) : (
                    <span className="text-xl">🎬</span>
                  )}
                  <span className="font-black uppercase tracking-widest text-[10px]">{el.label}</span>
                  {activeTagId === el.id && (
                    <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-black/90 text-white text-[9px] px-3 py-1.5 rounded-lg whitespace-nowrap font-black uppercase tracking-widest shadow-xl animate-in fade-in zoom-in-95 border border-white/20 z-[70]">
                      View Details
                      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-black/90 rotate-45 border-r border-b border-white/20"></div>
                    </div>
                  )}
                </div>
              )}
              {el.type === 'mention' && (
                <div className="flex items-center gap-2">
                  <span className="text-xl">👤</span>
                  <span className="font-black uppercase tracking-widest text-[10px]">@{el.label}</span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Story Likes UI */}
        <div className="absolute bottom-6 right-6 z-50 flex flex-col items-end gap-2">
          {showLikesList && optimisticLikes.length > 0 && activeStory.uid === currentUserUid && (
            <div className="bg-black/80 backdrop-blur-md rounded-2xl p-3 mb-2 max-h-48 overflow-y-auto animate-in slide-in-from-bottom-5 w-48 shadow-2xl border border-white/10">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-white/50 mb-2 border-b border-white/10 pb-1">Liked by</h4>
              <div className="space-y-2">
                {optimisticLikes.map((liker: any, idx: number) => (
                  <div key={idx} className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full overflow-hidden bg-zinc-800 flex-shrink-0">
                      {liker.avatar?.startsWith('data:image') ? (
                        <img src={liker.avatar} className="w-full h-full object-cover" alt="avatar" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[8px] font-bold text-white bg-indigo-500">
                          {liker.avatar || '👤'}
                        </div>
                      )}
                    </div>
                    <span className="text-white text-[11px] font-bold truncate">{liker.username}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            {optimisticLikes.length > 0 && (
              <span
                className={`text-white font-black text-sm drop-shadow-lg p-1 ${activeStory.uid === currentUserUid ? 'cursor-pointer hover:text-rose-400 transition-colors' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (activeStory.uid === currentUserUid) {
                    setShowLikesList(!showLikesList);
                  }
                }}
              >
                {optimisticLikes.length}
              </span>
            )}
            <button
              onClick={toggleLike}
              className={`p-3 rounded-full backdrop-blur-md transition-all shadow-lg ${optimisticLikes.some((l: any) => l.uid === currentUserUid) ? 'bg-rose-500/90 text-white hover:bg-rose-600 scale-110' : 'bg-black/50 text-white/70 hover:text-white hover:bg-black/70 hover:scale-110'}`}
            >
              <svg className="w-7 h-7" fill={optimisticLikes.some((l: any) => l.uid === currentUserUid) ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const rootElement = document.getElementById('root');
if (rootElement) {
  if (!(rootElement as any).__root) {
    (rootElement as any).__root = createRoot(rootElement);
  }
  (rootElement as any).__root.render(<App />);
}
