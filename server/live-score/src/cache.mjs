import fs from 'node:fs/promises';
import path from 'node:path';

export class JsonCache {
  constructor(file) {
    this.file = file;
    this.data = {
      fixtures: null,
      live: [],
      terminalMatches: null,
      terminalMatchesByDate: {},
      details: {},
      budget: {},
      pipelineVersion: 0,
      activeScheduleDate: '',
      scheduleHistory: {},
      scheduleArchive: {},
      scheduleBases: {},
      scheduleFixtures: {},
      officialReferences: {},
      atpOopSnapshots: {},
      localization: { playerTranslations: {} }
    };
    this.writeTimer = null;
  }

  async load() {
    try {
      this.data = { ...this.data, ...JSON.parse(await fs.readFile(this.file, 'utf8')) };
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('[cache] load failed:', error.message);
    }
    return this.data;
  }

  scheduleWrite() {
    clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => this.flush().catch(error => console.warn('[cache] write failed:', error.message)), 250);
  }

  async flush() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(this.data), { mode: 0o600 });
  }
}
