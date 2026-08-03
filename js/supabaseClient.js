const cfg = window.__SUPABASE_CONFIG__;

if (!cfg || !cfg.url || !cfg.anonKey) {
    console.error('Falta js/config.js con las credenciales de Supabase. Copia js/config.example.js y complétalo (desarrollo local) o define SUPABASE_URL / SUPABASE_ANON_KEY en Vercel.');
}

export const supabase = window.supabase.createClient(cfg?.url, cfg?.anonKey);
