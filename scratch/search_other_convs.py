import re

file_path = r"C:\Users\dprit\.gemini\antigravity\brain\b97d8ab7-4ee5-420f-b778-b93f174dae99\scratch\stair_conversations_all.txt"
with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
    raw_content = f.read()

# Clean up space-separated characters
cleaned_content = raw_content.replace(" \x00", "").replace("\x00", "")
if len(cleaned_content) == len(raw_content):
    if raw_content[1] == ' ' and raw_content[3] == ' ':
        cleaned_content = "".join([raw_content[i] for i in range(0, len(raw_content), 2)])

# Find all lines matching ===Conv...
conv_headers = re.findall(r"===Conv[a-zA-Z0-9\-]+Step\d+===", cleaned_content)
print(f"Total conversation headers: {len(conv_headers)}")
unique_convs = set(re.findall(r"===Conv([a-zA-Z0-9\-]+)Step", cleaned_content))
print(f"Unique conversation IDs in file: {unique_convs}")

# Let's search other conversations for the word "stair" or "GPS" or "GSHHS" or "GSHHG"
for conv in unique_convs:
    if conv == "b97d8ab7-4ee5-420f-b778-b93f174dae99":
        continue
    print(f"\n==================================================")
    print(f"Searching in Conversation: {conv}")
    # Extract sections of this conversation
    # We can split the cleaned_content by conversation headers
    pattern = f"===Conv{conv}Step\d+==="
    segments = re.split(pattern, cleaned_content)
    print(f"Found {len(segments)} segments for {conv}")
    for idx, seg in enumerate(segments):
        if re.search(r"(stair|GPS|GSHH|coast)", seg, re.IGNORECASE):
            # find paragraphs
            paragraphs = seg.split("\n\n")
            for p in paragraphs:
                if re.search(r"(stair|GPS|GSHH|coast)", p, re.IGNORECASE) and len(p.strip()) > 50:
                    print(f"--- Segment {idx} ---")
                    print(p[:2000].strip())
                    print("-" * 40)
