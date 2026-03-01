/**
 * Real Lit Integration Tests
 *
 * Uses real LitElement subclasses with EasyDBQueryController
 * and EasyDBRecordController, rendered in jsdom.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LitElement, html } from 'lit';
import { EasyDB, MemoryAdapter } from '../../src/easydb.js';
import { EasyDBQueryController, EasyDBRecordController } from '../../src/lit.js';

// Utility to wait for a Lit element to finish updating
async function waitForUpdate(el, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await el.updateComplete;
    await new Promise(r => setTimeout(r, 50));
    if (!el._queryCtrl?.loading && !el._recordCtrl?.loading) return;
  }
}

let tagCounter = 0;

describe('Lit: Real Integration', () => {
  let db;

  beforeEach(async () => {
    db = await EasyDB.open(`lit-test-${Date.now()}`, {
      adapter: new MemoryAdapter(),
      schema(b) {
        b.createStore('users', { key: 'id', indexes: ['role'] });
      },
    });
  });

  afterEach(() => {
    if (db) db.close();
  });

  describe('EasyDBQueryController', () => {
    it('loads data into a LitElement', async () => {
      await db.users.putMany([
        { id: 1, name: 'Alice', role: 'admin' },
        { id: 2, name: 'Bob', role: 'member' },
      ]);

      const tagName = `test-query-list-${tagCounter++}`;

      class TestQueryList extends LitElement {
        constructor() {
          super();
          this._queryCtrl = new EasyDBQueryController(this, db.users, { watch: false });
        }

        render() {
          const { data, loading } = this._queryCtrl;
          if (loading) return html`<div>Loading...</div>`;
          return html`<div id="count">Count: ${data.length}</div>`;
        }
      }

      customElements.define(tagName, TestQueryList);

      const el = document.createElement(tagName);
      document.body.appendChild(el);

      await waitForUpdate(el);

      const shadow = el.shadowRoot;
      const countEl = shadow.querySelector('#count');
      expect(countEl?.textContent).toBe('Count: 2');

      document.body.removeChild(el);
    });

    it('loads filtered data via QueryBuilder', async () => {
      await db.users.putMany([
        { id: 1, name: 'Alice', role: 'admin' },
        { id: 2, name: 'Bob', role: 'member' },
        { id: 3, name: 'Charlie', role: 'admin' },
      ]);

      const tagName = `test-query-filtered-${tagCounter++}`;

      class TestQueryFiltered extends LitElement {
        constructor() {
          super();
          this._queryCtrl = new EasyDBQueryController(
            this,
            db.users.where('role', 'admin'),
            { watch: false }
          );
        }

        render() {
          const { data, loading } = this._queryCtrl;
          if (loading) return html`<div>Loading...</div>`;
          return html`<div id="names">${data.map(u => u.name).join(', ')}</div>`;
        }
      }

      customElements.define(tagName, TestQueryFiltered);

      const el = document.createElement(tagName);
      document.body.appendChild(el);

      await waitForUpdate(el);

      const text = el.shadowRoot.querySelector('#names')?.textContent;
      expect(text).toContain('Alice');
      expect(text).toContain('Charlie');
      expect(text).not.toContain('Bob');

      document.body.removeChild(el);
    });

    it('starts with loading=true', async () => {
      const tagName = `test-query-loading-${tagCounter++}`;

      let initialLoading;

      class TestQueryLoading extends LitElement {
        constructor() {
          super();
          this._queryCtrl = new EasyDBQueryController(this, db.users, { watch: false });
          initialLoading = this._queryCtrl.loading;
        }

        render() {
          return html`<div>${this._queryCtrl.loading ? 'Loading' : 'Done'}</div>`;
        }
      }

      customElements.define(tagName, TestQueryLoading);

      const el = document.createElement(tagName);
      document.body.appendChild(el);

      expect(initialLoading).toBe(true);

      await waitForUpdate(el);

      document.body.removeChild(el);
    });
  });

  describe('EasyDBRecordController', () => {
    it('loads a single record by key', async () => {
      await db.users.put({ id: 1, name: 'Alice', role: 'admin' });

      const tagName = `test-record-single-${tagCounter++}`;

      class TestRecordSingle extends LitElement {
        constructor() {
          super();
          this._recordCtrl = new EasyDBRecordController(this, db.users, 1, { watch: false });
        }

        render() {
          const { data, loading } = this._recordCtrl;
          if (loading) return html`<div>Loading...</div>`;
          return html`<div id="name">${data?.name || 'none'}</div>`;
        }
      }

      customElements.define(tagName, TestRecordSingle);

      const el = document.createElement(tagName);
      document.body.appendChild(el);

      await waitForUpdate(el);

      expect(el.shadowRoot.querySelector('#name')?.textContent).toBe('Alice');

      document.body.removeChild(el);
    });

    it('returns undefined for missing keys', async () => {
      const tagName = `test-record-missing-${tagCounter++}`;

      class TestRecordMissing extends LitElement {
        constructor() {
          super();
          this._recordCtrl = new EasyDBRecordController(this, db.users, 999, { watch: false });
        }

        render() {
          const { data, loading } = this._recordCtrl;
          if (loading) return html`<div>Loading...</div>`;
          return html`<div id="result">${data === undefined ? 'not found' : 'found'}</div>`;
        }
      }

      customElements.define(tagName, TestRecordMissing);

      const el = document.createElement(tagName);
      document.body.appendChild(el);

      await waitForUpdate(el);

      expect(el.shadowRoot.querySelector('#result')?.textContent).toBe('not found');

      document.body.removeChild(el);
    });
  });
});
