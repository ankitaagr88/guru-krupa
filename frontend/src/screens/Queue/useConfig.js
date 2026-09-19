import { useEffect, useState } from 'react';
import { config as configApi } from '../../api';
import { CONDITIONS, PROTOCOL_STEPS, REFERRAL_SOURCES, REFERRAL_NEEDS_DETAIL } from '../../mocks/data';

/* GET /config → { stages, protocolSteps, referralSources, lensTiers, conditions }.
   Falls back to the mockup constants until the endpoint answers. Protocol steps are
   normalised to `{name, min}` (backend sends `minutes`). */
const FALLBACK = {
  stages: [],
  protocolSteps: PROTOCOL_STEPS,
  referralSources: REFERRAL_SOURCES.map((r) => ({
    ...r,
    needsDetail: REFERRAL_NEEDS_DETAIL.includes(r.key),
  })),
  lensTiers: [],
  conditions: CONDITIONS,
};

export default function useConfig() {
  const [cfg, setCfg] = useState(FALLBACK);
  useEffect(() => {
    let alive = true;
    configApi
      .get()
      .then((c) => {
        if (!alive || !c) return;
        setCfg({
          stages: c.stages || [],
          protocolSteps: (c.protocolSteps || []).map((s) => ({ ...s, min: s.min ?? s.minutes ?? 0 })),
          referralSources: (c.referralSources || []).map((r) => ({
            ...r,
            needsDetail:
              typeof r.needsDetail === 'boolean' ? r.needsDetail : REFERRAL_NEEDS_DETAIL.includes(r.key),
          })),
          lensTiers: c.lensTiers || [],
          conditions: c.conditions || CONDITIONS,
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return cfg;
}
