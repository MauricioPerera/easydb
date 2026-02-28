---
name: Bug Report
about: Report a bug in EasyDB
title: "[Bug] "
labels: bug
---

**Adapter:** (IDB / Memory / D1)

**Environment:**
- Runtime: (Browser / Node / Cloudflare Workers)
- Version: (e.g., 0.5.0)
- OS/Browser: (e.g., Chrome 120, Node 22)

**Describe the bug**
A clear description of what went wrong.

**Code to reproduce**
```javascript
const db = await EasyDB.open('test', {
  schema(db) { db.createStore('items', { key: 'id' }); }
});
// ... minimal reproduction
```

**Expected behavior**
What you expected to happen.

**Actual behavior**
What actually happened (include error messages if any).
