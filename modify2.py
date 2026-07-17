import re

with open('index.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

with open('StoryCreatorModal_new.tsx', 'r', encoding='utf-8') as f:
    new_modal = f.read()

# Replace StoryCreatorModal
pattern = re.compile(r'const StoryCreatorModal = \(\{ theme, user, userProfile, onClose, setToast \}: \{.*?\);.*?\};', re.DOTALL)
content = pattern.sub(new_modal.strip(), content)

# Update StoryViewerModal to apply imageTransform
# Find the image rendering inside StoryViewerModal:
#           {activeStory.imageUrl ? (
#             <img src={activeStory.imageUrl} className="absolute inset-0 w-full h-full object-cover" alt="story" />
viewer_pattern = re.compile(r'<img src=\{activeStory\.imageUrl\} className="absolute inset-0 w-full h-full object-cover" alt="story" />')
viewer_replace = '<img src={activeStory.imageUrl} className="absolute inset-0 w-full h-full object-cover" style={{ transform: activeStory.imageTransform ? 	ranslate(px, px) scale() : "none" }} alt="story" />'

content = viewer_pattern.sub(viewer_replace, content)

with open('index.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated index.tsx")
