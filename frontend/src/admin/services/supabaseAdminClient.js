import { supabase } from '../../lib/supabase';

// High-level wrapper for Supabase realtime subscriptions and queries
export const supabaseAdminClient = {
  client: supabase,

  // Subscribe to real-time events on a table
  subscribeToTable: (tableName, callback) => {
    if (!supabase) return null;
    
    return supabase
      .channel(`admin-${tableName}-changes`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: tableName },
        (payload) => {
          callback(payload);
        }
      )
      .subscribe();
  },

  // Unsubscribe from a channel
  unsubscribe: (channel) => {
    if (channel && supabase) {
      supabase.removeChannel(channel);
    }
  }
};

export default supabaseAdminClient;
