import os
from pathlib import Path

replacements = [
    ("https://customer-assets.emergentagent.com/job_raw-surf-os/artifacts/9llcl5mg_Rawig6-500x500.png", "logo.png"),
    ("https://raw-surf-os.preview.emergentagent.com", "https://dev--rawsurf.netlify.app"),
    ("raw-surf-os.preview.emergentagent.com", "dev--rawsurf.netlify.app"),
    ("EMERGENT_LLM_KEY", "OPENAI_API_KEY"),
    ("Emergent LLM Key", "OpenAI API Key"),
    ("emergent-agent-e1", "raw-surf-developer"),
    ("github@emergent.sh", "developer@rawsurf.com")
]

root_dir = Path(r"c:\Users\dprit\Raw-Surf")
exclude_dirs = {".git", "node_modules", "venv", ".emergent", "build", ".system_generated"}

def purge_file(file_path):
    try:
        content = file_path.read_text(encoding="utf-8", errors="ignore")
        original = content
        for target, repl in replacements:
            content = content.replace(target, repl)
        if content != original:
            file_path.write_text(content, encoding="utf-8")
            print(f"Purged: {file_path.relative_to(root_dir)}")
    except Exception as e:
        print(f"Error purging {file_path}: {e}")

def walk_and_purge(directory):
    for path in directory.iterdir():
        if path.is_dir():
            if path.name in exclude_dirs:
                continue
            walk_and_purge(path)
        elif path.is_file():
            if path.suffix in {".py", ".js", ".jsx", ".html", ".json", ".yml", ".toml", ".md", ".txt"}:
                # Avoid purging this script itself
                if path.name == "purge_all_emergent.py":
                    continue
                purge_file(path)

if __name__ == "__main__":
    print("Starting comprehensive emergent purge...")
    walk_and_purge(root_dir)
    print("Purge completed successfully.")
