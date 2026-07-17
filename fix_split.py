import os

os.chdir(r'c:/Users/Samuel Alalade/OneDrive - Texas Tech University/Other Files/Software/Movie tracker app/Movies-Tracker-Remake')

with open('index.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "rows={el.content.split('" in line and lines[i+1].startswith("').length || 1}"):
        lines[i] = "                      rows={el.content.split('\\n').length || 1}\n"
        lines[i+1] = ""

with open('index.tsx', 'w', encoding='utf-8') as f:
    f.writelines(lines)
print("Fixed newline in split!")
