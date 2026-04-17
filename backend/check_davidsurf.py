import os
import sys
from sqlalchemy import create_engine
from sqlalchemy.sql import text
from dotenv import load_dotenv

load_dotenv('.env')
db_url = os.getenv('DATABASE_URL')
engine = create_engine(db_url)

with engine.connect() as conn:
    result = conn.execute(text("SELECT id, user_name, avatar_url FROM users WHERE user_name='davidsurf' OR user_name='@davidsurf'"))
    for row in result:
        print(f"ID: {row[0]}, User: {row[1]}, Avatar: {row[2]}")
