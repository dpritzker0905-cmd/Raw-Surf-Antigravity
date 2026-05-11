import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://mock.supabase.co'
const supabaseAnonKey = 'mock-key'

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing Supabase environment variables. Please check your .env file.')
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '')