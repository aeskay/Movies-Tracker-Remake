import re

with open('StoryCreatorModal.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

state_insertion = '''
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
'''
content = content.replace('  const [editingElementId, setEditingElementId] = useState<string | null>(null);', '  const [editingElementId, setEditingElementId] = useState<string | null>(null);\\n' + state_insertion)

handle_post = '''imageUrl: imageUrl || null,
        imageTransform: { scale: bgScale, x: bgTranslate.x, y: bgTranslate.y },'''
content = content.replace('imageUrl: imageUrl || null,', handle_post)

content = content.replace('md:grid-cols-[1fr_300px] gap-6 animate-in zoom-in-95 duration-200 overflow-y-auto max-h-[90vh]', 'max-w-[450px] w-full p-0 flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden h-[90vh] md:h-[95vh] mx-auto')
content = content.replace('aspect-[9/16] bg-zinc-950 rounded-2xl overflow-hidden border border-white/10 flex flex-col justify-center items-center shadow-inner max-h-[70vh] md:max-h-none mx-auto w-full max-w-[400px] touch-none select-none', 'w-full h-full bg-zinc-950 flex flex-col justify-center items-center shadow-inner touch-none select-none overflow-hidden')

container_search = 'onPointerMove={handlePointerMove}'
container_replace = '''onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onPointerMove={handlePointerMove}'''
content = content.replace(container_search, container_replace)

img_search = '<img src={imageUrl} className="w-full h-full object-cover pointer-events-none" alt="preview" />'
img_replace = '<img src={imageUrl} className="absolute w-full h-full object-cover pointer-events-none" style={{ transform: 	ranslate(px, px) scale(), transition: initialPinch ? "none" : "transform 0.1s ease-out" }} alt="preview" />'
content = content.replace(img_search, img_replace)

overlays = '''
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
'''

# First remove the share button block at the bottom
# The old block looks like:
#           <button
#             onClick={handlePost}
#             disabled={isSubmitting}
#             className="w-full py-3.5 mt-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-sm font-black uppercase tracking-wider transition-all shadow-lg shadow-indigo-600/30 disabled:opacity-50"
#           >
#             {isSubmitting ? "Sharing..." : "Share Story"}
#           </button>
#         </div>
#       </div>
#     </div>
#   );
share_pattern = re.compile(r'\s*<button\s+onClick=\{handlePost\}[\s\S]*?</button>\s*</div>\s*</div>\s*</div>\s*\);\s*\}', re.DOTALL)
content = share_pattern.sub('\\n      </div>\\n    </div>\\n  );\\n}', content)

# Then inject overlays and movie tag search
pattern = re.compile(r'\s*\{/\* Right Side: Editor Controls \*/\}.*?\{/\* Movie Tag Search Overlay \*/\}', re.DOTALL)
content = pattern.sub(overlays + '\\n            {/* Movie Tag Search Overlay */}', content)

with open('StoryCreatorModal_new.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated StoryCreatorModal_new.tsx")
