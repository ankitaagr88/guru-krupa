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

  it('saving a prescription leaves stock alone; dispensing a line deducts and flags low stock', async () => {
    const name = 'Latanoprost 0.005% eye drops';
    const before = (await inventory.list()).find((i) => i.name === name).stock;
    const r = await prescriptions.save(5, [{ name, dosage: '1 drop', qtyGiven: 1 }]);
    expect((await inventory.list()).find((i) => i.name === name).stock).toBe(before);
    expect(r.lowStock).toEqual([]);
    const d = await prescriptions.dispense(5, r.lines[0].id, 1);
    expect((await inventory.list()).find((i) => i.name === name).stock).toBe(before - 1);
    expect(d.lowStock.map((i) => i.name)).toContain(name);
    // re-saving keeps the confirmation; dropping the line gives the stock back
    const again = await prescriptions.save(5, [{ name, dosage: '2 drops', qtyGiven: 1 }]);
    expect(again.lines[0].dispensedQty).toBe(1);
    await prescriptions.save(5, []);
    expect((await inventory.list()).find((i) => i.name === name).stock).toBe(before);
  });
});
