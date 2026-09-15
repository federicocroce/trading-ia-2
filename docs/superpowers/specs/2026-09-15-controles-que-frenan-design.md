# Controles que frenan (15/9)

## Por qué

El 14/9 el dueño preguntó: "¿por qué siguen pasando estas cosas si ya tenés todos los controles?". La respuesta
honesta tenía dos partes:

- Los controles verifican que la app **no se contradiga**, no que **tenga razón**.
- Solo corren cuando alguien los corre.

El 15/9 apareció otra prueba:

- La corrida automática de las 7:30 no rearmaba el plan.
- El plan siguió diciendo "comprar NVDA" cuando el Radar ya la tenía en OBSERVAR.
- El control que detecta eso (`plan_atrasado`) existía, pero nadie lo corrió.

Regla de diseño: **si la app no puede asegurar algo, frena**. Nunca compra por defecto.

## Piezas

### 1. Una sola secuencia después de cada corrida (`jobs.ts`)

- Cron, catch-up, rutas y CLI llaman a la misma función, que termina siempre con `replan`.
- Antes eran cuatro copias. La del cron no rearmaba el plan.
- Test: cada tarea que cambia entradas del plan deja un plan del día.

### 2. Controles automáticos que frenan (`controles`)

- Después de cada corrida y de cada `replan`, corren la auditoría de pantallas y la consistencia de filas, en el mismo proceso.
- El resultado se guarda en `state.controles` y se sirve en `GET /controles`.
- Con un grave, el plan no dice COMPRAR en ninguna pantalla: la instrucción pasa a "NO EJECUTAR" con el motivo.
- Si los controles no corrieron desde el último rearmado, tampoco se ejecuta ("controles pendientes").

### 3. Por qué cambió el plan (`explainPlanChange`)

- Cada plan guarda, por símbolo, las entradas con las que se armó: cierre, stop, veredicto, tipo de fila, dictamen y banderas.
- Al rearmarse, se compara con el anterior. Por línea que entra, sale o cambia de monto, se da la causa:
  - **mercado:** precio o stop;
  - **verificación;**
  - **regla:** el motivo de `leftOut`;
  - **tu acción:** la fila cambió de tipo, por ejemplo al seguirla;
  - **reparto:** cambió otra línea.
- Un cambio por acción del usuario se marca aparte, porque no viene del mercado.

### 4. Verificador que falla cerrado

- El cuestionario pide los datos críticos:
  - ganancia limpia;
  - guía;
  - riesgos regulatorios y de licencias, permisos y concesiones;
  - ampliaciones de capital;
  - en bancos, fondeo e inmobiliario comercial.
- El análisis estructurado devuelve `missing`.
- Un dictamen "apto" con datos críticos faltantes se convierte en código en "con_reservas" (falta: X).
- No depende de que el modelo obedezca.
- Cambia `promptVersion`: todo se vuelve a verificar, empezando por lo de más convicción.

### 5. Revisión antes de comprar

- Para cada acción que el plan compraría, corre una segunda búsqueda independiente del verificador.
- El prompt es adversarial: buscar razones para **no** comprarla hoy, cada una con dato, fuente y fecha, en noticias y hechos de los últimos 30 días.
- Dictámenes posibles: SIN_OBJECIONES, OBJECION o NO_PUDE_VERIFICAR.
- Solo SIN_OBJECIONES deja comprar.
- Se guarda por símbolo y día, y entra al plan como un bloqueo más: lo que no fue revisado no se compra.

### 6. Verificación obligatoria antes de mergear (`pnpm verificar`)

- Corre tests y el control de tipos de todos los paquetes sin cortarse, y resume.
- El hook `pre-push` (`core.hooksPath=.githooks`) lo exige.
- `git push . HEAD:master` es la única forma de mergear que usamos.

## Fuera de alcance

El stop después de la compra ([[stop-tras-la-compra]]) sigue pendiente de decisión del dueño.
