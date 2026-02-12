// src/lib/supabaseClient.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm"

// As variáveis vêm do .env (configuradas no Vercel)
const supabaseUrl = window.env.VITE_SUPABASE_URL
const supabaseAnonKey = window.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
