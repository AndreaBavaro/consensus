/**
 * Step codebook for extraction (v2; Andrea approved extending it to non-paperwork steps on 2026-10-14). Codes are "<country>:<step>", independent of the
 * route, so one code covers e.g. the codice fiscale step on every Italian route. `rule` is the New Postcode rule slug
 * (newpostcode/src/db/seed-data.ts); timeline step ids (newpostcode/data/timeline/<cc>.json) end in "-<step>".
 */
export interface StepCode {
  label: string;
  rule?: string;
}

export const CODEBOOK: Record<string, StepCode> = {
  // Italy
  "it:prenotami-register": { label: "Book the consulate appointment on Prenot@mi" },
  "it:visa-application": { label: "Prepare and submit the visa application" },
  "it:fingerprints": { label: "Consulate fingerprints / biometrics" },
  "it:entry-and-permesso": { label: "Apply for the permesso di soggiorno after arrival" },
  "it:permesso-renewal": { label: "Renew the permesso di soggiorno" },
  "it:codice-fiscale": { label: "Get the codice fiscale", rule: "it-codice-fiscale" },
  "it:housing-paperwork": { label: "Lease registration and housing paperwork" },
  "it:residenza": { label: "Register residence at the anagrafe", rule: "it-anagrafe-registration" },
  "it:aire": { label: "AIRE registration or cancellation", rule: "it-aire-90-days" },
  "it:ssn": { label: "Enrol in the SSN and get the tessera sanitaria" },
  "it:bank-account": { label: "Open an Italian bank account" },
  "it:cie": { label: "Get the carta d'identità elettronica" },
  "it:partita-iva": { label: "Open a partita IVA and INPS registration" },
  "it:citizenship-descent": { label: "Citizenship by descent (jure sanguinis)" },
  "it:driving-licence": { label: "Convert or obtain a driving licence" },
  "it:job-search": { label: "Look for work with an Italian employer" },
  "it:school-enrolment": { label: "Enrol children in school" },
  // Portugal
  "pt:nif": { label: "Get the NIF", rule: "pt-nif" },
  "pt:bank-account": { label: "Open a Portuguese bank account" },
  "pt:lease": { label: "Find and sign a lease" },
  "pt:visa-application": { label: "D7/D8 visa application at the consulate or VFS" },
  "pt:aima": { label: "AIMA appointment and residence card (unspecified)" },
  "pt:aima-first": { label: "First AIMA residence appointment" },
  "pt:aima-renewal": { label: "Residence permit renewal (AIMA)" },
  "pt:biometrics": { label: "Biometrics appointment (AIMA or IRN)" },
  "pt:card-delivery": { label: "Residence card printing and delivery" },
  "pt:permanent-residence": { label: "Permanent residence application" },
  "pt:visa-extension": { label: "Extending the entry visa while waiting for AIMA" },
  "pt:chave-movel-digital": { label: "Chave Móvel Digital (government login)" },
  "pt:niss": { label: "Get the NISS (social security number)" },
  "pt:junta-registration": { label: "Junta de freguesia registration / residence certificate" },
  "pt:sns": { label: "Get the SNS number / register at a health centre", rule: "pt-sns-number" },
  "pt:tax-residency": { label: "Become Portuguese tax resident", rule: "pt-tax-residency-183" },
  "pt:ifici": { label: "IFICI / NHR tax regime", rule: "pt-ifici-20-percent" },
  "pt:job-search": { label: "Look for work with a Portuguese employer" },
  "pt:school-enrolment": { label: "Enrol children in school" },
  "pt:driving-licence": { label: "Exchange or obtain a driving licence" },
  // Ireland
  "ie:work-permit": { label: "Employment permit or Stamp 1G" },
  "ie:housing": { label: "Find housing / a lease" },
  "ie:irp": { label: "IRP registration appointment", rule: "ie-irp-registration" },
  "ie:pps": { label: "Get the PPS number", rule: "ie-pps-number" },
  "ie:bank-account": { label: "Open an Irish bank account" },
  "ie:gp": { label: "Register with a GP" },
  "ie:school-enrolment": { label: "Enrol children in school", rule: "ie-school-enrolment" },
  "ie:job-search": { label: "Look for work with an Irish employer" },
  "ie:driving-licence": { label: "Exchange or obtain a driving licence" },
  // Spain
  "es:visa-application": { label: "Visa application at the consulate or BLS" },
  "es:nie": { label: "Get the NIE", rule: "es-nie" },
  "es:padron": { label: "Register on the padrón", rule: "es-padron" },
  "es:tie": { label: "TIE card appointment and fingerprints", rule: "es-tie-30-days" },
  "es:bank-account": { label: "Open a Spanish bank account" },
  "es:beckham": { label: "Beckham tax regime", rule: "es-beckham-regime" },
  "es:lease": { label: "Find and sign a lease" },
  "es:healthcare": { label: "Register for public healthcare (tarjeta sanitaria) or private cover" },
  "es:job-search": { label: "Look for work with a Spanish employer" },
  "es:school-enrolment": { label: "Enrol children in school" },
  "es:driving-licence": { label: "Exchange or obtain a driving licence" },
  // France
  "fr:visa-application": { label: "Long-stay visa application (France-Visas / VFS)" },
  "fr:vls-ts-validation": { label: "Validate the VLS-TS online", rule: "fr-vls-ts-validation" },
  "fr:titre-de-sejour": { label: "Titre de séjour application or renewal", rule: "fr-titre-de-sejour" },
  "fr:social-security": { label: "Social security number / PUMA / carte Vitale", rule: "fr-social-security-number" },
  "fr:bank-account": { label: "Open a French bank account" },
  "fr:housing": { label: "Find housing / a dossier for a lease" },
  "fr:caf": { label: "CAF housing benefit" },
  "fr:job-search": { label: "Look for work with a French employer" },
  "fr:school-enrolment": { label: "Enrol children in school" },
  "fr:driving-licence": { label: "Exchange or obtain a driving licence" },
  // Canada exit
  "ca:nr73": { label: "NR73 / residency determination", rule: "nr73-residency-opinion" },
  "ca:departure-tax": { label: "Departure tax (deemed disposition)", rule: "departure-tax-deemed-disposition" },
  "ca:final-return": { label: "Final tax return for the year of departure", rule: "final-return-year-of-departure" },
  "ca:tfsa": { label: "TFSA after leaving", rule: "tfsa-non-resident-penalty" },
  "ca:rrsp": { label: "RRSP withdrawals as a non-resident", rule: "rrsp-non-resident-withholding" },
  "ca:broker": { label: "Canadian bank or broker account as a non-resident" },
  "ca:ohip": { label: "OHIP coverage when leaving Ontario", rule: "ohip-153-days" },
  "ca:provincial-health": { label: "Other provincial health coverage (RAMQ, MSP, AHCIP)" },
  "ca:cpp-oas": { label: "CPP and OAS from abroad", rule: "cpp-paid-anywhere" },
  // Anything else
  other: { label: "A step not in this codebook" },
};

/** Timeline step ids (any route) for a code: "it:codice-fiscale" matches "it-remote-work-11-codice-fiscale". */
export function timelineStepFor(code: string, ids: string[]): string[] {
  const [cc, step] = code.split(":");
  if (!cc || !step) return [];
  return ids.filter((id) => id.startsWith(`${cc}-`) && id.endsWith(`-${step}`));
}
