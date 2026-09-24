export const companyTickers = {
  "0": { cik_str: 1234567, ticker: "XXXX", title: "Xxxx Therapeutics Inc" },
  "1": { cik_str: 904851, ticker: "YPF", title: "YPF SOCIEDAD ANONIMA" },
};
/** El CIK real de AES, para la prueba de la oferta de compra. */
export const companyTickersAES = {
  "0": { cik_str: 874761, ticker: "AES", title: "AES CORP" },
};
export const submissionsXXXX = {
  cik: "1234567",
  name: "Xxxx Therapeutics Inc",
  filings: {
    recent: {
      accessionNumber: ["0001234567-26-000010", "0001234567-26-000009", "0001234567-26-000001"],
      filingDate: ["2026-09-02", "2026-08-30", "2026-01-15"],
      form: ["8-K", "10-Q", "8-K"],
      primaryDocument: ["xxxx-8k.htm", "xxxx-10q.htm", "old.htm"],
      items: ["8.01", "", "2.02"],
    },
  },
};
/**
 * AES tal como está en EDGAR al 16/9/2026: el DEFM14A de la fusión es del 15/5/2026 y el PREM14A del 4/5/2026,
 * cuatro meses atrás, con 8-K y 10-Q recientes encima. Y presenta DEF 14A todos los marzos, que NO es una oferta.
 */
/**
 * MG, EDGAR al 24/9/2026 (recortado): siete DEFA14A y el 8-K del acuerdo con H.I.G. el 18/9, sin PREM14A todavía. El
 * 8-K de cooperación es inventado para el caso contrario (ITGR tenía la misma forma: 1.01 + 5.02).
 */
export const companyTickersMG = {
  "0": { cik_str: 1436126, ticker: "MG", title: "Mistras Group, Inc." },
  "1": { cik_str: 1114483, ticker: "ITGR", title: "Integer Holdings Corp" },
};
export const submissionsMG = {
  cik: "1436126",
  name: "Mistras Group, Inc.",
  filings: {
    recent: {
      accessionNumber: ["0001436126-26-000108", "0001140361-26-037137", "0001140361-26-037117", "0001140361-26-037107", "0001436126-26-000090", "0001436126-26-000050"],
      filingDate: ["2026-09-22", "2026-09-18", "2026-09-18", "2026-09-18", "2026-08-10", "2026-04-07"],
      form: ["4", "DEFA14A", "DEFA14A", "8-K", "8-K", "DEFA14A"],
      primaryDocument: ["xslF345X06/form4.xml", "ef20082425_defa14a.htm", "ef20082419_defa14a.htm", "ef20082419_8k.htm", "mg-8k.htm", "mg-defa14a.htm"],
      items: ["", "", "", "1.01,5.02,7.01,8.01,9.01", "2.02,9.01", ""],
    },
  },
};
export const mg8k = `<html><body><p><b>Item 1.01. Entry into a Material Definitive Agreement.</b></p><p><i>Agreement and Plan of Merger</i></p><p>On September 17, 2026, Mistras Group, Inc., a Delaware corporation (the &ldquo;Company&rdquo;), entered into an Agreement and Plan of Merger (the &ldquo;Merger Agreement&rdquo;) with Athena Purchaser, LLC, a Delaware limited liability company (&ldquo;Parent&rdquo;), and Athena Merger Sub, Inc., a Delaware corporation and a wholly owned subsidiary of Parent (&ldquo;Acquisition Sub&rdquo;).</p></body></html>`;
export const submissionsITGR = {
  cik: "1114483",
  name: "Integer Holdings Corp",
  filings: {
    recent: {
      accessionNumber: ["0001114483-26-000010", "0001171843-26-001505"],
      filingDate: ["2026-03-12", "2026-03-12"],
      form: ["DEFA14A", "8-K"],
      primaryDocument: ["itgr-defa14a.htm", "f8k_031226.htm"],
      items: ["", "1.01,5.02,7.01,9.01"],
    },
  },
};
export const itgr8k = `<html><body><p>Item 1.01. Entry into a Material Definitive Agreement.</p><p>On March 9, 2026 (the &ldquo;Effective Date&rdquo;), Integer Holdings Corporation (the &ldquo;Company&rdquo;) entered into a Cooperation Agreement (the &ldquo;Cooperation Agreement&rdquo;) by and among the Company, Irenic Capital Management LP</p></body></html>`;

export const submissionsAES = {
  cik: "874761",
  name: "AES CORP",
  filings: {
    recent: {
      accessionNumber: ["0000874761-26-000153", "0000874761-26-000120", "0000874761-26-000090", "0000874761-26-000085", "0000874761-26-000040"],
      filingDate: ["2026-09-16", "2026-08-05", "2026-05-15", "2026-05-04", "2026-03-20"],
      form: ["8-K", "10-Q", "DEFM14A", "PREM14A", "DEF 14A"],
      primaryDocument: ["aes-8k.htm", "aes-10q.htm", "aes-defm14a.htm", "aes-prem14a.htm", "aes-def14a.htm"],
      items: ["5.02", "", "", "", ""],
    },
  },
};
export const filingHtml = `<html><head><style>p{}</style></head><body><p>Item 8.01 Other Events.</p><p>The Company announced that the FDA has set a PDUFA target action date of <b>November 20, 2026</b>.</p></body></html>`;

/** Form 4: una compra en mercado (P), un vesting rutinario (A + F) y una venta (S). */
export const submissionsForm4 = {
  cik: "1234567",
  name: "Xxxx Therapeutics Inc",
  filings: {
    recent: {
      accessionNumber: ["0001234567-26-000101", "0001234567-26-000102", "0001234567-26-000103"],
      filingDate: ["2026-09-02", "2026-09-02", "2026-09-03"],
      form: ["4", "4", "4"],
      primaryDocument: ["xslF345X06/wk-form4_1.xml", "xslF345X06/wk-form4_2.xml", "xslF345X06/wk-form4_3.xml"],
      items: ["", "", ""],
    },
  },
};
const tx = (code: string, ad: "A" | "D", shares: number) => `<nonDerivativeTransaction><transactionCoding><transactionCode>${code}</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>${shares}</value></transactionShares><transactionAcquiredDisposedCode><value>${ad}</value></transactionAcquiredDisposedCode></transactionAmounts></nonDerivativeTransaction>`;
export const form4Purchase = `<?xml version="1.0"?><ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>Marin Horacio Daniel</rptOwnerName></reportingOwnerId></reportingOwner><nonDerivativeTable>${tx("P", "A", 352433)}</nonDerivativeTable></ownershipDocument>`;
export const form4Vesting = `<?xml version="1.0"?><ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>Lu Lee-Chung</rptOwnerName></reportingOwnerId></reportingOwner><nonDerivativeTable>${tx("A", "A", 21645)}${tx("F", "D", 8000)}</nonDerivativeTable></ownershipDocument>`;
export const form4Sale = `<?xml version="1.0"?><ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>Toth Peter</rptOwnerName></reportingOwnerId></reportingOwner><nonDerivativeTable>${tx("S", "D", 3000)}</nonDerivativeTable></ownershipDocument>`;
