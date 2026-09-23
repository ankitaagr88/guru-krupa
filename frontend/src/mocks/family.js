/* Demo-mode families (lane E1 owns this file): owner + members on one mobile number, and the
   admin relations list. Same method names and shapes as `family` in src/api/real.js.
   A member row carries `familyOwnerId` + `relationKey`; the owner carries neither. */
import { store, latency } from './store';
import { ageFromDob, phoneKey } from '../lib/format';

const S = store.state;
const c = store.clone;

// Same starting list as the server seed (backend/app/seed/family.py); Admin edits it afterwards.
const SEED_RELATIONS = [
  ['husband', 'पति (Husband)'],
  ['wife', 'पत्नी (Wife)'],
  ['son', 'बेटा (Son)'],
  ['daughter', 'बेटी (Daughter)'],
  ['father', 'पिता (Father)'],
  ['mother', 'माता (Mother)'],
  ['brother', 'भाई (Brother)'],
  ['sister', 'बहन (Sister)'],
  ['grandson', 'पोता / नाती (Grandson)'],
  ['granddaughter', 'पोती / नातिन (Granddaughter)'],
  ['grandfather', 'दादा / नाना (Grandfather)'],
  ['grandmother', 'दादी / नानी (Grandmother)'],
  ['son_in_law', 'दामाद (Son-in-law)'],
  ['daughter_in_law', 'बहू (Daughter-in-law)'],
  ['other', 'अन्य (Other)'],
];

function relationRows() {
  if (!S.relations) {
    S.relations = SEED_RELATIONS.map(([key, label], i) => ({ id: i + 1, key, label, sortOrder: i, active: true }));
  }
  return S.relations;
}

function httpError(status, message) {
  const err = new Error(message);
  err.response = { status, data: { detail: message } };
  return err;
}

const byId = (id) => S.patients.find((p) => p.id === Number(id));
const labelOf = (key) => (key ? relationRows().find((r) => r.key === key)?.label || key : null);
const membersOf = (ownerId) => S.patients.filter((p) => p.familyOwnerId === ownerId).sort((a, b) => a.id - b.id);
const ownerOf = (p) => (p.familyOwnerId ? byId(p.familyOwnerId) || p : p);

/** The family facts PatientOut carries (added to every demo patient read). */
export function familyBits(p) {
  const ownerId = p.familyOwnerId ?? null;
  const owner = ownerId ? byId(ownerId) : null;
  return {
    familyOwnerId: ownerId,
    relationKey: ownerId ? p.relationKey ?? null : null,
    relationLabel: ownerId ? labelOf(p.relationKey) : null,
    familyOwnerName: owner?.name ?? null,
    familySize: 1 + membersOf(ownerId || p.id).length,
  };
}

function checkRelation(key) {
  if (!key) return null;
  if (!relationRows().some((r) => r.key === key && r.active)) throw httpError(422, `Unknown relation '${key}'`);
  return key;
}

function copyPhone(member, owner) {
  if (!owner.phone || member.phone === owner.phone) return '';
  const old = member.phone;
  member.phone = owner.phone;
  return old && phoneKey(old) !== phoneKey(owner.phone) ? `${member.name}'s phone changed from ${old} to ${owner.phone}.` : '';
}

/** Put `p` in the family of `ownerId` (or of that person's owner). Shared with patients.create. */
export function linkInStore(p, ownerId, relationKey) {
  const found = byId(ownerId);
  if (!found) throw httpError(404, 'That patient was not found');
  const target = ownerOf(found);
  if (target.id === p.id)
    throw httpError(409, `${p.name} is already the owner of this family: use "Make owner of this number" on another member instead`);
  const key = checkRelation(relationKey);
  const notes = [];
  const moved = membersOf(p.id);
  moved.forEach((m) => {
    m.familyOwnerId = target.id;
    m.relationKey = null;
    const n = copyPhone(m, target);
    if (n) notes.push(n);
  });
  if (moved.length) notes.push(`${moved.length} member(s) of ${p.name}'s family moved to ${target.name}'s family; set their relation.`);
  p.familyOwnerId = target.id;
  p.relationKey = key;
  const n = copyPhone(p, target);
  if (n) notes.unshift(n);
  return notes.join(' ');
}

/** After the owner's phone changed: the members take the new number. Returns how many changed. */
export function followOwnerPhone(owner) {
  if (owner.familyOwnerId) return 0;
  let n = 0;
  membersOf(owner.id).forEach((m) => {
    if (m.phone !== owner.phone) {
      m.phone = owner.phone;
      n += 1;
    }
  });
  return n;
}

const lastVisit = (p) => p.lastVisitDate ?? (S.patientHistory[p.phone] || []).slice(-1)[0] ?? null;

function memberOut(p, isOwner) {
  return {
    id: p.id,
    name: p.name,
    age: p.dob ? ageFromDob(p.dob) : p.age ?? null,
    sex: p.sex ?? null,
    phone: p.phone ?? null,
    isOwner,
    relationKey: isOwner ? null : p.relationKey ?? null,
    relationLabel: isOwner ? null : labelOf(p.relationKey),
    lastVisitDate: lastVisit(p),
  };
}

function familyOut(p, message = '') {
  const owner = ownerOf(p);
  const members = membersOf(owner.id);
  const people = members.length ? [owner, ...members] : [];
  const ids = new Set([p.id, ...people.map((x) => x.id)]);
  const key = phoneKey(p.phone);
  const others =
    key.length >= 10 ? S.patients.filter((x) => !ids.has(x.id) && phoneKey(x.phone) === key) : [];
  return {
    patientId: p.id,
    ownerId: members.length ? owner.id : null,
    phone: members.length ? owner.phone : p.phone,
    members: people.map((x) => memberOut(x, x.id === owner.id)),
    samePhone: others.map((x) => ({ ...memberOut(x, false), ...familyBits(x), relationKey: null, relationLabel: null })),
    message,
  };
}

function patientOr404(id) {
  const p = byId(id);
  if (!p) throw httpError(404, 'Patient not found');
  return p;
}

function relationOut(r) {
  return { ...c(r), patientCount: S.patients.filter((p) => p.familyOwnerId && p.relationKey === r.key).length };
}

// Demo "Group patients who share a number": same plan as the server.
function groupingPlan() {
  const owners = new Set(S.patients.filter((p) => p.familyOwnerId).map((p) => p.familyOwnerId));
  const groups = new Map();
  [...S.patients]
    .sort((a, b) => a.id - b.id)
    .forEach((p) => {
      const k = phoneKey(p.phone);
      if (k.length === 10) groups.set(k, [...(groups.get(k) || []), p]);
    });
  const plan = [];
  groups.forEach((rows) => {
    if (rows.length < 2) return;
    const existing = rows.filter((r) => owners.has(r.id));
    const free = rows.filter((r) => !r.familyOwnerId && !owners.has(r.id));
    let owner;
    let toLink;
    if (existing.length) [owner, toLink] = [existing[0], free];
    else if (free.length >= 2) [owner, toLink] = [free[0], free.slice(1)];
    else return;
    if (toLink.length) plan.push({ owner, toLink, isNew: !existing.length });
  });
  return plan;
}

function groupingOut(plan, written) {
  return {
    numbers: plan.length,
    newFamilies: plan.filter((x) => x.isNew).length,
    membersLinked: plan.reduce((n, x) => n + x.toLink.length, 0),
    written,
    sample: plan.slice(0, 20).map((x) => ({
      phone: x.owner.phone,
      ownerId: x.owner.id,
      ownerName: x.owner.name,
      memberNames: x.toLink.map((m) => m.name),
    })),
  };
}

export const family = {
  async get(patientId) {
    await latency(40);
    return familyOut(patientOr404(patientId));
  },
  async link(patientId, ownerId, relationKey = null) {
    await latency(60);
    const p = patientOr404(patientId);
    const message = linkInStore(p, ownerId, relationKey);
    store.notify();
    return familyOut(p, message);
  },
  async setRelation(patientId, relationKey) {
    await latency(40);
    const p = patientOr404(patientId);
    if (!p.familyOwnerId) throw httpError(409, `${p.name} is not a family member (the owner has no relation)`);
    p.relationKey = checkRelation(relationKey);
    store.notify();
    return familyOut(p);
  },
  async makeOwner(patientId, oldOwnerRelationKey = null) {
    await latency(60);
    const p = patientOr404(patientId);
    if (!p.familyOwnerId) throw httpError(409, `${p.name} already owns this number (or is not in a family)`);
    const key = checkRelation(oldOwnerRelationKey);
    const old = byId(p.familyOwnerId);
    const others = membersOf(old.id).filter((m) => m.id !== p.id);
    others.forEach((m) => {
      m.familyOwnerId = p.id;
    });
    p.familyOwnerId = null;
    p.relationKey = null;
    old.familyOwnerId = p.id;
    old.relationKey = key;
    store.notify();
    return familyOut(
      p,
      others.length
        ? `${p.name} now owns this number. The others' relations were set against ${old.name}: check they still read right.`
        : `${p.name} now owns this number.`
    );
  },
  async remove(patientId) {
    await latency(60);
    const p = patientOr404(patientId);
    let message;
    if (p.familyOwnerId) {
      p.familyOwnerId = null;
      p.relationKey = null;
      message = `${p.name} is no longer in this family.`;
    } else {
      const members = membersOf(p.id);
      if (!members.length) throw httpError(409, `${p.name} is not in a family`);
      if (members.length > 1)
        throw httpError(409, `${p.name} owns this number: make another member the owner first, then remove ${p.name}`);
      members[0].familyOwnerId = null;
      members[0].relationKey = null;
      message = `The family is undone: ${p.name} and ${members[0].name} are separate again.`;
    }
    store.notify();
    return familyOut(p, message);
  },
  async relations({ includeInactive = false } = {}) {
    await latency(30);
    return [...relationRows()]
      .filter((r) => includeInactive || r.active)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      .map(relationOut);
  },
  admin: {
    async create(label) {
      await latency(40);
      const name = String(label || '').trim();
      if (!name) throw httpError(422, 'A relation needs a name');
      const rows = relationRows();
      if (rows.some((r) => r.label.toLowerCase() === name.toLowerCase()))
        throw httpError(409, `'${name}' is already on the list`);
      const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'relation';
      let key = base;
      for (let n = 2; rows.some((r) => r.key === key); n += 1) key = `${base.slice(0, 27)}_${n}`;
      const row = {
        id: Math.max(0, ...rows.map((r) => r.id)) + 1,
        key,
        label: name,
        sortOrder: Math.max(0, ...rows.map((r) => r.sortOrder)) + 1,
        active: true,
      };
      rows.push(row);
      store.notify();
      return relationOut(row);
    },
    async update(key, patch) {
      await latency(40);
      const rows = relationRows();
      const row = rows.find((r) => r.key === key);
      if (!row) throw httpError(404, 'Relation not found');
      if (patch.label != null) {
        const name = String(patch.label).trim();
        if (!name) throw httpError(422, 'A relation needs a name');
        if (rows.some((r) => r !== row && r.label.toLowerCase() === name.toLowerCase()))
          throw httpError(409, `'${name}' is already on the list`);
        row.label = name;
      }
      if (patch.active != null) row.active = !!patch.active;
      store.notify();
      return relationOut(row);
    },
    async remove(key) {
      await latency(40);
      const rows = relationRows();
      const i = rows.findIndex((r) => r.key === key);
      if (i < 0) throw httpError(404, 'Relation not found');
      const used = relationOut(rows[i]).patientCount;
      if (used) throw httpError(409, `${used} patient(s) have the relation '${rows[i].label}': switch it off instead`);
      rows.splice(i, 1);
      store.notify();
      return null;
    },
    async reorder(keys) {
      await latency(40);
      const rows = relationRows();
      if (keys.length !== rows.length || !rows.every((r) => keys.includes(r.key)))
        throw httpError(422, 'order must list every existing relation exactly once');
      keys.forEach((k, i) => {
        rows.find((r) => r.key === k).sortOrder = i;
      });
      store.notify();
      return family.relations({ includeInactive: true });
    },
    async groupingPreview() {
      await latency(60);
      return groupingOut(groupingPlan(), false);
    },
    async groupingRun() {
      await latency(80);
      const plan = groupingPlan();
      plan.forEach(({ owner, toLink }) =>
        toLink.forEach((m) => {
          m.familyOwnerId = owner.id;
          m.relationKey = null;
        })
      );
      store.notify();
      return groupingOut(plan, true);
    },
  },
};
