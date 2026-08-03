// Genera js/config.js a partir de variables de entorno en tiempo de build (Vercel).
// No requiere dependencias externas.
const fs = require('fs');
const path = require('path');

const url = process.env.SUPABASE_URL || '';
const anonKey = process.env.SUPABASE_ANON_KEY || '';

if (!url || !anonKey) {
    console.warn('[build-config] SUPABASE_URL / SUPABASE_ANON_KEY no están definidas. La app no podrá conectar a Supabase.');
}

const content = `window.__SUPABASE_CONFIG__ = ${JSON.stringify({ url, anonKey }, null, 4)};\n`;
fs.writeFileSync(path.join(__dirname, '..', 'js', 'config.js'), content);
console.log('[build-config] js/config.js generado.');
