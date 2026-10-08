-- Rueda del dato de riesgo país (2026-10-06). El valor se guardaba con la fecha de la CORRIDA y se descartaba
-- la que trae la fuente (argentinadatos devuelve `{ valor, fecha }`). La serie quedaba corrida un día hábil
-- entera: coincidía con el día hábil ANTERIOR de la fuente en 20 de 20 fechas comparables, y la pantalla decía
-- "655 al 5/10" cuando 655 era del viernes 2/10, con un delta "vs 2026-10-02" que en realidad era del 1/10.
-- Mismo tratamiento que `merval_date`, en la misma tabla, para el campo de al lado. Las filas viejas quedan en
-- NULL a propósito: no se puede saber de qué rueda era cada valor histórico, y la pantalla no afirma lo que no sabe.
ALTER TABLE "macro_ar_daily" ADD COLUMN IF NOT EXISTS "riesgo_pais_date" date;
