
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type, LiveServerMessage, Modality } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

// --- Config ---
const TMDB_API_KEY = '86eda413b6a6563e449850347d1d7927';
const MODELS = {
  TEXT: 'gemini-3-flash-preview',
  VISION: 'gemini-2.5-flash-image',
  LIVE: 'gemini-2.5-flash-native-audio-preview-09-2025'
};

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) 
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY) 
  : null;

// --- Types ---
interface Movie {
  id?: number;
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
  status: 'list' | 'watching' | 'watched' | 'favorite';
  media_type: 'movie' | 'tv';
  seasons?: number;
  episodes?: number;
  added_at: string;
  tmdb_id?: number;
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

// --- Components ---

const Toast = ({ message, onClose }: { message: string, onClose: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] bg-indigo-600 text-white px-6 py-3 rounded-2xl shadow-2xl font-bold animate-in slide-in-from-bottom-5 fade-in duration-300 flex items-center gap-3 border border-white/20">
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
  theme
}: { 
  movie: Movie, 
  existingGenres: string[], 
  onUpdateStatus: (s: Movie['status']) => void, 
  onUpdateGenre: (g: string) => void, 
  onDelete: () => void, 
  onClose: () => void,
  theme: Theme
}) => {
  const [view, setView] = useState<'main' | 'category' | 'genre'>('main');
  const [customGenre, setCustomGenre] = useState('');
  const glassClass = theme === 'dark' ? 'glass-dark' : 'glass-light';

  return (
    <div className="absolute top-10 left-8 z-50">
      <div className="fixed inset-0 cursor-default" onClick={onClose}></div>
      <div className={`relative ${glassClass} rounded-2xl border ${theme === 'dark' ? 'border-white/10 shadow-2xl' : 'border-zinc-200 shadow-xl'} w-44 sm:w-48 overflow-hidden animate-in zoom-in-95 duration-200 origin-top-left`}>
        {view === 'main' && (
          <div className="flex flex-col p-1.5">
            <button onClick={() => setView('category')} className={`w-full px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest ${theme === 'dark' ? 'hover:bg-white/5 text-zinc-300' : 'hover:bg-zinc-100 text-zinc-600'} rounded-xl flex justify-between items-center transition-colors`}>
              Category <svg className="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
            </button>
            <button onClick={() => setView('genre')} className={`w-full px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest ${theme === 'dark' ? 'hover:bg-white/5 text-zinc-300' : 'hover:bg-zinc-100 text-zinc-600'} rounded-xl flex justify-between items-center transition-colors`}>
              Genre <svg className="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
            </button>
            <div className={`h-px ${theme === 'dark' ? 'bg-white/10' : 'bg-zinc-200'} my-1 mx-2`}></div>
            <button onClick={() => { if(confirm('Remove from collection?')) onDelete(); }} className="w-full px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest hover:bg-rose-500/20 text-rose-500 rounded-xl transition-colors">
              Delete
            </button>
          </div>
        )}

        {view === 'category' && (
          <div className="flex flex-col p-1.5">
            <button onClick={() => setView('main')} className="flex items-center gap-2 px-4 py-2 text-zinc-500 hover:text-indigo-500 transition-colors text-[10px] uppercase font-black">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
              Back
            </button>
            {([['list', 'To Watch'], ['watching', 'Watching'], ['watched', 'Watched'], ['favorite', 'Favorite']] as const).map(([s, label]) => (
              <button key={s} onClick={() => { onUpdateStatus(s); onClose(); }} className={`w-full px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${movie.status === s ? 'bg-indigo-600/20 text-indigo-400' : `${theme === 'dark' ? 'hover:bg-white/5 text-zinc-400' : 'hover:bg-zinc-100 text-zinc-500'} hover:text-indigo-500`}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        {view === 'genre' && (
          <div className="flex flex-col p-1.5 max-h-72 overflow-y-auto no-scrollbar">
            <button onClick={() => setView('main')} className="flex items-center gap-2 px-4 py-2 text-zinc-500 hover:text-indigo-500 transition-colors text-[10px] uppercase font-black mb-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
              Back
            </button>
            <div className="space-y-1">
              {existingGenres.map(g => (
                <button key={g} onClick={() => { onUpdateGenre(g); onClose(); }} className={`w-full px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest rounded-xl transition-colors ${theme === 'dark' ? 'hover:bg-white/5 text-zinc-400' : 'hover:bg-zinc-100 text-zinc-500'} hover:text-indigo-500`}>
                  {g}
                </button>
              ))}
            </div>
            <div className={`mt-3 p-2 ${theme === 'dark' ? 'bg-white/5' : 'bg-zinc-50'} rounded-xl space-y-2`}>
              <input 
                className={`w-full ${theme === 'dark' ? 'bg-black/40 border-white/10 text-white' : 'bg-white border-zinc-200 text-zinc-800'} border rounded-lg px-3 py-2 text-[10px] outline-none focus:border-indigo-500 transition-colors placeholder:text-zinc-500`}
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
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-[9px] font-black uppercase tracking-tighter transition-colors text-white"
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
}

const GenreGroup: React.FC<GenreGroupProps> = ({ 
  genre, 
  movies, 
  existingGenres,
  theme,
  onMovieClick, 
  onUpdateStatus, 
  onUpdateGenre, 
  onDelete 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between py-2 border-b ${theme === 'dark' ? 'border-white/5' : 'border-zinc-200'} group`}
      >
        <div className="flex items-center gap-3">
          <span className={`text-sm font-black uppercase tracking-widest ${theme === 'dark' ? 'text-zinc-500' : 'text-zinc-400'} group-hover:text-indigo-500 transition-colors`}>{genre}</span>
          <span className={`${theme === 'dark' ? 'bg-white/5 text-zinc-400' : 'bg-zinc-100 text-zinc-500'} text-[10px] px-2 py-0.5 rounded-full`}>{movies.length}</span>
        </div>
        <svg className={`w-4 h-4 ${theme === 'dark' ? 'text-zinc-600' : 'text-zinc-400'} transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
      </button>
      
      {isOpen && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4 animate-in slide-in-from-top-2 duration-300">
          {movies.map(m => {
            const isMenuId = m.id || m.tmdb_id;
            const isMenuOpen = activeMenuId === isMenuId;
            return (
              <div key={isMenuId} className={`group relative aspect-[2/3] transition-all duration-300 ${isMenuOpen ? 'z-50' : 'z-0 hover:z-20'}`}>
                <div 
                  onClick={() => onMovieClick(m)}
                  className={`absolute inset-0 rounded-2xl overflow-hidden ring-1 ${theme === 'dark' ? 'ring-white/5 bg-zinc-900' : 'ring-zinc-200 bg-zinc-100'} group-hover:ring-indigo-500/50 transition-all shadow-xl cursor-pointer`}
                >
                  <img src={m.poster} className="w-full h-full object-cover transition-transform group-hover:scale-110" loading="lazy" alt={m.title} />
                  
                  {m.status === 'favorite' && (
                    <div className="absolute top-2 left-2 z-10 bg-yellow-500 text-black p-1 rounded-lg shadow-lg">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                    </div>
                  )}

                  <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent p-3 flex flex-col justify-end pointer-events-none">
                     <h3 className="text-[10px] font-bold line-clamp-1 text-white group-hover:text-indigo-300 transition-colors">{m.title}</h3>
                     <div className="flex justify-between items-center mt-1">
                        <p className="text-[9px] text-yellow-500 font-bold">★ {m.rating?.toFixed(1)}</p>
                        {m.status === 'watching' && (
                          <div className="flex items-center gap-1">
                            <span className="text-[8px] font-black uppercase text-amber-500 tracking-tighter">Live</span>
                            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.8)]"></span>
                          </div>
                        )}
                     </div>
                  </div>
                </div>
                
                <button 
                  onClick={(e) => { e.stopPropagation(); setActiveMenuId(isMenuOpen ? null : isMenuId as number); }}
                  className={`absolute top-2 right-2 p-2 rounded-full transition-all backdrop-blur-md z-10 ${isMenuOpen ? 'bg-indigo-600 text-white scale-110' : 'bg-black/60 text-white/70 hover:bg-black/80 hover:text-white opacity-0 group-hover:opacity-100'}`}
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                </button>

                {isMenuOpen && (
                  <MovieActionMenu 
                    movie={m}
                    theme={theme}
                    // Fix: Use the local prop existingGenres instead of uniqueGenres which is defined in App
                    existingGenres={existingGenres}
                    onUpdateStatus={(s) => { onUpdateStatus(m, s); setActiveMenuId(null); }}
                    onUpdateGenre={(g) => { onUpdateGenre(m, g); setActiveMenuId(null); }}
                    onDelete={() => { onDelete(m); setActiveMenuId(null); }}
                    onClose={() => setActiveMenuId(null)}
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

const DetailModal = ({ movie, theme, isSaved, onClose, onUpdateStatus, onDelete }: { movie: Movie, theme: Theme, isSaved: boolean, onClose: () => void, onUpdateStatus: (s: Movie['status']) => void | Promise<any>, onDelete: () => void | Promise<any> }) => {
  const trailerId = movie.trailer?.split('v=')[1];
  const glassClass = theme === 'dark' ? 'glass-dark' : 'glass-light';
  const textClass = theme === 'dark' ? 'text-zinc-100' : 'text-slate-900';

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
            <div className="w-full h-full flex items-center justify-center bg-zinc-900">
               <img src={movie.poster} className="w-full h-full object-cover blur-3xl opacity-40 absolute inset-0" alt="poster-blur" />
               <p className="relative text-zinc-500 font-black uppercase tracking-widest text-[10px]">No Trailer Available</p>
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
              <span className="text-yellow-500 font-black text-sm">★ {movie.rating?.toFixed(1)}</span>
              <span className={`w-1 h-1 rounded-full ${theme === 'dark' ? 'bg-zinc-700' : 'bg-zinc-300'}`}></span>
              <span className={`font-bold text-xs uppercase tracking-widest ${theme === 'dark' ? 'text-zinc-400' : 'text-slate-500'}`}>{movie.release_year} • {movie.genre}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {[
              { id: 'list', label: 'To Watch', color: 'indigo' },
              { id: 'watching', label: 'Watching', color: 'amber' },
              { id: 'watched', label: 'Watched', color: 'emerald' },
              { id: 'favorite', label: 'Favorite', color: 'rose' }
            ].map(btn => {
              const isActive = isSaved && movie.status === btn.id;
              return (
                <button 
                  key={btn.id}
                  onClick={() => onUpdateStatus(btn.id as any)}
                  className={`flex-1 min-w-[120px] px-6 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border ${isActive ? `bg-${btn.color}-600 border-transparent text-white shadow-xl scale-[1.02]` : `${theme === 'dark' ? 'bg-white/5 border-white/10 text-zinc-500 hover:bg-white/10' : 'bg-zinc-100 border-zinc-200 text-zinc-500 hover:bg-zinc-200'} hover:text-indigo-600 hover:border-indigo-600/30`}`}
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
                <p className={`${theme === 'dark' ? 'text-zinc-300' : 'text-slate-600'} leading-relaxed text-base font-medium`}>{movie.description}</p>
              </div>
              {isSaved && (
                <button 
                  onClick={() => { if(confirm('Permanently remove this from your vault?')) onDelete(); }}
                  className="px-8 py-4 border border-rose-500/20 text-rose-500 hover:bg-rose-500/10 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all"
                >
                  Delete from Vault
                </button>
              )}
            </div>
            <div className="space-y-8">
              <div>
                <h3 className="text-zinc-500 font-black uppercase tracking-widest text-[11px] mb-2">Director</h3>
                <p className={`text-sm font-bold ${textClass} tracking-wide`}>{movie.director}</p>
              </div>
              <div>
                <h3 className="text-zinc-500 font-black uppercase tracking-widest text-[11px] mb-2">Starring</h3>
                <p className={`text-xs ${theme === 'dark' ? 'text-zinc-400' : 'text-slate-500'} leading-relaxed font-medium`}>{movie.cast}</p>
              </div>
              {movie.media_type === 'tv' && (
                <div className={`flex gap-8 border-t ${theme === 'dark' ? 'border-white/5' : 'border-zinc-200'} pt-6`}>
                  <div><h3 className="text-zinc-500 font-black text-[10px] mb-1 uppercase tracking-widest">Seasons</h3><p className="font-bold text-indigo-400 text-lg">{movie.seasons}</p></div>
                  <div><h3 className="text-zinc-500 font-black text-[10px] mb-1 uppercase tracking-widest">Episodes</h3><p className="font-bold text-indigo-400 text-lg">{movie.episodes}</p></div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const App = () => {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('sam_theme') as Theme) || 'dark');
  const [activeTab, setActiveTab] = useState<'collection' | 'discover' | 'ai'>('collection');
  const [filter, setFilter] = useState<Movie['status']>('list');
  const [movies, setMovies] = useState<Movie[]>([]);
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  
  const [aiInput, setAiInput] = useState('');
  const [aiHistory, setAiHistory] = useState<{ role: string, content: string, results?: any[] }[]>([]);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const activeTabRef = useRef(activeTab);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const outAudioCtxRef = useRef<AudioContext | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextStartTimeRef = useRef(0);

  const isSupabaseActive = !!supabase;

  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  useEffect(() => {
    localStorage.setItem('sam_theme', theme);
    document.body.className = theme === 'dark' ? 'bg-[#050505] text-zinc-100 overflow-x-hidden' : 'bg-[#f8fafc] text-slate-900 overflow-x-hidden';
  }, [theme]);

  useEffect(() => {
    const loadAllData = async () => {
      let localMovies: Movie[] = [];
      const saved = localStorage.getItem('sam_movies');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) localMovies = parsed;
        } catch (e) { console.error(e); }
      }

      if (supabase) {
        try {
          const { data, error } = await supabase.from('movie').select('*').order('added_at', { ascending: false });
          if (!error && data) {
            setMovies(data);
            return;
          }
        } catch (e) { console.error("Cloud load error:", e); }
      }
      setMovies(localMovies);
    };

    loadAllData();
  }, [isSupabaseActive]);

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  const isMovieSaved = (tmdb_id?: number) => {
    if (!tmdb_id) return false;
    return movies.some(m => Number(m.tmdb_id) === Number(tmdb_id));
  };

  const getSavedMovie = (tmdb_id?: number) => {
    if (!tmdb_id) return null;
    return movies.find(m => Number(m.tmdb_id) === Number(tmdb_id)) || null;
  };

  const saveMovie = async (movie: Movie) => {
    if (isMovieSaved(movie.tmdb_id)) {
      setToast("Already in your collection!");
      return;
    }

    let finalMovie = { ...movie, added_at: new Date().toISOString() };
    if (supabase) {
      try {
        const { data, error } = await supabase.from('movie').insert([finalMovie]).select();
        if (error) throw error;
        if (data && data[0]) finalMovie = data[0];
      } catch (e) { console.error("Cloud save error:", e); }
    }
    
    const updated = [finalMovie, ...movies];
    setMovies(updated);
    localStorage.setItem('sam_movies', JSON.stringify(updated));
    
    const primaryGenre = movie.genre.split(',')[0].trim().toUpperCase();
    setToast(`${movie.title} added to ${primaryGenre}!`);
    
    if (selectedMovie && Number(selectedMovie.tmdb_id) === Number(movie.tmdb_id)) {
        setSelectedMovie(finalMovie);
    }
  };

  const updateStatus = async (movie: Movie, status: Movie['status']) => {
    const saved = getSavedMovie(movie.tmdb_id);
    if (!saved) {
        await saveMovie({ ...movie, status });
        return;
    }

    const updatedMovie = { ...saved, status };
    if (supabase && saved.id) {
      await supabase.from('movie').update({ status }).eq('id', saved.id);
    }
    const updated = movies.map(m => Number(m.tmdb_id) === Number(movie.tmdb_id) ? updatedMovie : m);
    setMovies(updated);
    localStorage.setItem('sam_movies', JSON.stringify(updated));
    setToast(`Moved to ${status.toUpperCase()}`);
    
    if (selectedMovie && Number(selectedMovie.tmdb_id) === Number(movie.tmdb_id)) {
        setSelectedMovie(updatedMovie);
    }
  };

  const updateGenre = async (movie: Movie, newGenre: string) => {
    const saved = getSavedMovie(movie.tmdb_id);
    if (!saved) return;

    const updatedMovie = { ...saved, genre: newGenre };
    if (supabase && saved.id) {
      await supabase.from('movie').update({ genre: newGenre }).eq('id', saved.id);
    }
    const updated = movies.map(m => Number(m.tmdb_id) === Number(movie.tmdb_id) ? updatedMovie : m);
    setMovies(updated);
    localStorage.setItem('sam_movies', JSON.stringify(updated));
    setToast(`Genre: ${newGenre}`);
  };

  const handleDelete = async (movie: Movie) => {
    const saved = getSavedMovie(movie.tmdb_id);
    if (!saved) return;

    if (supabase && saved.id) await supabase.from('movie').delete().eq('id', saved.id);
    const updated = movies.filter(m => Number(m.tmdb_id) !== Number(movie.tmdb_id));
    setMovies(updated);
    localStorage.setItem('sam_movies', JSON.stringify(updated));
    setSelectedMovie(null);
    setToast("Removed from collection");
  };

  const stopVoiceSearch = () => {
    if (sessionPromiseRef.current) {
        sessionPromiseRef.current.then(session => {
            if (session) try { session.close(); } catch (e) {}
        }).catch(() => {});
        sessionPromiseRef.current = null;
    }
    if (audioProcessorRef.current) {
      try { audioProcessorRef.current.disconnect(); } catch (e) {}
      audioProcessorRef.current = null;
    }
    if (audioSourceRef.current) {
      try { audioSourceRef.current.disconnect(); } catch (e) {}
      audioSourceRef.current = null;
    }
    if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach(track => track.stop());
        audioStreamRef.current = null;
    }
    if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
    }
    if (outAudioCtxRef.current) {
      outAudioCtxRef.current.close().catch(() => {});
      outAudioCtxRef.current = null;
    }
    setIsVoiceActive(false);
  };

  const handleVoiceSearch = async () => {
    if (isVoiceActive) {
      stopVoiceSearch();
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
                          }).catch(() => {});
                        } catch (err) {
                          console.error("PCM stream error:", err);
                        }
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
                            if (activeTabRef.current === 'discover') {
                                setSearchQuery(prev => {
                                    const next = (prev + " " + text).trim();
                                    handleSearch(next);
                                    return next;
                                });
                            } else if (activeTabRef.current === 'ai') {
                                setAiInput(prev => (prev + " " + text).trim());
                            }
                        }
                    }
                },
                onclose: (e) => {
                  console.debug("Session closed:", e);
                  setIsVoiceActive(false);
                },
                onerror: (err: any) => { 
                  console.error("Live Voice Error:", err); 
                  setToast(`Voice API Error: ${err?.message || "Connection failed"}`);
                  stopVoiceSearch(); 
                }
            },
            config: { 
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                  voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }
                },
                inputAudioTranscription: {},
                outputAudioTranscription: {},
                systemInstruction: "You are a movie vault assistant. Do not speak unless spoken to. Quietly transcribe the user's movie titles, genres, or actor names accurately. If they just say a name, transcribe exactly that."
            }
        });
        
        sessionPromiseRef.current = sessionPromise;

    } catch (err: any) {
        console.error("Voice Startup Failure:", err);
        setToast(`Microphone Access Error: ${err?.message || "Permission denied"}`);
        setIsVoiceActive(false);
    }
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
    const res = await fetch(`https://api.themoviedb.org/3/${item.media_type || 'movie'}/${item.id || item.tmdb_id}?api_key=${TMDB_API_KEY}&append_to_response=credits,videos`);
    const d = await res.json();
    const trailer = d.videos?.results?.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube');
    
    return {
      title: d.title || d.name,
      description: d.overview,
      trailer: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : '',
      cast: (d.credits?.cast || []).slice(0, 5).map((c: any) => c.name).join(', '),
      director: (d.credits?.crew || []).find((c: any) => c.job === 'Director')?.name || 'Unknown',
      genre: (d.genres || []).map((g: any) => g.name).join(', ') || 'Uncategorized',
      language: d.original_language,
      rating: d.vote_average,
      release_year: parseInt((d.release_date || d.first_air_date || '0000').substring(0, 4)),
      poster: d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : 'https://via.placeholder.com/500x750',
      status: 'list' as const,
      media_type: item.media_type || 'movie',
      seasons: d.number_of_seasons,
      episodes: d.number_of_episodes,
      added_at: new Date().toISOString(),
      tmdb_id: d.id
    };
  };

  const handlePreviewMovie = async (item: any) => {
    const saved = getSavedMovie(item.id || item.tmdb_id);
    if (saved) {
        setSelectedMovie(saved);
        return;
    }
    const details = await fetchMovieDetails(item);
    setSelectedMovie(details);
  };

  const uniqueGenres = useMemo(() => {
    const set = new Set<string>();
    movies.forEach(m => {
      const g = (m.genre || 'Uncategorized').split(',')[0].trim();
      if (g) set.add(g);
    });
    return Array.from(set).sort();
  }, [movies]);

  const groupedMovies = useMemo<[string, Movie[]][]>(() => {
    const list = movies.filter(m => m.status === filter);
    const groups = list.reduce((acc: Record<string, Movie[]>, movie) => {
      const genre = (movie.genre || 'Uncategorized').split(',')[0].trim() || 'Uncategorized';
      if (!acc[genre]) acc[genre] = [];
      acc[genre].push(movie);
      return acc;
    }, {});
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [movies, filter]);

  const askAi = async (prompt: string) => {
    if (!prompt.trim()) return;
    setIsAiThinking(true);
    setAiHistory(prev => [...prev, { role: 'user', content: prompt }]);
    setAiInput('');
    
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    try {
      const response = await ai.models.generateContent({
        model: MODELS.TEXT,
        contents: `Recommend movies for: ${prompt}. Collection: ${movies.map(m => m.title).join(', ')}. Return JSON: {reply: string, recommendations: [{title: string, tmdb_id: number, media_type: string}]}`,
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

      setAiHistory(prev => [...prev, { role: 'model', content: data.reply || "Suggestions:", results: richRecs }]);
    } catch (e) { console.error(e); }
    finally { setIsAiThinking(false); }
  };

  const navGlass = theme === 'dark' ? 'glass-dark' : 'glass-light';
  const tabBtnClass = (id: string) => 
    `px-8 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
      activeTab === id 
        ? 'bg-indigo-600 text-white shadow-xl' 
        : `${theme === 'dark' ? 'text-zinc-500 hover:text-white' : 'text-zinc-400 hover:text-indigo-600'}`
    }`;

  const displayedModalMovie = useMemo(() => {
    if (!selectedMovie) return null;
    const saved = getSavedMovie(selectedMovie.tmdb_id);
    return saved ? { ...selectedMovie, ...saved } : selectedMovie;
  }, [selectedMovie, movies]);

  const isSelectedSaved = useMemo(() => {
    return isMovieSaved(selectedMovie?.tmdb_id);
  }, [selectedMovie, movies]);

  return (
    <div className={`min-h-screen pb-24 sm:pb-0 selection:bg-indigo-500/30 transition-colors duration-500`}>
      <nav className={`${navGlass} sticky top-0 z-50 px-6 py-5 flex items-center justify-between border-b ${theme === 'dark' ? 'border-white/5' : 'border-zinc-200'}`}>
        <div className="flex items-center gap-4">
           <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-2xl flex items-center justify-center font-black text-white text-xl shadow-2xl">S</div>
           <div>
             <h1 className={`text-xl font-bold font-questrial tracking-tighter uppercase leading-none ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Sam Movies</h1>
             <div className="flex items-center gap-2 mt-1">
                <div className={`w-1.5 h-1.5 rounded-full transition-all duration-700 ${isSupabaseActive ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]' : 'bg-amber-500 animate-pulse'}`}></div>
                <p className={`text-[9px] font-black uppercase tracking-[0.2em] ${theme === 'dark' ? 'text-zinc-500' : 'text-zinc-400'}`}>
                  {isSupabaseActive ? 'Cloud Vault Linked' : 'Offline Storage'}
                </p>
             </div>
           </div>
        </div>
        
        <div className="flex items-center gap-6">
          <button 
            onClick={toggleTheme}
            className={`p-2.5 rounded-2xl transition-all shadow-lg ${theme === 'dark' ? 'bg-white/5 text-yellow-400 hover:bg-white/10' : 'bg-zinc-100 text-indigo-600 hover:bg-zinc-200 border border-zinc-200'}`}
          >
            {theme === 'dark' ? (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/></svg>
            ) : (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58a.996.996 0 00-1.41 0 .996.996 0 000 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37a.996.996 0 00-1.41 0 .996.996 0 000 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96a.996.996 0 000-1.41.996.996 0 00-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36a.996.996 0 000-1.41.996.996 0 00-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"/></svg>
            )}
          </button>

          <div className={`hidden sm:flex ${theme === 'dark' ? 'bg-white/5 border-white/5' : 'bg-zinc-100 border-zinc-200'} p-1.5 rounded-2xl border`}>
            {[
              { id: 'collection', label: 'Vault' },
              { id: 'discover', label: 'Search' },
              { id: 'ai', label: 'AI' }
            ].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id as any)} className={tabBtnClass(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto p-6 sm:p-12">
        {activeTab === 'collection' && (
          <div className="space-y-10 animate-in fade-in duration-700">
             <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                {([['list', 'To Watch'], ['watching', 'Watching'], ['watched', 'Watched'], ['favorite', 'Favorite']] as const).map(([s, label]) => (
                  <button 
                    key={s} 
                    onClick={() => setFilter(s)}
                    className={`px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap border ${
                      filter === s 
                        ? 'bg-indigo-600 border-transparent text-white scale-105 shadow-2xl' 
                        : `${theme === 'dark' ? 'bg-white/5 border-white/5 text-zinc-500' : 'bg-white border-zinc-200 text-zinc-400 shadow-sm'}`
                    }`}
                  >
                    {label}
                  </button>
                ))}
             </div>
             
             <div className="space-y-14">
                {groupedMovies.length > 0 ? (
                  groupedMovies.map(([genre, list]) => (
                    <GenreGroup 
                      key={genre} 
                      genre={genre} 
                      movies={list} 
                      theme={theme}
                      existingGenres={uniqueGenres}
                      onMovieClick={setSelectedMovie} 
                      onUpdateStatus={updateStatus}
                      onUpdateGenre={updateGenre}
                      onDelete={handleDelete}
                    />
                  ))
                ) : (
                  <div className="py-40 text-center space-y-4 opacity-50">
                     <div className={`w-16 h-16 ${theme === 'dark' ? 'bg-white/5' : 'bg-zinc-100'} rounded-full flex items-center justify-center mx-auto mb-4`}>
                        <svg className={`w-8 h-8 ${theme === 'dark' ? 'text-zinc-700' : 'text-zinc-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                     </div>
                     <p className={`${theme === 'dark' ? 'text-zinc-500' : 'text-zinc-400'} font-bold italic tracking-tight`}>No items in your "{filter}" vault.</p>
                  </div>
                )}
             </div>
          </div>
        )}

        {activeTab === 'discover' && (
          <div className="max-w-2xl mx-auto space-y-10 animate-in slide-in-from-bottom-8 duration-700">
             <div className="relative group">
                <input 
                  className={`w-full ${theme === 'dark' ? 'bg-zinc-900 border-white/10 text-white' : 'bg-white border-zinc-200 text-slate-800 shadow-lg'} border rounded-[32px] px-8 py-6 focus:ring-4 focus:ring-indigo-600/20 outline-none transition-all placeholder:text-zinc-400 text-xl font-medium`}
                  placeholder="Summon your next movie..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); if (e.target.value.length > 1) handleSearch(e.target.value); }}
                />
                <div className="absolute right-5 top-1/2 -translate-y-1/2 flex gap-4">
                  <button onClick={handleVoiceSearch} className={`p-3 rounded-2xl transition-all ${isVoiceActive ? 'bg-yellow-500 text-black voice-active shadow-xl' : `${theme === 'dark' ? 'bg-white/5 text-zinc-500' : 'bg-zinc-100 text-zinc-400 hover:text-indigo-600'}`}`}>
                      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
                  </button>
                </div>
             </div>

             <div className="grid grid-cols-1 gap-5">
                {searchResults.map(item => (
                  <div key={item.id} className={`${theme === 'dark' ? 'glass-dark border-white/5' : 'bg-white border-zinc-200 shadow-md'} p-5 rounded-[32px] border flex gap-8 items-center group hover:border-indigo-500/40 transition-all shadow-2xl`}>
                    <div className="w-20 h-28 rounded-2xl overflow-hidden flex-shrink-0 bg-zinc-900 shadow-lg cursor-pointer" onClick={() => handlePreviewMovie(item)}>
                       <img src={item.poster_path ? `https://image.tmdb.org/t/p/w200${item.poster_path}` : 'https://via.placeholder.com/200x300'} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt="poster" />
                    </div>
                    <div className="flex-1 cursor-pointer" onClick={() => handlePreviewMovie(item)}>
                       <h4 className={`font-black text-xl leading-tight tracking-tight group-hover:text-indigo-500 transition-colors ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{item.title || item.name}</h4>
                       <p className={`text-[10px] ${theme === 'dark' ? 'text-zinc-500' : 'text-zinc-400'} font-black uppercase tracking-widest mt-1`}>
                          {item.release_date?.split('-')[0] || item.first_air_date?.split('-')[0] || 'TBA'} • {item.media_type}
                       </p>
                    </div>
                    <div className="flex gap-2">
                       <button 
                         onClick={() => handlePreviewMovie(item)}
                         className={`${theme === 'dark' ? 'bg-white/5 text-zinc-400' : 'bg-zinc-100 text-zinc-500'} p-4 rounded-2xl hover:bg-indigo-600/20 hover:text-indigo-500 transition-all`}
                         title="View Details"
                       >
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                       </button>
                       <button 
                         onClick={async () => { const details = await fetchMovieDetails(item); saveMovie(details); setActiveTab('collection'); }}
                         className={`${theme === 'dark' ? 'bg-white/5 text-white' : 'bg-zinc-100 text-zinc-400'} p-4 rounded-2xl hover:bg-indigo-600 hover:text-white transition-all`}
                         title="Quick Add"
                       >
                          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                       </button>
                    </div>
                  </div>
                ))}
             </div>
          </div>
        )}

        {activeTab === 'ai' && (
          <div className={`max-w-3xl mx-auto h-[78vh] flex flex-col ${theme === 'dark' ? 'glass-dark border-white/5' : 'bg-white border-zinc-200 shadow-2xl'} rounded-[48px] overflow-hidden border`}>
             <div className="flex-1 overflow-y-auto p-8 space-y-10 no-scrollbar">
                {aiHistory.length === 0 && (
                   <div className="h-full flex flex-col items-center justify-center text-center p-12 space-y-4">
                      <div className={`w-16 h-16 ${theme === 'dark' ? 'bg-indigo-600/10' : 'bg-indigo-50'} rounded-2xl flex items-center justify-center mb-2`}>
                        <svg className="w-8 h-8 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" strokeWidth="2" strokeLinecap="round"/></svg>
                      </div>
                      <h3 className={`text-2xl font-black italic uppercase tracking-tighter ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Movie Oracle</h3>
                      <p className={`${theme === 'dark' ? 'text-zinc-500' : 'text-zinc-400'} text-sm max-w-sm italic`}>"Recommend a thriller for tonight..."</p>
                   </div>
                )}
                {aiHistory.map((m, i) => (
                  <div key={i} className={`flex flex-col gap-5 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`p-6 rounded-[32px] max-w-[85%] text-sm font-semibold leading-relaxed shadow-lg ${
                      m.role === 'user' 
                        ? 'bg-indigo-600 text-white rounded-tr-none' 
                        : `${theme === 'dark' ? 'bg-white/5 text-zinc-300' : 'bg-zinc-100 text-slate-700'} rounded-tl-none`
                    }`}>
                       {m.content}
                    </div>
                    {m.results && (
                      <div className="flex gap-5 overflow-x-auto w-full no-scrollbar py-2">
                        {m.results.map((r: any) => (
                          <div key={r.id} className={`${theme === 'dark' ? 'bg-zinc-900 border-white/5' : 'bg-white border-zinc-200'} min-w-[200px] rounded-[32px] overflow-hidden group border transition-all hover:-translate-y-2 hover:border-indigo-500/50 shadow-md`}>
                             <img 
                               src={r.poster_path ? `https://image.tmdb.org/t/p/w200${r.poster_path}` : 'https://via.placeholder.com/200x300'} 
                               className="aspect-[2/3] object-cover group-hover:scale-110 transition-transform duration-700 cursor-pointer" 
                               alt="poster" 
                               onClick={() => handlePreviewMovie(r)}
                             />
                             <div className="p-4 space-y-2">
                                <h5 className={`text-[10px] font-black uppercase truncate tracking-wider ${theme === 'dark' ? 'text-white' : 'text-slate-700'}`}>{r.title || r.name}</h5>
                                <div className="flex gap-2">
                                    <button 
                                        onClick={() => handlePreviewMovie(r)}
                                        className="flex-1 py-3 bg-zinc-800 text-zinc-400 text-[8px] font-black rounded-xl uppercase tracking-widest hover:bg-zinc-700 hover:text-white transition-all"
                                    >
                                        View
                                    </button>
                                    <button 
                                        onClick={async () => { const d = await fetchMovieDetails({ ...r, media_type: r.title ? 'movie' : 'tv' }); saveMovie(d); }} 
                                        className="flex-[1.5] py-3 bg-indigo-600 text-white text-[8px] font-black rounded-xl uppercase tracking-widest shadow-lg shadow-indigo-600/20"
                                    >
                                        Add
                                    </button>
                                </div>
                             </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {isAiThinking && <div className="text-indigo-500 text-[10px] font-black uppercase tracking-[0.3em] animate-pulse pl-4 italic">The Oracle is dreaming...</div>}
             </div>
             
             <div className={`p-6 flex gap-4 items-center ${theme === 'dark' ? 'bg-black/40 border-white/5' : 'bg-zinc-50 border-zinc-200'} border-t backdrop-blur-xl`}>
                <button onClick={handleVoiceSearch} className={`p-5 rounded-3xl transition-all ${isVoiceActive ? 'bg-yellow-500 text-black voice-active shadow-2xl' : `${theme === 'dark' ? 'bg-white/5 text-zinc-500' : 'bg-white text-zinc-400 border border-zinc-200 shadow-sm'}`}`}>
                   <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
                </button>
                <input 
                  className={`flex-1 ${theme === 'dark' ? 'bg-zinc-900 border-white/5 text-white' : 'bg-white border-zinc-200 text-slate-800'} border rounded-3xl px-8 py-5 text-base font-medium focus:ring-4 focus:ring-indigo-600/10 outline-none transition-all placeholder:text-zinc-500`}
                  placeholder="Ask the Oracle..."
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { askAi(aiInput); } }}
                />
             </div>
          </div>
        )}
      </main>

      {/* Bottom Navigation */}
      <nav className={`sm:hidden fixed bottom-0 left-0 w-full ${theme === 'dark' ? 'glass-dark border-white/5' : 'bg-white/90 border-zinc-200 shadow-[0_-5px_20px_rgba(0,0,0,0.05)]'} border-t px-10 pt-5 pb-12 flex justify-between safe-bottom z-50 backdrop-blur-3xl transition-colors`}>
         {[
           { id: 'collection', label: 'Vault', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2' },
           { id: 'discover', label: 'Search', icon: 'M12 4v16m8-8H4' },
           { id: 'ai', label: 'AI', icon: 'M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z' }
         ].map(tab => (
           <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`flex flex-col items-center gap-2 transition-all duration-300 ${activeTab === tab.id ? 'text-indigo-500 scale-110' : 'text-zinc-400'}`}>
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={tab.icon} /></svg>
              <span className="text-[9px] font-black uppercase tracking-[0.2em]">{tab.label}</span>
           </button>
         ))}
      </nav>

      {/* Overlays */}
      {displayedModalMovie && (
        <DetailModal 
          movie={displayedModalMovie} 
          theme={theme}
          isSaved={isSelectedSaved}
          onClose={() => setSelectedMovie(null)} 
          onUpdateStatus={(s) => updateStatus(displayedModalMovie, s)}
          onDelete={() => handleDelete(displayedModalMovie)}
        />
      )}
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
