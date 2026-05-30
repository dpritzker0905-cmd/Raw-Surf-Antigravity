import os
from sqlalchemy import create_engine, text

# Set environment PGHOSTADDR to empty to avoid Loopback 0.0.0.0 issue on Windows
os.environ["PGHOSTADDR"] = ""

users = ["postgres", "test", "rawsurf"]
passwords = ["rawsurf", "postgres", "password", "test", "gettingbarreled"]
databases = ["rawsurf", "postgres", "rawsurf_test"]

def test_connections():
    print("Testing connections:")
    for user in users:
        for pw in passwords:
            for db in databases:
                url = f"postgresql://{user}:{pw}@localhost:5432/{db}"
                try:
                    engine = create_engine(url)
                    with engine.connect() as conn:
                        result = conn.execute(text("SELECT 1"))
                        val = result.scalar()
                        print(f"SUCCESS: {url} -> {val}")
                        return
                except Exception as e:
                    pass
    print("No connections worked.")

if __name__ == "__main__":
    test_connections()
