import os
import re

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

mcp_servers = [
    "airtable_mcp_server.py",
    "debug_consciousness_mcp_server.py",
    "event_bus_mcp_server.py",
    "feedback_loop_mcp_server.py",
    "google_calendar_mcp_server.py",
    "google_maps_mcp_server.py",
    "n8n_mcp_server.py",
    "operator_mcp_server.py",
    "pricing_mcp_server.py",
    "qa_agent_mcp_server.py",
    "recommendation_mcp_server.py",
    "reputation_mcp_server.py",
    "semantic_memory_mcp_server.py",
    "simulation_mcp_server.py",
    "stripe_mcp_server.py",
    "woocommerce_mcp_server.py",
    "world_model_mcp_server.py",
    "vector_mcp_server.py"
]

def migrate_server_file(filename):
    file_path = os.path.join(BACKEND_DIR, filename)
    if not os.path.exists(file_path):
        print(f"Skipping {filename}: not found.")
        return False
        
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
        
    original = content
    
    # 1. Inject import helper statement
    import_stmt = "from utils.sqlite_helpers import get_sqlite_connection, get_db_path"
    if import_stmt not in content:
        # Inject right after "import sqlite3" or standard imports
        if "import sqlite3" in content:
            content = content.replace("import sqlite3", f"import sqlite3\n{import_stmt}")
        else:
            content = "import os\n" + import_stmt + "\n" + content
            
    # 2. Decouple absolute path DB_PATH definitions
    # Matches DB_PATH = "C:\\Users\\dprit\\Raw-Surf\\backend\\something.db"
    # or op_db_path = "C:\\Users\\dprit\\Raw-Surf\\backend\\something.db"
    db_path_regex = r'(DB_PATH|op_db_path)\s*=\s*["\']C:\\\\Users\\\\dprit\\\\Raw-Surf\\\\backend\\\\([\w_\.]+db)["\']'
    content = re.sub(db_path_regex, r'\1 = get_db_path("\2")', content)
    
    # 3. Replace sqlite3.connect calls
    # sqlite3.connect(DB_PATH, timeout=10.0) -> get_sqlite_connection(DB_PATH)
    # sqlite3.connect(DB_PATH) -> get_sqlite_connection(DB_PATH)
    # sqlite3.connect(op_db_path, timeout=10.0) -> get_sqlite_connection(op_db_path)
    content = re.sub(r'sqlite3\.connect\((DB_PATH|op_db_path)(?:,\s*timeout=[\d\.]+)?\)', r'get_sqlite_connection(\1)', content)
    
    if content != original:
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"[OK] Successfully migrated {filename}")
        return True
    else:
        print(f"No changes needed for {filename}")
        return False

def main():
    print("Starting SQLite WAL and Portability Migration...")
    migrated_count = 0
    for server in mcp_servers:
        if migrate_server_file(server):
            migrated_count += 1
    print(f"Completed! Migrated {migrated_count}/{len(mcp_servers)} server files.")

if __name__ == "__main__":
    main()
