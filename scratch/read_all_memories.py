import subprocess
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

MEMORIES = [
    "research/codebase-memory",
    "tools/docker-mcp-gateway",
    "tools/duckdb",
    "tools/langsmith-tracing",
    "tools/memgraph-platform",
    "tools/pyarrow",
    "tools/qdrant-vector-db",
    "tools/react-scan",
    "tools/spectorjs",
    "tools/treesitter-mcp"
]

def read_all():
    print("Reading all memories fromprojects/raw-surf...")
    for mem in MEMORIES:
        cmd = [
            r"C:\Users\dprit\.bun\bin\bun.exe",
            "run",
            r"C:\Users\dprit\mind\src\mind.ts",
            "read",
            "projects/raw-surf",
            mem
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
        print(f"\n==================================================")
        print(f"Memory: {mem}")
        print(f"==================================================")
        print(result.stdout)
        if result.stderr:
            print("Error:", result.stderr)

if __name__ == "__main__":
    read_all()
