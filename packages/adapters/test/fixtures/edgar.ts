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
