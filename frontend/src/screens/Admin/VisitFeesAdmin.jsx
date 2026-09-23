/* Admin › Visit types & fee rules (lane E2 owns this file): new patient / follow-up / new case /
   after surgery, the charge each puts on the bill, and the day limits and emergency hours that pick
   one automatically. Takes the parent's `run(fn, okMsg)`. */
// eslint-disable-next-line no-unused-vars
export function VisitFeesSection({ run }) {
  return (
    <section className="admin-block" aria-labelledby="h-visitfees">
      <h2 id="h-visitfees">Visit types &amp; fee rules</h2>
      <p className="hint">Coming this session.</p>
    </section>
  );
}
