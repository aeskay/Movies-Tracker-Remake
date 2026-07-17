import os

os.chdir(r'c:/Users/Samuel Alalade/OneDrive - Texas Tech University/Other Files/Software/Movie tracker app/Movies-Tracker-Remake')

with open('index.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the 3 divs at the end with 2 divs
fix_pattern = r'          </div>\n      </div>\n    </div>\n  );\n};'
fix_replacement = r'      </div>\n    </div>\n  );\n};'
content = content.replace('          </div>\n      </div>\n    </div>\n  );\n};', '      </div>\n    </div>\n  );\n};')

with open('index.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed extra div!")
