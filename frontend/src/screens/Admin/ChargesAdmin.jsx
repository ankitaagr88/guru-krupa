/* Admin › Standard charges (lane B owns this file): consultation, pre-test, dilation… with
   an amount each; the billing panel adds one to the bill with one tap. Takes the parent's
   `run(fn, okMsg)` like the other sections. */
// eslint-disable-next-line no-unused-vars
export function ChargesSection({ run }) {
  return (
    <section className="admin-block" aria-labelledby="h-charges">
      <h2 id="h-charges">Standard charges</h2>
      <p className="hint">Coming this session.</p>
    </section>
  );
}
