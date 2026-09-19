import { describe, it, expect } from 'vitest';
import { patients, visits, inventory, prescriptions, auth } from './adapters';

describe('mock adapters', () => {
  it('login validates credentials', async () => {
    const r = await auth.login({ username: 'admin', password: 'admin' });
    expect(r.user.role).toBe('admin');
    await expect(auth.login({ username: 'admin', password: 'nope' })).rejects.toMatchObject({
      response: { status: 401 },
    });
  });

  it('creates a patient with the next token and moves it through stages', async () => {
    const p = await patients.create({ name: 'Test Person', phone: '90000 00000' });
    expect(p.token).toBe('#016');
    expect(p.stage).toBe('reg');
    const moved = await visits.move(p.id, 'pretest');
    expect(moved.stage).toBe('pretest');
    const counts = await visits.counts();
    expect(counts.pretest).toBe(3);
  });

  it('search matches by name and phone', async () => {
    expect((await patients.list({ q: 'oza' }))[0].name).toBe('Bharat Oza');
    expect((await patients.list({ q: '98240' }))[0].name).toBe('Pooja Trivedi');
  });

  it('saving a prescription decrements stock by qtyGiven only and flags low stock', async () => {
    const name = 'Latanoprost 0.005% eye drops';
    const before = (await inventory.list()).find((i) => i.name === name).stock;
    const r = await prescriptions.save(5, [{ name, dosage: '1 drop', qtyGiven: 1 }]);
    const after = (await inventory.list()).find((i) => i.name === name).stock;
    expect(after).toBe(before - 1);
    expect(r.lowStock.map((i) => i.name)).toContain(name);
  });
});
