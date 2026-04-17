
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://jnfbxcvcbtndtsvscppt.supabase.co';
const supabaseKey = 'sb_publishable_JozrdGtw9LTs58w8BAiXKg_k06DoHww';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data: posts, error } = await supabase
    .from('posts')
    .select('id, caption, media_url, content');
    
  if (error) {
    console.error('Error fetching posts:', error);
    return;
  }
  
  console.log('Total posts:', posts.length);
  
  const emptyPosts = posts.filter(p => !p.caption && !p.media_url && !p.content);
  console.log('Empty posts:', emptyPosts.length);
  
  if (emptyPosts.length > 0) {
    const idsToDelete = emptyPosts.map(p => p.id);
    const { error: deleteError } = await supabase
      .from('posts')
      .delete()
      .in('id', idsToDelete);
      
    if (deleteError) {
      console.error('Failed to delete posts:', deleteError);
    } else {
      console.log('Successfully deleted empty posts:', idsToDelete.length);
    }
  }
}

run();

