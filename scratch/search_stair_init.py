import sys

sys.stdout.reconfigure(encoding='utf-8')

file_path = r"C:\Users\dprit\.gemini\antigravity\brain\b97d8ab7-4ee5-420f-b778-b93f174dae99\scratch\stair_conversations_clean.txt"
with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

paragraphs = content.split("\n\n")
print(f"Total paragraphs: {len(paragraphs)}")

count = 0
for idx, p in enumerate(paragraphs):
    if "initEngine" in p:
        count += 1
        print(f"=== Match {count} (P{idx}) ===")
        print(p[:1500].encode('ascii', errors='replace').decode('ascii'))
        print("="*60)
