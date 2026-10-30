import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) || 'https://xiioocqcxaqxkrxmfafx.supabase.co';
const supabaseAnonKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpaW9vY3FjeGFxeGtyeG1mYWZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzMzAxMzksImV4cCI6MjEwODkwNjEzOX0.GX33XoOVCWNQ9iiRPqtD8VlbBEGc4r-7eQIcw-SGawg';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

