import { createClient } from '@supabase/supabase-js'

// Vite injeta as variáveis de ambiente do Vercel
const supabaseUrl = 'https://ekrtekidjuwxfspjmmvl.supabase.co'
const supabaseAnonKey = 'sb_publishable_O4cgL1aB5kqTyd0turl_cw_t9JkvK7u'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
