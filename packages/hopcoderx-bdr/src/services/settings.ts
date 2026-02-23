export async function getSettings(db: any): Promise<Record<string, string>> {
  const { results: rows } = await db.prepare('SELECT * FROM settings').all();
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

export async function setSettings(db: any, updates: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(updates)) {
    await db.prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    ).bind(key, value).run();
  }
}
