content = open('frontend/src/components/GoLiveModal.js', 'r', encoding='utf-8').read()

# Normalize to LF
content = content.replace('\r\n', '\n')

# Find the LiveCommentsFeed return block - locate by the unique outer div classname
start_marker = '  return (\n    <div className={`flex flex-col transition-all duration-300`}>'
end_marker = '};\n\n/**\n * Quick Reaction Buttons'

start = content.find(start_marker)
end = content.find(end_marker, start)

if start == -1:
    print('START MARKER NOT FOUND')
    idx = content.find('flex flex-col transition-all')
    print('Found variant at:', idx)
    print(repr(content[max(0,idx-30):idx+80]))
elif end == -1:
    print('END MARKER NOT FOUND')
else:
    print(f'Block found: lines {content[:start].count(chr(10))+1} to {content[:end].count(chr(10))+1}')
    old_block = content[start:end]
    print('Old block first 200 chars:', repr(old_block[:200]))
