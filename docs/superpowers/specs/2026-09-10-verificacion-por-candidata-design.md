# Verificación web por candidata (pieza 2 de la estandarización)

Fecha: 2026-09-10. Estado: implementado en `feat/verificacion-candidata`. Pedido del dueño: que la app produzca sola lo que produje a mano el 10/9 leyendo balances, llamadas de resultados, notas de analistas y noticias para los 28 COMPRAR del Radar (APTO: NVDA, APH, LNC, NBN, SPNT, PAM, VIST, CTRE, KRG; EVITAR: UNIT, CARE, DEC, INSP; el resto con reservas).

## Qué hace

Para cada acción que queda **COMPRAR después de todas las reglas** (técnica, eventos, calidad de la ganancia), el modelo investiga en la web con un cuestionario fijo y dictamina. El dictamen es una clasificación del modelo; qué hace la app con él es regla en core.

**Dos llamadas por candidata** (`GeminiCandidateVerifier`, `packages/reasoner/src/verifier.ts`):
1. **Investigar**: `callGrounded` con la búsqueda de Google integrada (`tools: [{ google_search: {} }]`), modelo de investigación `gemini-2.5-flash` primero (1.500 pedidos con búsqueda por día gratis; 3.x tienen 5.000 búsquedas por mes compartidas). Salida: texto en español con fechas y fuentes, más `groundingMetadata` (fuentes citadas, búsquedas hechas).
2. **Estructurar**: llamada normal con la tool estricta `candidate_verification` sobre ese texto. Validación zod: fechas normalizadas a YYYY-MM-DD, textos recortados, dictamen ∈ {apto, con_reservas, evitar}; lo que no valida marca la fila del registro como `validacion`.

**Cuestionario** (`RESEARCH_SYSTEM`): último trimestre contra consenso y únicos; analistas 90 días con fecha, firma y objetivo; objetivo de consenso; eventos materiales 90 días (regulatorio, litigios y su estado, dilución, CEO/CFO, informes bajistas, ciberataques, adquisiciones); valuación contra historia y pares; próximos resultados; dictamen para 6–12 meses con una oración. Criterio de EVITAR: ganancia que depende de algo no recurrente, ingresos cayendo, evento binario en semanas, precio en el objetivo del consenso tras subida grande.

## Reglas (core)

- `verification` en `decideCandidate`: `undefined` = sin verificador (nada cambia); `null` = pendiente (bandera `verificacion_pendiente`, sin penalidad); `apto` → `verificacion_apta`; `con_reservas` → `verificacion_reservas` (−0,3 de convicción, cuenta como salvedad de calidad: con otra más → OBSERVAR); `evitar` → OBSERVAR con motivo `verificacion_evitar`.
- **Plan**: un COMPRAR con verificación `con_reservas` no entra como posición nueva; la nota dice "N° por convicción: verificación web con reservas: <motivo>".
- Convicción: `apta` suma a las razones (con fecha y motivo) sin bonificar.

## Pipeline

`verifyFor` (`packages/pipeline/src/radar-verify.ts`): caché por símbolo de 7 días y misma versión del prompt (`radar_verifications`, una fila por símbolo con el informe completo, fuentes y modelo); un fallo deja lo que había (vencido incluido) o null. Se llama en el ranking semanal y en el refresco diario, solo para lo que quedó COMPRAR, y el dictamen vuelve a pasar por `decideCandidate`. La fila del candidato guarda el resumen (`verification: { date, verdict, reason }`, migración 0013).

## Cuota (medida el 2026-09-10, no la publicada)

Sondeo con las cuatro claves: la búsqueda integrada tiene su propia cuota diaria gratis por proyecto y modelo, y en `gemini-2.5-flash` se agotó con **menos de 10 pedidos con búsqueda por clave**; en los modelos 3.x devuelve 429 sin detalle (no hay búsqueda gratis). La cuota diaria sin búsqueda también es menor a la publicada: 429 diario con 15–20 llamadas por modelo y clave. Consecuencias:
- Tope por corrida `candidates.verifyPerRun` (default 8, `VERIFY_PER_RUN_DEFAULT`): las verificaciones nuevas se reparten en días; lo que no entra queda `verificacion_pendiente` (o con su verificación vieja) hasta la próxima corrida. Con caché de 7 días, ~27 COMPRAR se cubren en 3–4 días y después solo se verifica lo que entra o vence.
- Registro de uso: propósito `verificacion` (con búsqueda; los tokens de entrada incluyen lo leído de la web) y `verificacion_estructura`. El panel marca la cuota diaria como "agotada hoy" por evidencia (429 diario), no por un tope inventado.
- Primera corrida real (10/9): 26 verificadas y 5 fallas; el modelo decía "con reservas" a casi todo porque 2.5 Flash gastaba el presupuesto pensando y el informe salía cortado. Arreglado con `thinkingBudget` 2.048, `maxOutputTokens` 12.000 y el dictamen en la primera línea del informe.

## Ficha y panel

Sección "Verificación web (modelo con búsqueda)" primero en la ficha del Radar y en la página por ticker: dictamen con fecha y motivo, último trimestre, analistas y consenso contra precio, eventos, valuación, próximos resultados, fuentes (enlaces) y el informe completo plegado. Banderas con etiqueta en la tabla.

## Tests

Reasoner (dos llamadas con búsqueda y tool, registro por propósito, validación), core (veredicto por dictamen, convicción, plan), pipeline (caché, versión, fallo), db (integración). Aceptación: NVDA apto con fixture canónica; HRTG con reservas fuera del plan con nota.

## Límites conocidos

Solo Gemini (la búsqueda integrada es de Google); con Anthropic no hay verificador y la app sigue como antes. El modelo puede equivocarse: por eso el informe completo y las fuentes quedan guardados para auditar, y el dictamen solo baja (nunca sube) un veredicto.
