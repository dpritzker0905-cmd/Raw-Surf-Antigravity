import os
import re

def fix_dialog_titles(directory):
    count = 0
    
    for root, _, files in os.walk(directory):
        for file in files:
            if not file.endswith('.js') and not file.endswith('.jsx'):
                continue
                
            filepath = os.path.join(root, file)
            with open(filepath, 'r', encoding='utf-8') as f:
                original_content = f.read()

            if 'DialogContent' not in original_content:
                continue

            content = original_content
            
            # Step 1: Ensure DialogTitle is imported
            if 'DialogTitle' not in content:
                # Find import { ..., DialogContent, ... } from '.../dialog'
                import_pattern = r'(import\s+\{[^\}]*)(DialogContent)([^\}]*\})(.*dialog.*)'
                def import_replacement(m):
                    return m.group(1) + m.group(2) + ", DialogTitle" + m.group(3) + m.group(4)
                
                new_content = re.sub(import_pattern, import_replacement, content)
                # Fallback if pattern didn't match perfectly but dialog import exists
                if new_content == content and re.search(r'import\s+\{.*\}\s+from\s+[\'"].*dialog[\'"]', content):
                     new_content = re.sub(
                         r'(import\s+\{)(.*)(\}\s+from\s+[\'"].*dialog[\'"])',
                         r'\1\2, DialogTitle\3',
                         content
                     )
                content = new_content

            # Step 2: Inject <DialogTitle className="sr-only">Dialog</DialogTitle> 
            # Add it to any <DialogContent> that lack <DialogTitle immediately after.
            # Since some files might have <DialogTitle> in some dialogs and not others,
            # we will just add it if `<DialogTitle className="sr-only"` is not present
            # AND the file originally didn't have DialogTitle.
            
            # Simple approach: If original file didn't use DialogTitle, inject after every DialogContent
            if '<DialogTitle' not in original_content:
                # Regex to match <DialogContent (attributes)> but not </DialogContent>
                content = re.sub(r'(?<!/)(<DialogContent[^>]*>)', r'\1\n        <DialogTitle className="sr-only">Dialog</DialogTitle>', content)
            else:
                # Some files have <DialogTitle>, maybe they use it for one dialog and not another.
                # For safety, let's just let those be, or manually check them.
                pass
                
            if content != original_content:
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(content)
                count += 1
                print(f"Patched: {filepath}")

    return count

if __name__ == "__main__":
    src_dir = os.path.join(os.path.dirname(__file__), 'src/components')
    modified_files = fix_dialog_titles(src_dir)
    print(f"Total files modified: {modified_files}")
