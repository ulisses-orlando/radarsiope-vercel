import { createClient } from '@supabase/supabase-js'

// Vite injeta as variáveis de ambiente do Vercel
const supabaseUrl = 'https://ekrtekidjuwxfspjmmvl.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrcnRla2lkanV3eGZzcGptbXZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0OTQzNTAsImV4cCI6MjA4NjA3MDM1MH0.tm2y114xrBHeRU62beNln8TQmskm2yxap7MiRIAHhoc'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
