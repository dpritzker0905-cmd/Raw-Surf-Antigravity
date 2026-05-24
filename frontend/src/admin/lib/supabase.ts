import { supabase } from '../../lib/supabase';

// Realtime subscription helper for events and decisions
export const supabaseAdmin = {
  client: supabase,

  subscribeTable: (tableName: string, callback: (payload: any) => void) => {
    if (!supabase) return null;
    
    return supabase
      .channel(`admin-ts-${tableName}-changes`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: tableName },
        (payload) => {
          callback(payload);
        }
      )
      .subscribe();
  },

  unsubscribeTable: (channel: any) => {
    if (channel && supabase) {
      supabase.removeChannel(channel);
    }
  }
};

export default supabaseAdmin;
