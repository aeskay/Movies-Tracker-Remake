
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type, Modality, LiveServerMessage } from "@google/genai";
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

// --- Utils ---
const encodePCM = (data: Float32Array) => {
  const int16 = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) int16[i] = data[i] * 32768;
  let binary = '';
  const bytes = new Uint8Array(int16.buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

// --- Components ---

const Toast = ({ message, onClose }: { message: string, onClose: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] bg-indigo-600 text-white px-6 py-3 rounded-2xl shadow-2xl font-bold animate-in slide-in-from-bottom-5 fade-in duration-300 flex items-center gap-3">
       <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
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
  onClose 
}: { 
  movie: Movie, 
  existingGenres: string[], 
  onUpdateStatus: (s: Movie['status']) => void, 
  onUpdateGenre: (g: string) => void, 
  onDelete: () => void, 
  onClose: () => void 
}) => {
  const [view, setView] = useState<'main' | 'category' | 'genre'>('main');
  const [customGenre, setCustomGenre] = useState('');

  return (
    <div className="absolute top-10 right-0 z-50">
      <div className="fixed inset-0 cursor-default" onClick={onClose}></div>
      <div className="relative glass-dark rounded-2xl border border-white/10 shadow-2xl w-48 sm:w-52 overflow-hidden animate-in zoom-in-95 duration-200">
        {view === 'main' && (
          <div className="flex flex-col p-1.5">
            <button onClick={() => setView('category')} className="w-full px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest hover:bg-white/5 rounded-xl flex justify-between items-center transition-colors">
              Change Category <svg className="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
            </button>
            <button onClick={() => setView('genre')} className="w-full px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest hover:bg-white/5 rounded-xl flex justify-between items-center transition-colors">
              Change Genre <svg className="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
            </button>
            <div className="h-px bg-white/10 my-1 mx-2"></div>
            <button onClick={() => { if(confirm('Remove from collection?')) onDelete(); }} className="w-full px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest hover:bg-rose-500/20 text-rose-500 rounded-xl transition-colors">
              Delete
            </button>
          </div>
        )}

        {view === 'category' && (
          <div className="flex flex-col p-1.5">
            <button onClick={() => setView('main')} className="flex items-center gap-2 px-4 py-2 text-zinc-500 hover:text-white transition-colors text-[10px] uppercase font-black">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
              Back
            </button>
            {([['list', 'To Watch'], ['watching', 'Watching'], ['watched', 'Watched'], ['favorite', 'Favorite']] as const).map(([s, label]) => (
              <button key={s} onClick={() => { onUpdateStatus(s); onClose(); }} className={`w-full px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${movie.status === s ? 'bg-indigo-600/20 text-indigo-400' : 'hover:bg-white/5 text-zinc-400 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        {view === 'genre' && (
          <div className="flex flex-col p-1.5 max-h-72 overflow-y-auto no-scrollbar">
            <button onClick={() => setView('main')} className="flex items-center gap-2 px-4 py-2 text-zinc-500 hover:text-white transition-colors text-[10px] uppercase font-black mb-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
              Back
            </button>
            <div className="space-y-1">
              {existingGenres.map(g => (
                <button key={g} onClick={() => { onUpdateGenre(g); onClose(); }} className="w-full px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest hover:bg-white/5 text-zinc-400 hover:text-white rounded-xl transition-colors">
                  {g}
                </button>
              ))}
            </div>
            <div className="mt-3 p-2 bg-white/5 rounded-xl space-y-2">
              <input 
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[10px] outline-none focus:border-indigo-500 transition-colors placeholder:text-zinc-600"
                placeholder="Custom Genre..."
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
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-[9px] font-black uppercase tracking-tighter transition-colors"
              >
                Add New Genre
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
  onMovieClick: (m: Movie) => void;
  onUpdateStatus: (m: Movie, s: Movie['status']) => void | Promise<any>;
  onUpdateGenre: (m: Movie, g: string) => void | Promise<any>;
  onDelete: (m: Movie) => void | Promise<any>;
}

const GenreGroup: React.FC<GenreGroupProps> = ({ 
  genre, 
  movies, 
  existingGenres,
  onMovieClick, 
  onUpdateStatus, 
  onUpdateGenre, 
  onDelete 
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const [activeMenuId, setActiveMenuId] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between py-2 border-b border-white/5 group"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-black uppercase tracking-widest text-zinc-500 group-hover:text-indigo-400 transition-colors">{genre}</span>
          <span className="bg-white/5 text-[10px] px-2 py-0.5 rounded-full text-zinc-400">{movies.length}</span>
        </div>
        <svg className={`w-4 h-4 text-zinc-600 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
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
                  className="absolute inset-0 rounded-2xl overflow-hidden ring-1 ring-white/5 group-hover:ring-indigo-500/50 transition-all shadow-xl cursor-pointer bg-zinc-900"
                >
                  <img src={m.poster} className="w-full h-full object-cover transition-transform group-hover:scale-110" loading="lazy" />
                  
                  {/* Status Overlays */}
                  {m.status === 'favorite' && (
                    <div className="absolute top-2 left-2 z-10 bg-yellow-500 text-black p-1 rounded-lg shadow-lg">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                    </div>
                  )}

                  <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent p-3 flex flex-col justify-end pointer-events-none">
                     <h3 className="text-[10px] font-bold line-clamp-1 group-hover:text-indigo-300 transition-colors">{m.title}</h3>
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

const DetailModal = ({ movie, onClose, onUpdateStatus, onDelete }: { movie: Movie, onClose: () => void, onUpdateStatus: (s: Movie['status']) => void | Promise<any>, onDelete: () => void | Promise<any> }) => {
  const trailerId = movie.trailer?.split('v=')[1];
  
  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/95 backdrop-blur-md animate-in fade-in duration-300" onClick={onClose}></div>
      <div className="relative glass-dark w-full max-w-4xl h-full sm:h-auto max-h-[95vh] overflow-y-auto rounded-t-[40px] sm:rounded-[40px] shadow-2xl animate-in slide-in-from-bottom-10 duration-500 no-scrollbar">
        <button onClick={onClose} className="fixed sm:absolute top-5 right-5 z-[110] p-3 bg-black/50 rounded-full text-white/70 hover:text-white backdrop-blur-md transition-colors">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>

        <div className="relative aspect-video w-full bg-zinc-900 overflow-hidden">
          {trailerId ? (
            <iframe className="w-full h-full scale-105" src={`https://www.youtube.com/embed/${trailerId}?autoplay=1`} allow="autoplay" allowFullScreen title="trailer"></iframe>
          ) : (
            <img src={movie.poster} className="w-full h-full object-cover blur-3xl opacity-40" alt="poster-blur" />
          )}
          <div className="absolute bottom-0 left-0 w-full p-8 bg-gradient-to-t from-zinc-950 via-zinc-950/80 to-transparent">
            <h2 className="text-4xl font-black text-white leading-tight tracking-tight">{movie.title}</h2>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-yellow-500 font-black text-sm">★ {movie.rating?.toFixed(1)}</span>
              <span className="w-1 h-1 rounded-full bg-zinc-700"></span>
              <span className="text-zinc-400 font-bold text-xs uppercase tracking-widest">{movie.release_year} • {movie.genre}</span>
            </div>
          </div>
        </div>

        <div className="p-8 space-y-8">
          <div className="flex flex-wrap gap-3">
            {[
              { id: 'list', label: 'To Watch', color: 'indigo' },
              { id: 'watching', label: 'Watching', color: 'amber' },
              { id: 'watched', label: 'Watched', color: 'emerald' },
              { id: 'favorite', label: 'Favorite', color: 'rose' }
            ].map(btn => (
              <button 
                key={btn.id}
                onClick={() => onUpdateStatus(btn.id as any)}
                className={`flex-1 min-w-[120px] px-6 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border ${movie.status === btn.id ? `bg-${btn.color}-600 border-transparent text-white shadow-xl scale-[1.02]` : 'bg-white/5 border-white/10 text-zinc-500 hover:bg-white/10 hover:text-white'}`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 pb-10">
            <div className="md:col-span-2 space-y-6">
              <div>
                <h3 className="text-indigo-500 font-black uppercase tracking-widest text-[11px] mb-3">Storyline</h3>
                <p className="text-zinc-300 leading-relaxed text-base font-medium">{movie.description}</p>
              </div>
            </div>
            <div className="space-y-8">
              <div>
                <h3 className="text-zinc-500 font-black uppercase tracking-widest text-[11px] mb-2">Director</h3>
                <p className="text-sm font-bold text-white tracking-wide">{movie.director}</p>
              </div>
              <div>
                <h3 className="text-zinc-500 font-black uppercase tracking-widest text-[11px] mb-2">Starring</h3>
                <p className="text-xs text-zinc-400 leading-relaxed font-medium">{movie.cast}</p>
              </div>
              {movie.media_type === 'tv' && (
                <div className="flex gap-8 border-t border-white/5 pt-6">
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
  const [activeTab, setActiveTab] = useState<'collection' | 'discover' | 'ai'>('collection');
  const [filter, setFilter] = useState<Movie['status']>('list');
  const [movies, setMovies] = useState<Movie[]>([]);
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [localOnlyCount, setLocalOnlyCount] = useState(0);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  
  const [aiHistory, setAiHistory] = useState<{ role: string, content: string, results?: any[] }[]>([]);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  
  const sessionPromiseRef = useRef<Promise<any> | null>(null);

  const isSupabaseActive = !!supabase;

  // --- Persistence ---
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
            const cloudTmdbIds = new Set(data.map(m => m.tmdb_id));
            const diff = localMovies.filter(m => !cloudTmdbIds.has(m.tmdb_id)).length;
            setLocalOnlyCount(diff);
            return;
          }
        } catch (e) { console.error("Cloud load error:", e); }
      }
      setMovies(localMovies);
    };

    loadAllData();
  }, [isSupabaseActive]);

  const syncLocalToCloud = async () => {
    if (!supabase || isSyncing) return;
    setIsSyncing(true);
    setToast("Transferring data to cloud vault...");

    try {
      const saved = localStorage.getItem('sam_movies');
      if (!saved) return;
      const localMovies: Movie[] = JSON.parse(saved);
      
      const { data: cloudData } = await supabase.from('movie').select('tmdb_id');
      const cloudIds = new Set(cloudData?.map(m => m.tmdb_id) || []);
      
      const toSync = localMovies.filter(m => !cloudIds.has(m.tmdb_id)).map(({ id, ...rest }) => rest);
      
      if (toSync.length > 0) {
        const { error } = await supabase.from('movie').insert(toSync);
        if (error) throw error;
      }
      
      const { data } = await supabase.from('movie').select('*').order('added_at', { ascending: false });
      if (data) setMovies(data);
      setLocalOnlyCount(0);
      setToast(`Vault Synced! ${toSync.length} items updated.`);
    } catch (e) {
      console.error(e);
      setToast("Connection failed. Check your API settings.");
    } finally {
      setIsSyncing(false);
    }
  };

  const saveMovie = async (movie: Movie) => {
    if (movies.find(m => m.tmdb_id === movie.tmdb_id)) {
      setToast("Already in your collection!");
      return;
    }

    let finalMovie = movie;
    if (supabase) {
      try {
        const { data, error } = await supabase.from('movie').insert([movie]).select();
        if (error) throw error;
        if (data && data[0]) finalMovie = data[0];
      } catch (e) { console.error("Cloud save error:", e); }
    }
    
    const updated = [finalMovie, ...movies];
    setMovies(updated);
    localStorage.setItem('sam_movies', JSON.stringify(updated));
    setToast(`${movie.title} added to collection!`);
  };

  const updateStatus = async (movie: Movie, status: Movie['status']) => {
    const updatedMovie = { ...movie, status };
    if (supabase && movie.id) {
      await supabase.from('movie').update({ status }).eq('id', movie.id);
    }
    const updated = movies.map(m => (m.id || m.tmdb_id) === (movie.id || movie.tmdb_id) ? updatedMovie : m);
    setMovies(updated);
    localStorage.setItem('sam_movies', JSON.stringify(updated));
    setToast(`Status: ${status.toUpperCase()}`);
  };

  const updateGenre = async (movie: Movie, newGenre: string) => {
    const updatedMovie = { ...movie, genre: newGenre };
    if (supabase && movie.id) {
      await supabase.from('movie').update({ genre: newGenre }).eq('id', movie.id);
    }
    const updated = movies.map(m => (m.id || m.tmdb_id) === (movie.id || movie.tmdb_id) ? updatedMovie : m);
    setMovies(updated);
    localStorage.setItem('sam_movies', JSON.stringify(updated));
    setToast(`Genre: ${newGenre}`);
  };

  const handleDelete = async (movie: Movie) => {
    if (supabase && movie.id) await supabase.from('movie').delete().eq('id', movie.id);
    const updated = movies.filter(m => (m.id || m.tmdb_id) !== (movie.id || movie.tmdb_id));
    setMovies(updated);
    localStorage.setItem('sam_movies', JSON.stringify(updated));
    setSelectedMovie(null);
    setToast("Removed from collection");
  };

  const handleVoiceSearch = async () => {
    if (isVoiceActive) return;
    setIsVoiceActive(true);
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        sessionPromiseRef.current = ai.live.connect({
            model: MODELS.LIVE,
            callbacks: {
                onopen: () => {
                    const source = audioCtx.createMediaStreamSource(stream);
                    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
                    processor.onaudioprocess = (e) => {
                        const data = e.inputBuffer.getChannelData(0);
                        sessionPromiseRef.current?.then(session => {
                          session.sendRealtimeInput({ media: { data: encodePCM(data), mimeType: 'audio/pcm;rate=16000' } });
                        });
                    };
                    source.connect(processor); processor.connect(audioCtx.destination);
                },
                onmessage: async (msg: LiveServerMessage) => {
                    if (msg.serverContent?.inputTranscription) {
                        const text = msg.serverContent.inputTranscription.text;
                        if (text) {
                            setSearchQuery(prev => prev + text);
                            handleSearch(text);
                        }
                    }
                    if (msg.serverContent?.turnComplete) { setIsVoiceActive(false); }
                },
                onclose: () => setIsVoiceActive(false),
                onerror: () => setIsVoiceActive(false)
            },
            config: { 
                responseModalities: [Modality.AUDIO],
                inputAudioTranscription: {}
            }
        });
    } catch (err) {
        console.error(err);
        setIsVoiceActive(false);
    }
  };

  const handleSearch = async (query: string) => {
    if (!query) return;
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
    const res = await fetch(`https://api.themoviedb.org/3/${item.media_type || 'movie'}/${item.id}?api_key=${TMDB_API_KEY}&append_to_response=credits,videos`);
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

  return (
    <div className="min-h-screen pb-24 sm:pb-0 bg-[#050505] text-zinc-100 selection:bg-indigo-500/30">
      <nav className="glass-dark sticky top-0 z-50 px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
           <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-2xl flex items-center justify-center font-black text-white text-xl shadow-2xl">S</div>
           <div>
             <h1 className="text-xl font-black tracking-tighter italic uppercase text-white leading-none">Sam Movies</h1>
             <div className="flex items-center gap-2 mt-1">
                <div className={`w-1.5 h-1.5 rounded-full transition-all duration-700 ${isSupabaseActive ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]' : 'bg-amber-500 animate-pulse'}`}></div>
                <p className="text-[9px] text-zinc-500 font-black uppercase tracking-[0.2em]">
                  {isSupabaseActive ? 'Cloud Vault Linked' : 'Offline Storage'}
                </p>
             </div>
           </div>
        </div>
        
        <div className="flex items-center gap-4">
          {localOnlyCount > 0 && isSupabaseActive && (
            <button 
              onClick={syncLocalToCloud} 
              disabled={isSyncing}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600/20 text-emerald-400 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-600 hover:text-white transition-all animate-bounce"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
              Sync {localOnlyCount}
            </button>
          )}

          <div className="hidden sm:flex bg-white/5 p-1.5 rounded-2xl border border-white/5">
            {[
              { id: 'collection', label: 'Vault' },
              { id: 'discover', label: 'Search' },
              { id: 'ai', label: 'AI' }
            ].map(t => (
              <button 
                  key={t.id} 
                  onClick={() => setActiveTab(t.id as any)} 
                  className={`px-8 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === t.id ? 'bg-indigo-600 text-white shadow-xl' : 'text-zinc-500 hover:text-white'}`}
              >
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
                    className={`px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap border ${filter === s ? 'bg-indigo-600 border-transparent text-white scale-105 shadow-2xl' : 'bg-white/5 border-white/5 text-zinc-500'}`}
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
                      existingGenres={uniqueGenres}
                      onMovieClick={setSelectedMovie} 
                      onUpdateStatus={updateStatus}
                      onUpdateGenre={updateGenre}
                      onDelete={handleDelete}
                    />
                  ))
                ) : (
                  <div className="py-40 text-center space-y-4 opacity-50">
                     <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                     </div>
                     <p className="text-zinc-500 font-bold italic tracking-tight">No items tagged as "{filter}" in your vault.</p>
                  </div>
                )}
             </div>
          </div>
        )}

        {activeTab === 'discover' && (
          <div className="max-w-2xl mx-auto space-y-10 animate-in slide-in-from-bottom-8 duration-700">
             <div className="relative group">
                <input 
                  className="w-full bg-zinc-900 border border-white/10 rounded-[32px] px-8 py-6 focus:ring-4 focus:ring-indigo-600/20 outline-none transition-all placeholder:text-zinc-700 text-xl font-medium shadow-2xl"
                  placeholder="Summon your next movie..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); if (e.target.value.length > 2) handleSearch(e.target.value); }}
                />
                <div className="absolute right-5 top-1/2 -translate-y-1/2 flex gap-4">
                  <button onClick={handleVoiceSearch} className={`p-3 rounded-2xl transition-all ${isVoiceActive ? 'bg-yellow-500 text-black voice-active shadow-xl' : 'bg-white/5 text-zinc-500 hover:text-white'}`}>
                      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
                  </button>
                </div>
             </div>

             <div className="grid grid-cols-1 gap-5">
                {searchResults.map(item => (
                  <div key={item.id} className="glass-dark p-5 rounded-[32px] flex gap-8 items-center group cursor-pointer hover:border-indigo-500/40 transition-all shadow-2xl" onClick={async () => { const details = await fetchMovieDetails(item); saveMovie(details); setActiveTab('collection'); }}>
                    <div className="w-20 h-28 rounded-2xl overflow-hidden flex-shrink-0 bg-zinc-900 shadow-lg">
                       <img src={item.poster_path ? `https://image.tmdb.org/t/p/w200${item.poster_path}` : 'https://via.placeholder.com/200x300'} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt="poster" />
                    </div>
                    <div className="flex-1">
                       <h4 className="font-black text-xl leading-tight tracking-tight group-hover:text-indigo-400 transition-colors">{item.title || item.name}</h4>
                       <p className="text-[10px] text-zinc-500 font-black uppercase tracking-widest mt-1">
                          {item.release_date?.split('-')[0] || item.first_air_date?.split('-')[0] || 'TBA'} • {item.media_type}
                       </p>
                    </div>
                    <div className="bg-white/5 p-4 rounded-2xl group-hover:bg-indigo-600 group-hover:text-white transition-all">
                       <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                    </div>
                  </div>
                ))}
             </div>
          </div>
        )}

        {activeTab === 'ai' && (
          <div className="max-w-3xl mx-auto h-[78vh] flex flex-col glass-dark rounded-[48px] overflow-hidden border border-white/5 shadow-2xl">
             <div className="flex-1 overflow-y-auto p-8 space-y-10 no-scrollbar">
                {aiHistory.length === 0 && (
                   <div className="h-full flex flex-col items-center justify-center text-center p-12 space-y-4">
                      <div className="w-16 h-16 bg-indigo-600/10 rounded-2xl flex items-center justify-center mb-2">
                        <svg className="w-8 h-8 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" strokeWidth="2" strokeLinecap="round"/></svg>
                      </div>
                      <h3 className="text-2xl font-black italic uppercase tracking-tighter text-white">Movie Oracle</h3>
                      <p className="text-zinc-500 text-sm max-w-sm italic">"Looking for a mind-bending thriller similar to Inception..."</p>
                   </div>
                )}
                {aiHistory.map((m, i) => (
                  <div key={i} className={`flex flex-col gap-5 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`p-6 rounded-[32px] max-w-[85%] text-sm font-semibold leading-relaxed shadow-lg ${m.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-white/5 text-zinc-300 rounded-tl-none'}`}>
                       {m.content}
                    </div>
                    {m.results && (
                      <div className="flex gap-5 overflow-x-auto w-full no-scrollbar py-2">
                        {m.results.map((r: any) => (
                          <div key={r.id} className="min-w-[150px] bg-zinc-900 rounded-[32px] overflow-hidden group border border-white/5 transition-all hover:-translate-y-2 hover:border-indigo-500/50">
                             <img src={r.poster_path ? `https://image.tmdb.org/t/p/w200${r.poster_path}` : 'https://via.placeholder.com/200x300'} className="aspect-[2/3] object-cover group-hover:scale-110 transition-transform duration-700" alt="poster" />
                             <div className="p-4">
                                <h5 className="text-[10px] font-black uppercase truncate mb-3 tracking-wider">{r.title || r.name}</h5>
                                <button onClick={async () => { const d = await fetchMovieDetails({ ...r, media_type: r.title ? 'movie' : 'tv' }); saveMovie(d); }} className="w-full py-3 bg-indigo-600 text-[9px] font-black rounded-2xl uppercase tracking-[0.2em] shadow-lg shadow-indigo-600/20">Add To Vault</button>
                             </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {isAiThinking && <div className="text-indigo-500 text-[10px] font-black uppercase tracking-[0.3em] animate-pulse pl-4 italic">The Oracle is dreaming...</div>}
             </div>
             
             <div className="p-6 flex gap-4 items-center bg-black/40 border-t border-white/5 backdrop-blur-xl">
                <button onClick={handleVoiceSearch} className={`p-5 rounded-3xl transition-all ${isVoiceActive ? 'bg-yellow-500 text-black voice-active shadow-2xl' : 'bg-white/5 text-zinc-500 hover:text-white'}`}>
                   <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
                </button>
                <input 
                  className="flex-1 bg-zinc-900 border border-white/5 rounded-3xl px-8 py-5 text-base font-medium focus:ring-4 focus:ring-indigo-600/10 outline-none transition-all placeholder:text-zinc-700"
                  placeholder="Ask the Oracle..."
                  onKeyDown={(e) => { if (e.key === 'Enter') { askAi(e.currentTarget.value); e.currentTarget.value = ''; } }}
                />
             </div>
          </div>
        )}
      </main>

      {/* Bottom Navigation */}
      <nav className="sm:hidden fixed bottom-0 left-0 w-full glass-dark border-t border-white/5 px-10 pt-5 pb-12 flex justify-between safe-bottom z-50 backdrop-blur-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
         {[
           { id: 'collection', label: 'Vault', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2' },
           { id: 'discover', label: 'Search', icon: 'M12 4v16m8-8H4' },
           { id: 'ai', label: 'AI', icon: 'M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z' }
         ].map(tab => (
           <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`flex flex-col items-center gap-2 transition-all duration-300 ${activeTab === tab.id ? 'text-indigo-400 scale-110' : 'text-zinc-600'}`}>
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={tab.icon} /></svg>
              <span className="text-[9px] font-black uppercase tracking-[0.2em]">{tab.label}</span>
           </button>
         ))}
      </nav>

      {/* Overlays */}
      {selectedMovie && (
        <DetailModal 
          movie={selectedMovie} 
          onClose={() => setSelectedMovie(null)} 
          onUpdateStatus={(s) => updateStatus(selectedMovie, s)}
          onDelete={() => handleDelete(selectedMovie)}
        />
      )}
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
