import Placeholder from '../../components/Placeholder';

/* "Today" summary (lane B owns this screen): patients seen, average time per stage,
   collections by payment mode, medicines sold — so "more patients per day" is measurable.
   Data: `reports` in src/api (GET /reports/today). */
export default function Today() {
  return <Placeholder title="Today's summary" sub="Patients, time per stage, collections" owner="lane B" />;
}
