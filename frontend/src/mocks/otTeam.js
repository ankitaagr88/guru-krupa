/* Demo-mode OT team: team roles, the directory of outside doctors / partners, and the checks on a
   case's team (billing.team). Same method names and shapes as `otTeam` in src/api/real.js; the
   server rules are in backend/app/services/ot_team.py.
   State lives in `store.state.otTeamLists`, created on first use and re-created after
   `store.reset()` (which swaps the otCases array the state is tied to). */
import { store, latency } from './store';
import { printSettings } from './rxPrint';

const S = store.state;
const c = store.clone;

// Same starting roles as the server seed (backend/app/seed/ot_team.py); fees start at ₹0.
const SEED_ROLES = [
  ['surgeon', 'Surgeon'],
  ['assistant_surgeon', 'Assistant surgeon'],
  ['anaesthetist', 'Anaesthetist'],
  ['scrub_nurse', 'Scrub nurse'],
  ['ot_technician', 'OT technician'],
];
const STAFF_ROLES_IN_OT = ['doctor', 'ot_staff', 'optometrist'];

function state() {
  if (!S.otTeamLists || S.otTeamLists.owner !== S.otCases) {
    S.otTeamLists = {
      owner: S.otCases,
      roles: SEED_ROLES.map(([key, label], i) => ({ id: i + 1, key, label, defaultFee: 0, sortOrder: i, active: true })),
      partners: [
        {
          id: 1,
          name: 'Dr. Kavita Shah',
          qualification: 'MD Anaesthesia',
          regNo: 'G-24518',
          phone: '9824000011',
          defaultRoleKey: 'anaesthetist',
          defaultFee: 2500,
          note: 'Visiting anaesthetist',
          active: true,
          createdAt: new Date().toISOString(),
        },
      ],
    };
  }
  return S.otTeamLists;
}

function httpError(status, message) {
  const err = new Error(message);
  err.response = { status, data: { detail: message } };
  return err;
}

const text = (v) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim();
const ordered = (rows) => rows.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
const byName = (rows) => rows.slice().sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

function fee(v, where) {
  if (v == null || v === '') return 0;
  let n = v;
  if (typeof v === 'string') {
    const s = v.replace(/[,₹\s]/g, '');
    if (!/^-?\d+$/.test(s)) throw httpError(422, `${where}: the fee must be whole rupees, e.g. 2500`);
    n = Number(s);
  }
  if (typeof n !== 'number' || Number.isNaN(n)) throw httpError(422, `${where}: the fee must be a number of rupees`);
  if (!Number.isInteger(n)) throw httpError(422, `${where}: the fee must be whole rupees (no paise)`);
  if (n < 0) throw httpError(422, `${where}: the fee cannot be below ₹0`);
  return n;
}

/* ---------------- the team on a case (used by the demo OT adapter) ---------------- */
const rowEmpty = (r) => !['name', 'qualification', 'regNo'].some((k) => text(r?.[k])) && !Number(r?.fee);

/** Validate + tidy a team like the server: fully empty rows dropped; known role, a name, whole-rupee
    fee ≥ 0; an outside member needs a qualification. Throws a 422 naming the row. */
export function cleanTeam(team) {
  if (team == null) return [];
  if (!Array.isArray(team)) throw httpError(422, 'The OT team must be a list of team members');
  const roles = state().roles;
  const out = [];
  team.forEach((raw, idx) => {
    const i = idx + 1;
    if (rowEmpty(raw)) return;
    const key = text(raw.roleKey);
    const role = roles.find((r) => r.key === key);
    let where = `OT team row ${i}${role ? ` (${role.label})` : ''}`;
    if (!key) throw httpError(422, `${where}: pick a role (Surgeon, Anaesthetist…)`);
    if (!role) throw httpError(422, `${where}: unknown role '${key}'`);
    const name = text(raw.name);
    if (!name) throw httpError(422, `${where}: enter the person's name`);
    where = `OT team row ${i} (${role.label}, ${name})`;
    const qualification = text(raw.qualification);
    const external = !!raw.external;
    if (external && !qualification)
      throw httpError(422, `${where}: an outside doctor needs a medical qualification (e.g. MD Anaesthesia)`);
    const partnerId = raw.partnerId == null || raw.partnerId === '' ? null : Number(raw.partnerId);
    if (partnerId != null && !state().partners.some((p) => p.id === partnerId))
      throw httpError(422, `${where}: unknown outside doctor`);
    out.push({
      roleKey: key,
      roleLabel: text(raw.roleLabel) || role.label,
      name,
      qualification,
      regNo: text(raw.regNo),
      external,
      partnerId,
      fee: fee(raw.fee, where),
    });
  });
  return out;
}

/** A new surgery starts with the clinic's doctor as Surgeon (from the prescription print settings). */
export function defaultTeam() {
  const role = state().roles.find((r) => r.key === 'surgeon');
  const s = printSettings();
  if (!role || !role.active || !text(s.doctorName)) return [];
  return [
    {
      roleKey: role.key,
      roleLabel: role.label,
      name: text(s.doctorName),
      qualification: text(s.degrees),
      regNo: text(s.regNo),
      external: false,
      partnerId: null,
      fee: role.defaultFee || 0,
    },
  ];
}

/** The team to show: the stored one, or an older case's operative.surgeon as a Surgeon row. */
export function teamOf(k) {
  if (Array.isArray(k?.billing?.team)) return k.billing.team;
  const surgeon = text(k?.operative?.surgeon);
  if (!surgeon) return [];
  const label = state().roles.find((r) => r.key === 'surgeon')?.label || 'Surgeon';
  return [
    { roleKey: 'surgeon', roleLabel: label, name: surgeon, qualification: '', regNo: '', external: false, partnerId: null, fee: 0 },
  ];
}

export const teamFees = (team) => (team || []).reduce((s, m) => s + Math.max(Number(m.fee) || 0, 0), 0);

/* ---------------- admin: outside doctors ---------------- */
function partnerValues(body, row) {
  const st = state();
  const out = {};
  if (body.name != null) {
    const name = text(body.name);
    if (!name) throw httpError(422, 'An outside doctor needs a name');
    if (st.partners.some((p) => p !== row && p.name.toLowerCase() === name.toLowerCase()))
      throw httpError(409, `'${name}' is already on the list of outside doctors`);
    out.name = name;
  }
  ['qualification', 'regNo', 'phone', 'note'].forEach((k) => {
    if (body[k] != null) out[k] = text(body[k]);
  });
  if ('qualification' in out && !out.qualification)
    throw httpError(422, 'An outside doctor needs a medical qualification (e.g. MD Anaesthesia)');
  if ('defaultRoleKey' in body) {
    const key = body.defaultRoleKey || null;
    if (key && !st.roles.some((r) => r.key === key)) throw httpError(422, `Unknown team role '${key}'`);
    out.defaultRoleKey = key;
  }
  if (body.defaultFee != null) out.defaultFee = fee(body.defaultFee, 'Usual fee');
  if (body.active != null) out.active = !!body.active;
  return out;
}

export const otTeam = {
  async options() {
    await latency(20);
    const st = state();
    return c({
      roles: ordered(st.roles).filter((r) => r.active),
      partners: byName(st.partners).filter((p) => p.active),
      staff: S.staff
        .filter((s) => s.active !== false && STAFF_ROLES_IN_OT.includes(s.role))
        .map((s) => ({ name: s.name, role: s.role }))
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
    });
  },
  admin: {
    async roles() {
      await latency(20);
      return c(ordered(state().roles));
    },
    async createRole(label, defaultFee = 0) {
      await latency(30);
      const rows = state().roles;
      const n = text(label);
      if (!n) throw httpError(422, 'A team role needs a name');
      if (rows.some((r) => r.label.toLowerCase() === n.toLowerCase())) throw httpError(409, `'${n}' is already on the list`);
      const base =
        n
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .slice(0, 30) || 'ot_team_role';
      let key = base;
      for (let i = 2; rows.some((r) => r.key === key); i += 1) key = `${base.slice(0, 27)}_${i}`;
      const row = {
        id: Math.max(0, ...rows.map((r) => r.id)) + 1,
        key,
        label: n,
        defaultFee: fee(defaultFee, 'Usual fee'),
        sortOrder: Math.max(0, ...rows.map((r) => r.sortOrder)) + 1,
        active: true,
      };
      rows.push(row);
      store.notify();
      return c(row);
    },
    async updateRole(key, patch = {}) {
      await latency(30);
      const rows = state().roles;
      const row = rows.find((r) => r.key === key);
      if (!row) throw httpError(404, 'Team role not found');
      if (patch.label != null) {
        const n = text(patch.label);
        if (!n) throw httpError(422, 'A team role needs a name');
        if (rows.some((r) => r !== row && r.label.toLowerCase() === n.toLowerCase()))
          throw httpError(409, `'${n}' is already on the list`);
        row.label = n;
      }
      if (patch.defaultFee != null) row.defaultFee = fee(patch.defaultFee, 'Usual fee');
      if (patch.active != null) row.active = !!patch.active;
      store.notify();
      return c(row);
    },
    async reorderRoles(keys) {
      await latency(30);
      const rows = state().roles;
      if (keys.length !== rows.length || !rows.every((r) => keys.includes(r.key)))
        throw httpError(422, 'order must list every existing ot team role exactly once');
      keys.forEach((k, i) => {
        rows.find((r) => r.key === k).sortOrder = i;
      });
      store.notify();
      return c(ordered(rows));
    },
    async partners() {
      await latency(20);
      return c(byName(state().partners));
    },
    async createPartner(body = {}) {
      await latency(30);
      const st = state();
      const clean = partnerValues({ ...body, name: body.name ?? '', qualification: body.qualification ?? '' });
      const row = {
        id: Math.max(0, ...st.partners.map((p) => p.id)) + 1,
        regNo: '',
        phone: '',
        note: '',
        defaultRoleKey: null,
        defaultFee: 0,
        ...clean,
        active: true,
        createdAt: new Date().toISOString(),
      };
      st.partners.push(row);
      store.notify();
      return c(row);
    },
    async updatePartner(id, patch = {}) {
      await latency(30);
      const row = state().partners.find((p) => p.id === Number(id));
      if (!row) throw httpError(404, 'Outside doctor not found');
      Object.assign(row, partnerValues(patch, row));
      store.notify();
      return c(row);
    },
  },
};
