import sqlite3

conn = sqlite3.connect("users.db")
c = conn.cursor()

c.execute(
    """
CREATE TABLE users (
    username TEXT PRIMARY KEY,
    password TEXT NOT NULL
)
"""
)

c.execute(
    "INSERT OR IGNORE INTO users (username, password) VALUES (?, ?)",
    ("Eden", "Hedgehog778899"),
)

c.execute(
    "INSERT OR IGNORE INTO users (username, password) VALUES (?, ?)",
    ("Tessa", "Hedgehog0720"),
)

conn.commit()
conn.close()
