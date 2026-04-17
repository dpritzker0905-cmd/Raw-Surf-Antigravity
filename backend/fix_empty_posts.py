import os
import sys
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()
database_url = os.environ.get('DATABASE_URL')

if not database_url:
    print('No DATABASE_URL found')
    sys.exit(1)

engine = create_engine(database_url)

with engine.connect() as conn:
    # Identify empty posts
    query = text("""
        SELECT id, media_type, content_type FROM posts 
        WHERE (media_url IS NULL OR media_url = '') 
        AND (caption IS NULL OR caption = '')
        AND (location IS NULL OR location = '')
    """)
    
    result = conn.execute(query).fetchall()
    print(f"Found {len(result)} total empty posts (no media, no caption, no location).")
    
    # Let's count by type just in case we are deleting things we shouldn't
    types = {}
    ids_to_delete = []
    
    for row in result:
        m_type = row[1]
        c_type = row[2]
        key = f"{m_type}/{c_type}"
        types[key] = types.get(key, 0) + 1
        ids_to_delete.append(row[0])
        
    for k, v in types.items():
        print(f"Type '{k}': {v}")
        
    if ids_to_delete:
        print(f"Deleting {len(ids_to_delete)} posts...")
        delete_query = text("""
            DELETE FROM posts 
            WHERE (media_url IS NULL OR media_url = '') 
            AND (caption IS NULL OR caption = '')
            AND (location IS NULL OR location = '')
        """)
        conn.execute(delete_query)
        conn.commit()
        print("Done.")
    else:
        print("Nothing to delete.")
