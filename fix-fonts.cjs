const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'index.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Replace specific small text sizes
content = content.replace(/text-\[8px\]/g, 'text-[10px]');
content = content.replace(/text-\[10px\]/g, 'text-xs');
// Replace standard tailwind small sizes
content = content.replace(/\btext-xs\b/g, 'text-sm');
// content = content.replace(/\btext-sm\b/g, 'text-base'); // This might be too aggressive, let's leave it or selectively bump it.

// Increase avatar size from w-8 h-8 to w-10 h-10
content = content.replace(/w-8 h-8 rounded-full/g, 'w-10 h-10 rounded-full');

// The three dots dropdown width:
// Look for w-32 or w-40 near a dropdown.
content = content.replace(/w-32/g, 'w-40');

fs.writeFileSync(filePath, content, 'utf8');
console.log("Updated font sizes!");
