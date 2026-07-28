path = "config.toml"
with open(path, "r") as f:
    content = f.read()

# Replace the bad block with the correct single line
old = """# Directory containing ordered .sql migration files (relative to regulatory module root).
migrations-dir = "db/migrations"
migrations-dir = "db/migrations"
migrations-dir = "src/regulatory/db/migrations""""

new = """# Directory containing ordered .sql migration files (relative to regulatory module root).
migrations-dir = "db/migrations""""

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("fixed")
