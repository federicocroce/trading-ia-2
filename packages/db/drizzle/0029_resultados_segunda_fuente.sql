-- Segunda fuente para la fecha de resultados (2026-10-10).
--
-- Por qué. `next_earnings` viene solo de Finnhub, y contra el calendario de Nasdaq difería en 33 de 93 símbolos en la
-- mira. Donde se pudo verificar con la empresa, Finnhub erraba: DXCM decía 22/10 y la empresa fijó el 29/10; NEM (en
-- cartera) no tenía fecha y la empresa reporta el 22/10; TSM decía 14/10 y es el 15/10. La regla de "resultados cerca"
-- dependía de esa sola fecha. Aditivo: la columna nueva guarda la de Nasdaq y ninguna lectura existente cambia.
ALTER TABLE "fundamentals" ADD COLUMN IF NOT EXISTS "next_earnings_alt" date;
