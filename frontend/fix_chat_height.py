content = open('frontend/src/components/GoLiveModal.js', 'r', encoding='utf-8').read()
content = content.replace('\r\n', '\n')

start_marker = '  return (\n    <div className={`flex flex-col transition-all duration-300`}>'
end_marker = '};\n\n/**\n * Quick Reaction Buttons'

start = content.find(start_marker)
end = content.find(end_marker, start)

if start == -1 or end == -1:
    raise Exception(f'Markers not found: start={start}, end={end}')

new_block = '''  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid #27272a', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MessageCircle style={{ width: 15, height: 15, color: '#f59e0b' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Live Chat</span>
          <span style={{ fontSize: 11, color: '#71717a' }}>({comments.length})</span>
        </div>
        <button onClick={onToggleExpand} className={`sm:hidden p-1 rounded ${colors.buttonBg}`}>
          {isExpanded ? <ChevronDown className={`w-4 h-4 ${colors.secondaryText}`} /> : <ChevronUp className={`w-4 h-4 ${colors.secondaryText}`} />}
        </button>
      </div>

      {/* Comments list - flex-1 fills all remaining height */}
      <div
        ref={commentsRef}
        style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}
      >
        <AnimatePresence mode="popLayout">
          {comments.slice(-50).map((comment) => (
            <CommentTile
              key={comment.id}
              comment={comment}
              colors={colors}
              onReply={handleReply}
              onLike={onLikeComment}
              currentUserId={currentUserId}
            />
          ))}
        </AnimatePresence>

        {comments.length === 0 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#52525b' }}>
            <MessageCircle style={{ width: 28, height: 28, opacity: 0.3, marginBottom: 8 }} />
            <p style={{ fontSize: 13, margin: 0 }}>No comments yet</p>
            <p style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>Be the first to say something!</p>
          </div>
        )}
      </div>

      {/* Reply indicator */}
      <AnimatePresence>
        {replyingTo && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ padding: '6px 12px', borderTop: '1px solid #27272a', background: '#18181b', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
          >
            <span className={`text-xs ${colors.secondaryText}`}>Replying to</span>
            <span className={`text-xs font-semibold ${colors.accentText}`}>@{replyingTo.user_name}</span>
            <button onClick={() => setReplyingTo(null)} className="ml-auto">
              <X className={`w-3 h-3 ${colors.secondaryText}`} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input - pinned to bottom */}
      <form onSubmit={handleSend} style={{ padding: '10px 12px', borderTop: '1px solid #27272a', background: '#09090b', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder={replyingTo ? `Reply to @${replyingTo.user_name}...` : 'Say something...'}
            className={`flex-1 h-9 text-sm bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500`}
            maxLength={200}
            disabled={sending}
          />
          <Button
            type="submit"
            size="sm"
            disabled={!newComment.trim() || sending}
            className={`${colors.accentBg} text-white h-9 px-3`}
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </form>
    </div>
  );
'''

new_content = content[:start] + new_block + content[end:]

with open('frontend/src/components/GoLiveModal.js', 'w', encoding='utf-8', newline='\n') as f:
    f.write(new_content)

print('Done! Lines replaced:', content[:start].count('\n')+1, 'to', content[:end].count('\n')+1)
print('New file lines:', new_content.count('\n'))
