import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm"

const supabaseUrl = window.env.VITE_SUPABASE_URL
const supabaseAnonKey = window.env.VITE_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseAnonKey)

// expõe globalmente
window.supabase = supabase
