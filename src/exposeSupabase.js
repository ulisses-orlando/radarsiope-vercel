import { supabase } from './supabaseClient.js'

// expõe globalmente para scripts em public/js
window.supabase = supabase

console.log("✅ Supabase inicializado e disponível em window.supabase")