const StoryCreatorModal = ({ theme, user, userProfile, onClose, setToast }: { theme: Theme, user: User, userProfile: any, onClose: () => void, setToast: (s: string) => void }) => {
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
  const [editingElementId, setEditingElementId] = useState<string | null>(null);\n
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
            <img src={imageUrl} className="absolute w-full h-full object-cover pointer-events-none" style={{ transform: 	ranslate(px, px) scale(), transition: initialPinch ? "none" : "transform 0.1s ease-out" }} alt="preview" />
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
                className={w-12 h-12 rounded-full flex items-center justify-center text-2xl shadow-xl transition-transform hover:scale-110 active:scale-95 }
                title="Add Text"
              >
                📝
              </button>
              <button
                onClick={() => setShowMovieSearch(true)}
                className={w-12 h-12 rounded-full flex items-center justify-center text-2xl shadow-xl transition-transform hover:scale-110 active:scale-95 }
                title="Tag Movie"
              >
                🎬
              </button>
              <button
                onClick={() => setToast('Friend tagging coming soon!')}
                className={w-12 h-12 rounded-full flex items-center justify-center text-2xl shadow-xl transition-transform hover:scale-110 active:scale-95 }
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
          <button onClick={onClose} className={bsolute top-6 left-6 w-10 h-10 rounded-full flex items-center justify-center shadow-lg z-[200] transition-transform active:scale-95 }>
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
    </div>
  );
};

