import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDB, destroyTestDB, seedUsers, collect } from './helpers.js';

describe('QueryBuilder — all() basic iteration', () => {
  let db, name, users;

  beforeEach(async () => {
    ({ db, name } = await createTestDB());
    users = await seedUsers(db, 10);
  });

  afterEach(async () => {
    await destroyTestDB(db, name);
  });

  it('should iterate all records with for-await', async () => {
    const results = await collect(db.users.all());
    expect(results).toHaveLength(10);
    expect(results[0].id).toBe(1);
    expect(results[9].id).toBe(10);
  });

  it('should return empty for empty store', async () => {
    await db.users.clear();
    const results = await collect(db.users.all());
    expect(results).toHaveLength(0);
  });

  it('should support break (early termination)', async () => {
    const results = [];
    for await (const user of db.users.all()) {
      results.push(user);
      if (results.length >= 3) break;
    }
    expect(results).toHaveLength(3);
  });

  it('should yield records in key order (asc by default)', async () => {
    const results = await collect(db.users.all());
    const ids = results.map(r => r.id);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('should yield records in reverse key order with desc()', async () => {
    const results = await collect(db.users.all().desc());
    expect(results[0].id).toBe(10);
    expect(results[9].id).toBe(1);
  });
});

describe('QueryBuilder — toArray() fast path', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createTestDB());
    await seedUsers(db, 10);
  });

  afterEach(async () => {
    await destroyTestDB(db, name);
  });

  it('should return all records via fast path (no filter, no limit)', async () => {
    const results = await db.users.all().toArray();
    expect(results).toHaveLength(10);
  });

  it('should return filtered results via cursor path (with filter)', async () => {
    const results = await db.users.all().filter(u => u.age > 40).toArray();
    // ages are 20, 23, 26, 29, 32, 35, 38, 41, 44, 47
    expect(results.every(u => u.age > 40)).toBe(true);
    expect(results).toHaveLength(3); // 41, 44, 47
  });

  it('should return limited results via cursor path (with limit)', async () => {
    const results = await db.users.all().limit(3).toArray();
    expect(results).toHaveLength(3);
    expect(results[0].id).toBe(1);
  });

  it('should respect desc with fast path', async () => {
    const results = await db.users.all().desc().toArray();
    expect(results[0].id).toBe(10);
    expect(results[9].id).toBe(1);
  });

  it('should return empty array for empty store', async () => {
    await db.users.clear();
    expect(await db.users.all().toArray()).toEqual([]);
  });
});

describe('QueryBuilder — where() with exact value', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createTestDB());
    await seedUsers(db, 10);
    // roles: admin(1,4,7,10), editor(2,5,8), viewer(3,6,9)
    // countries: UY(1,6), MX(2,7), AR(3,8), CO(4,9), CL(5,10)
  });

  afterEach(async () => {
    await destroyTestDB(db, name);
  });

  it('should filter by exact index value', async () => {
    const admins = await db.users.where('role', 'admin').toArray();
    expect(admins).toHaveLength(4);
    expect(admins.every(u => u.role === 'admin')).toBe(true);
  });

  it('should return empty for non-matching value', async () => {
    const results = await db.users.where('role', 'superadmin').toArray();
    expect(results).toHaveLength(0);
  });

  it('should count with where (native fast path)', async () => {
    const count = await db.users.where('role', 'editor').count();
    expect(count).toBe(3);
  });

  it('should get first match', async () => {
    const first = await db.users.where('role', 'admin').first();
    expect(first).toBeDefined();
    expect(first.role).toBe('admin');
  });

  it('should iterate where results with for-await', async () => {
    const results = await collect(db.users.where('country', 'MX'));
    expect(results.every(u => u.country === 'MX')).toBe(true);
  });
});

describe('QueryBuilder — range queries', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createTestDB());
    await seedUsers(db, 10);
    // ages: 20, 23, 26, 29, 32, 35, 38, 41, 44, 47
  });

  afterEach(async () => {
    await destroyTestDB(db, name);
  });

  it('gt() — greater than', async () => {
    const results = await db.users.where('age').gt(40).toArray();
    expect(results.every(u => u.age > 40)).toBe(true);
    expect(results).toHaveLength(3); // 41, 44, 47
  });

  it('gte() — greater than or equal', async () => {
    const results = await db.users.where('age').gte(41).toArray();
    expect(results.every(u => u.age >= 41)).toBe(true);
    expect(results).toHaveLength(3); // 41, 44, 47
  });

  it('lt() — less than', async () => {
    const results = await db.users.where('age').lt(25).toArray();
    expect(results.every(u => u.age < 25)).toBe(true);
    expect(results).toHaveLength(2); // 20, 23
  });

  it('lte() — less than or equal', async () => {
    const results = await db.users.where('age').lte(23).toArray();
    expect(results.every(u => u.age <= 23)).toBe(true);
    expect(results).toHaveLength(2); // 20, 23
  });

  it('between() — inclusive range', async () => {
    const results = await db.users.where('age').between(26, 38).toArray();
    expect(results.every(u => u.age >= 26 && u.age <= 38)).toBe(true);
    expect(results).toHaveLength(5); // 26, 29, 32, 35, 38
  });

  it('between() — exclusive bounds', async () => {
    const results = await db.users.where('age').between(26, 38, true, true).toArray();
    expect(results.every(u => u.age > 26 && u.age < 38)).toBe(true);
    expect(results).toHaveLength(3); // 29, 32, 35
  });

  it('range + count (native fast path)', async () => {
    const count = await db.users.where('age').gt(40).count();
    expect(count).toBe(3);
  });

  it('range + first', async () => {
    const oldest = await db.users.where('age').gt(40).first();
    expect(oldest.age).toBe(41);
  });

  it('range + desc', async () => {
    const results = await db.users.where('age').gt(40).desc().toArray();
    expect(results[0].age).toBe(47);
    expect(results[2].age).toBe(41);
  });

  it('should return empty for out-of-range', async () => {
    const results = await db.users.where('age').gt(100).toArray();
    expect(results).toHaveLength(0);
  });
});

describe('QueryBuilder — compound filter', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createTestDB());
    await seedUsers(db, 10);
  });

  afterEach(async () => {
    await destroyTestDB(db, name);
  });

  it('should apply JS filter over index results', async () => {
    // admins from MX: admin ids are 1,4,7,10; MX ids are 2,7
    // intersection: id 7
    const results = await db.users
      .where('role', 'admin')
      .filter(u => u.country === 'MX')
      .toArray();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(7);
  });

  it('should apply JS filter over range results', async () => {
    const results = await db.users
      .where('age').gt(30)
      .filter(u => u.role === 'admin')
      .toArray();
    // age > 30: ids 5,6,7,8,9,10 (ages 32,35,38,41,44,47)
    // admins among those: 7, 10
    expect(results.every(u => u.age > 30 && u.role === 'admin')).toBe(true);
  });

  it('should count with JS filter (cursor path)', async () => {
    const count = await db.users
      .where('role', 'admin')
      .filter(u => u.age > 30)
      .count();
    // admin ids: 1(age20), 4(age29), 7(age38), 10(age47)
    // age > 30: 7, 10
    expect(count).toBe(2);
  });

  it('filter + limit', async () => {
    const results = await db.users
      .all()
      .filter(u => u.role === 'admin')
      .limit(2)
      .toArray();
    expect(results).toHaveLength(2);
    expect(results.every(u => u.role === 'admin')).toBe(true);
  });

  it('filter that matches nothing', async () => {
    const results = await db.users
      .all()
      .filter(u => u.name === 'NONEXISTENT')
      .toArray();
    expect(results).toHaveLength(0);
  });
});

describe('QueryBuilder — limit()', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createTestDB());
    await seedUsers(db, 10);
  });

  afterEach(async () => {
    await destroyTestDB(db, name);
  });

  it('should limit results', async () => {
    const results = await db.users.all().limit(3).toArray();
    expect(results).toHaveLength(3);
  });

  it('should handle limit larger than dataset', async () => {
    const results = await db.users.all().limit(100).toArray();
    expect(results).toHaveLength(10);
  });

  it('should handle limit(1)', async () => {
    const results = await db.users.all().limit(1).toArray();
    expect(results).toHaveLength(1);
  });

  it('limit + desc', async () => {
    const results = await db.users.all().desc().limit(2).toArray();
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe(10);
    expect(results[1].id).toBe(9);
  });
});

describe('QueryBuilder — first()', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createTestDB());
    await seedUsers(db, 5);
  });

  afterEach(async () => {
    await destroyTestDB(db, name);
  });

  it('should return first record', async () => {
    const first = await db.users.all().first();
    expect(first.id).toBe(1);
  });

  it('should return undefined for empty store', async () => {
    await db.users.clear();
    const first = await db.users.all().first();
    expect(first).toBeUndefined();
  });

  it('should return first matching record with where', async () => {
    const first = await db.users.where('role', 'editor').first();
    expect(first.role).toBe('editor');
  });
});

describe('QueryBuilder — skip()', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createTestDB());
    await seedUsers(db, 10);
  });

  afterEach(async () => {
    await destroyTestDB(db, name);
  });

  it('should skip first N results', async () => {
    const results = await db.users.all().skip(3).toArray();
    expect(results).toHaveLength(7);
    expect(results[0].id).toBe(4);
  });

  it('skip + limit', async () => {
    const results = await db.users.all().skip(2).limit(3).toArray();
    expect(results).toHaveLength(3);
    expect(results.map(u => u.id)).toEqual([3, 4, 5]);
  });

  it('skip + desc', async () => {
    const results = await db.users.all().desc().skip(2).toArray();
    expect(results).toHaveLength(8);
    expect(results[0].id).toBe(8);
  });

  it('skip + desc + limit', async () => {
    const results = await db.users.all().desc().skip(2).limit(3).toArray();
    expect(results).toHaveLength(3);
    expect(results.map(u => u.id)).toEqual([8, 7, 6]);
  });

  it('skip beyond dataset returns empty', async () => {
    const results = await db.users.all().skip(100).toArray();
    expect(results).toHaveLength(0);
  });

  it('skip(0) is a no-op', async () => {
    const results = await db.users.all().skip(0).toArray();
    expect(results).toHaveLength(10);
  });

  it('skip + filter', async () => {
    // admins: ids 1, 4, 7, 10
    const results = await db.users.all()
      .filter(u => u.role === 'admin')
      .skip(2)
      .toArray();
    expect(results).toHaveLength(2);
    expect(results.map(u => u.id)).toEqual([7, 10]);
  });

  it('skip + where (index query)', async () => {
    // ages: 20,23,26,29,32,35,38,41,44,47 — gt(30): 32,35,38,41,44,47
    const results = await db.users.where('age').gt(30).skip(2).toArray();
    expect(results).toHaveLength(4);
    expect(results[0].age).toBe(38);
  });

  it('skip via async iterator', async () => {
    const results = await collect(db.users.all().skip(7));
    expect(results).toHaveLength(3);
    expect(results[0].id).toBe(8);
  });
});

describe('QueryBuilder — page()', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createTestDB());
    await seedUsers(db, 10);
  });

  afterEach(async () => {
    await destroyTestDB(db, name);
  });

  it('page 1', async () => {
    const results = await db.users.all().page(1, 3).toArray();
    expect(results.map(u => u.id)).toEqual([1, 2, 3]);
  });

  it('page 2', async () => {
    const results = await db.users.all().page(2, 3).toArray();
    expect(results.map(u => u.id)).toEqual([4, 5, 6]);
  });

  it('page 3', async () => {
    const results = await db.users.all().page(3, 3).toArray();
    expect(results.map(u => u.id)).toEqual([7, 8, 9]);
  });

  it('last partial page', async () => {
    const results = await db.users.all().page(4, 3).toArray();
    expect(results.map(u => u.id)).toEqual([10]);
  });

  it('page beyond dataset returns empty', async () => {
    const results = await db.users.all().page(5, 3).toArray();
    expect(results).toHaveLength(0);
  });

  it('page + desc', async () => {
    const results = await db.users.all().desc().page(1, 3).toArray();
    expect(results.map(u => u.id)).toEqual([10, 9, 8]);
  });

  it('page + where', async () => {
    // admins: ids 1, 4, 7, 10
    const results = await db.users.where('role', 'admin').page(2, 2).toArray();
    expect(results.map(u => u.id)).toEqual([7, 10]);
  });

  it('page + filter', async () => {
    // viewers: ids 3, 6, 9
    const p1 = await db.users.all().filter(u => u.role === 'viewer').page(1, 2).toArray();
    const p2 = await db.users.all().filter(u => u.role === 'viewer').page(2, 2).toArray();
    expect(p1.map(u => u.id)).toEqual([3, 6]);
    expect(p2.map(u => u.id)).toEqual([9]);
  });
});

describe('QueryBuilder — immutability', () => {
  let db, name;

  beforeEach(async () => {
    ({ db, name } = await createTestDB());
    await seedUsers(db, 10);
  });

  afterEach(async () => {
    await destroyTestDB(db, name);
  });

  it('limit() should not mutate original query', async () => {
    const base = db.users.all();
    const limited = base.limit(3);

    const allResults = await base.toArray();
    const limitedResults = await limited.toArray();

    expect(allResults).toHaveLength(10);
    expect(limitedResults).toHaveLength(3);
  });

  it('filter() should not mutate original query', async () => {
    const base = db.users.where('role', 'admin');
    const filtered = base.filter(u => u.age > 30);

    const allAdmins = await base.toArray();
    const filteredAdmins = await filtered.toArray();

    expect(allAdmins.length).toBeGreaterThan(filteredAdmins.length);
  });

  it('skip() should not mutate original query', async () => {
    const base = db.users.all();
    const skipped = base.skip(5);

    const allResults = await base.toArray();
    const skippedResults = await skipped.toArray();

    expect(allResults).toHaveLength(10);
    expect(skippedResults).toHaveLength(5);
  });

  it('desc() should not mutate original query', async () => {
    const base = db.users.all();
    const reversed = base.desc();

    const asc = await base.toArray();
    const desc = await reversed.toArray();

    expect(asc[0].id).toBe(1);
    expect(desc[0].id).toBe(10);
  });
});
