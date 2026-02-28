# Migration Guide

## From Raw IndexedDB

### Opening a database

**Before (IndexedDB):**
```javascript
const request = indexedDB.open('myApp', 1);
request.onupgradeneeded = (event) => {
  const db = event.target.result;
  const store = db.createObjectStore('users', { keyPath: 'id' });
  store.createIndex('role', 'role', { unique: false });
  store.createIndex('email', 'email', { unique: true });
};
request.onsuccess = (event) => {
  const db = event.target.result;
  // use db...
};
request.onerror = (event) => {
  console.error('Failed to open', event.target.error);
};
```

**After (EasyDB):**
```javascript
import { EasyDB } from '@rckflr/easydb';

const db = await EasyDB.open('myApp', {
  schema(s) {
    s.createStore('users', {
      key: 'id',
      indexes: ['role', { name: 'email', unique: true }]
    });
  }
});
```

### Reading a record

**Before:**
```javascript
const tx = db.transaction('users', 'readonly');
const store = tx.objectStore('users');
const request = store.get(42);
request.onsuccess = () => {
  const user = request.result;
  console.log(user);
};
request.onerror = () => {
  console.error(request.error);
};
```

**After:**
```javascript
const user = await db.users.get(42);
```

### Writing a record

**Before:**
```javascript
const tx = db.transaction('users', 'readwrite');
const store = tx.objectStore('users');
const request = store.put({ id: 1, name: 'Alice', role: 'admin' });
request.onsuccess = () => console.log('saved');
request.onerror = () => console.error(request.error);
```

**After:**
```javascript
await db.users.put({ id: 1, name: 'Alice', role: 'admin' });
```

### Querying with an index

**Before:**
```javascript
const tx = db.transaction('users', 'readonly');
const store = tx.objectStore('users');
const index = store.index('role');
const request = index.openCursor(IDBKeyRange.only('admin'));
const results = [];
request.onsuccess = (event) => {
  const cursor = event.target.result;
  if (cursor) {
    results.push(cursor.value);
    cursor.continue();
  } else {
    console.log('admins:', results);
  }
};
```

**After:**
```javascript
const admins = await db.users.where('role', 'admin').toArray();
```

### Range queries

**Before:**
```javascript
const range = IDBKeyRange.bound(18, 65);
const tx = db.transaction('users', 'readonly');
const index = tx.objectStore('users').index('age');
const request = index.openCursor(range);
const results = [];
request.onsuccess = (event) => {
  const cursor = event.target.result;
  if (cursor) {
    results.push(cursor.value);
    cursor.continue();
  }
};
```

**After:**
```javascript
const adults = await db.users.where('age').between(18, 65).toArray();
```

### Transactions

**Before:**
```javascript
const tx = db.transaction(['users', 'orders'], 'readwrite');
const users = tx.objectStore('users');
const orders = tx.objectStore('orders');
users.put({ id: 1, name: 'Alice', orderCount: 1 });
orders.put({ orderId: 'abc', userId: 1 });
tx.oncomplete = () => console.log('done');
tx.onerror = () => console.error(tx.error);
tx.onabort = () => console.log('rolled back');
```

**After:**
```javascript
await db.transaction(['users', 'orders'], async (tx) => {
  await tx.users.put({ id: 1, name: 'Alice', orderCount: 1 });
  await tx.orders.put({ orderId: 'abc', userId: 1 });
  // throw → auto rollback
});
```

---

## From Dexie.js

### Opening a database

**Dexie.js:**
```javascript
import Dexie from 'dexie';

const db = new Dexie('myApp');
db.version(1).stores({
  users: 'id, role, &email',
  orders: 'orderId, userId'
});
await db.open();
```

**EasyDB:**
```javascript
import { EasyDB } from '@rckflr/easydb';

const db = await EasyDB.open('myApp', {
  schema(s) {
    s.createStore('users', {
      key: 'id',
      indexes: ['role', { name: 'email', unique: true }]
    });
    s.createStore('orders', { key: 'orderId', indexes: ['userId'] });
  }
});
```

### CRUD operations

**Dexie.js:**
```javascript
await db.users.add({ id: 1, name: 'Alice' });
await db.users.put({ id: 1, name: 'Alice Updated' });
const user = await db.users.get(1);
await db.users.delete(1);
```

**EasyDB:**
```javascript
await db.users.put({ id: 1, name: 'Alice' });         // add or update
await db.users.put({ id: 1, name: 'Alice Updated' });  // same method
const user = await db.users.get(1);
await db.users.delete(1);
```

> EasyDB uses `put()` for both insert and update (upsert semantics).

### Querying

**Dexie.js:**
```javascript
const admins = await db.users
  .where('role').equals('admin')
  .filter(u => u.age > 30)
  .limit(5)
  .toArray();
```

**EasyDB:**
```javascript
const admins = await db.users
  .where('role', 'admin')
  .filter(u => u.age > 30)
  .limit(5)
  .toArray();
```

### Iteration

**Dexie.js:**
```javascript
await db.users.each(user => {
  console.log(user.name);
});
```

**EasyDB:**
```javascript
for await (const user of db.users.all()) {
  console.log(user.name);
  if (done) break; // cursor closes, no wasted reads
}
```

### Key differences from Dexie.js

| Aspect | Dexie.js | EasyDB |
|--------|----------|--------|
| Schema syntax | String-based (`'id, role, &email'`) | Object-based (`{ key, indexes }`) |
| Insert vs update | Separate `add()` / `put()` | Single `put()` (upsert) |
| Iteration | Callback-based `each()` | Async iterable `for await` |
| Multi-backend | IndexedDB only | IndexedDB, Memory, D1, KV |
| Live queries | `liveQuery()` observable | `watch()` async iterable |
| Bundle size | ~40KB min | ~4.4KB gzip |
| Maturity | 10+ years, production-grade | New, API stabilizing for v1.0 |

### When to stay with Dexie.js

- You rely on Dexie's advanced features: compound indexes, multi-entry indexes, `modify()`, `Collection.or()`, observable queries
- You need battle-tested production stability with years of edge case handling
- Your app is IndexedDB-only and doesn't need multi-backend portability
