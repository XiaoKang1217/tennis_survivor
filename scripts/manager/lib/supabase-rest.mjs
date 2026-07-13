import { DEFAULT_SUPABASE_URL } from './manager-utils.mjs';

export class SupabaseRestClient {
  constructor({
    url = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL,
    serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    dryRun = false
  } = {}) {
    this.url = url.replace(/\/+$/, '');
    this.serviceRoleKey = serviceRoleKey;
    this.dryRun = Boolean(dryRun);
    if (!this.dryRun && !this.serviceRoleKey) {
      throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY. Re-run with --dry-run or provide the key.');
    }
  }

  headers(prefer = 'resolution=merge-duplicates,return=representation') {
    return {
      apikey: this.serviceRoleKey,
      authorization: `Bearer ${this.serviceRoleKey}`,
      'content-type': 'application/json',
      prefer
    };
  }

  endpoint(table, query = {}) {
    const url = new URL(`/rest/v1/${table}`, this.url);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    return url;
  }

  async upsert(table, rows, conflict, { chunkSize = 500, prefer } = {}) {
    if (!rows.length) return [];
    if (this.dryRun) return rows;

    const out = [];
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const res = await fetch(this.endpoint(table, { on_conflict: conflict }), {
        method: 'POST',
        headers: this.headers(prefer),
        body: JSON.stringify(chunk)
      });
      if (!res.ok) {
        throw new Error(`${table} upsert failed: ${res.status} ${await res.text()}`);
      }
      const text = await res.text();
      if (text) out.push(...JSON.parse(text));
    }
    return out;
  }

  async insert(table, rows, { chunkSize = 100, prefer = 'return=representation' } = {}) {
    if (!rows.length) return [];
    if (this.dryRun) return rows;

    const out = [];
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const res = await fetch(this.endpoint(table), {
        method: 'POST',
        headers: this.headers(prefer),
        body: JSON.stringify(chunk)
      });
      if (!res.ok) {
        throw new Error(`${table} insert failed: ${res.status} ${await res.text()}`);
      }
      const text = await res.text();
      if (text) out.push(...JSON.parse(text));
    }
    return out;
  }

  async select(table, query = {}) {
    if (this.dryRun) return [];
    const res = await fetch(this.endpoint(table, query), {
      method: 'GET',
      headers: this.headers('')
    });
    if (!res.ok) {
      throw new Error(`${table} select failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  async update(table, values, query = {}) {
    if (this.dryRun) return [];
    const res = await fetch(this.endpoint(table, query), {
      method: 'PATCH',
      headers: this.headers('return=representation'),
      body: JSON.stringify(values)
    });
    if (!res.ok) {
      throw new Error(`${table} update failed: ${res.status} ${await res.text()}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : [];
  }

  async delete(table, query = {}) {
    if (this.dryRun) return [];
    const res = await fetch(this.endpoint(table, query), {
      method: 'DELETE',
      headers: this.headers('return=minimal')
    });
    if (!res.ok) {
      throw new Error(`${table} delete failed: ${res.status} ${await res.text()}`);
    }
    return [];
  }

  async rpc(name, args = {}) {
    if (this.dryRun) return null;
    const url = new URL(`/rest/v1/rpc/${name}`, this.url);
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers('return=representation'),
      body: JSON.stringify(args || {})
    });
    if (!res.ok) {
      throw new Error(`${name} rpc failed: ${res.status} ${await res.text()}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
}
