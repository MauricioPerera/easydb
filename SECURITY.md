# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in EasyDB, please report it responsibly:

1. **Do not** open a public issue
2. Email **mauricio@automators.work** with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

I'll acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

## Scope

EasyDB is a client-side/edge storage wrapper. Security considerations include:

- **SQL injection** in the D1 adapter (identifier escaping, parameterized queries)
- **Prototype pollution** through stored objects
- **Cross-tab data leakage** through BroadcastChannel watch
- **DoS** via watcher accumulation or unbounded queries

## Known Considerations

- EasyDB stores data in IndexedDB/D1/Memory — it does **not** provide encryption at rest. If you need encrypted storage, encrypt values before passing them to EasyDB.
- The D1 adapter uses parameterized queries for values and escapes identifiers. If you find a bypass, please report it.
- BroadcastChannel watch is same-origin only (browser security model).
