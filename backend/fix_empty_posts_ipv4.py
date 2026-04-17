import os
import sys
from sqlalchemy import create_engine, text

# Hardcode the IPv4 address to avoid Windows DNS/IPv6 issues
database_url = "postgresql://postgres.jnfbxcvcbtndtsvscppt:Labocana%23123@3.139.14.59:6543/postgres?sslmode=require"

try:
    engine = create_engine(database_url)
    with engine.connect() as conn:
        # Check empty posts
        query = text("""
            SELECT id, media_type, content_type FROM posts 
            WHERE (media_url IS NULL OR media_url = '') 
            AND (caption IS NULL OR caption = '')
            AND (location IS NULL OR location = '')
        """)
        
        result = conn.execute(query).fetchall()
        print(f"Found {len(result)} total empty posts (no media, no caption, no location).")
        
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
except Exception as e:
    print(f"Error: {e}")
