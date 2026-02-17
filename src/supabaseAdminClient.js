// supabaseAdminClient.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ekrtekidjuwxfspjmmvl.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
