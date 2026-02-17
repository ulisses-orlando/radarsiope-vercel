// supabaseAdminClient.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ekrtekidjuwxfspjmmvl.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrcnRla2lkanV3eGZzcGptbXZsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDQ5NDM1MCwiZXhwIjoyMDg2MDcwMzUwfQ.3Kjj1_lgrOe2XeiaCHTrrkBfind8PkehmxNnKxz0bms';

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
