import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm"

const supabaseUrl = window.env.VITE_SUPABASE_URL
const supabaseAnonKey = window.env.VITE_SUPABASE_ANON_KEY

console.log("Supabase URL:", supabaseUrl) 
console.log("Supabase Anon Key:", supabaseAnonKey ? "OK (não mostrar chave completa)" : "NÃO DEFINIDA")

const supabase = createClient(supabaseUrl, supabaseAnonKey)

// expõe globalmente
window.supabase = supabase
