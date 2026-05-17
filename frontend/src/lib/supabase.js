import { createClient } from '@supabase/supabase-js'

var supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
var supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing Supabase environment variables. Please check your .env file.');
}

// We only initialize if variables exist to prevent mock socket errors spamming the console
export var supabase = (supabaseUrl && supabaseAnonKey) 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : null;
