# Simulación de Estrés: App Móvil (Escenario Realista/Falla)

Esta es una simulación de estrés ("stress-test") del protocolo ACDP. A diferencia del ejemplo PHP ("camino feliz"), esta simulación explora casos límite realistas donde **las cosas salen mal**: bloqueos cruzados (deadlocks), un agente que "crashea", y conflictos de escritura simultánea en el log. El protocolo sobrevive, pero el proyecto sufre retrasos reales y requiere intervención humana.

## Agentes y Proyecto

**Proyecto:** App móvil básica (React Native / Expo) con Login.
**Módulos principales:** `src/screens/`, `src/services/`, `src/auth/`, `src/types/`, `App.tsx`.

| Agente       | Tipo   | Rol       |
|--------------|--------|-----------|
| `gabriel`    | Humano | Maintainer|
| `agent-ui`   | IA     | Developer (Vistas y Navegación) |
| `agent-api`  | IA     | Developer (Conexión backend y Tipos) |
| `agent-auth` | IA     | Developer (Lógica de autenticación) |

---

## Narrativa del Caos

### T=0: Inicialización y Registro
`gabriel` inicializa el proyecto. Los 3 agentes se registran (`status: pending`). `gabriel` aprueba a los tres.

### T=5 min: Intents cruzados sin leer el mapa
- `agent-api` declara intent sobre `src/services/` y `src/types/`.
- `agent-auth` declara intent sobre `src/auth/` y `App.tsx` (quiere inyectar el AuthProvider).
- `agent-ui` hace un *Resource Assessment* pobre y declara intent sobre `src/screens/` y `App.tsx` (quiere inyectar el React Navigation).

**Falla 1 prevenida:** `agent-auth` es un segundo más rápido y mete el lock sobre `App.tsx` primero. Cuando `agent-ui` intenta lockear `App.tsx`, lee el archivo, ve que está ocupado y frena. Queda en estado `waiting`.

### T=12 min: Deadlock (Bloqueo circular)
El trabajo avanza, pero ocurre un escenario de dependencia circular típica:
- `agent-api` necesita las definiciones JWT que está escribiendo `agent-auth` en `src/auth/types.ts` para armar el interceptor HTTP mensual, así que manda un `request` pidiendo que libere o comparta.
- Al mismo tiempo, `agent-auth` necesita el cliente base que está en `src/services/api.ts` (lockeado por `agent-api`) para hacer el POST del login. Manda un `request`.

**Estado:**
- `agent-api` tiene `src/services/`, necesita `src/auth/`.
- `agent-auth` tiene `src/auth/`, necesita `src/services/`.

Ambos envían `ack` con `accepted: false` (rechazan el pedido del otro) porque ambos creen que su tarea es bloqueante.
El protocolo dicta que tras un ack negativo, máximo 3 reintentos antes de escalar. Ambos se re-envían requests ciegamente y agotan los intentos en 5 minutos. Disparan `block` en el evento log dirigido al maintainer.

### T=25 min: Conflicto en events.log (Concurrent Writes)
Mientras `gabriel` analiza el deadlock, `agent-ui` (que estaba esperando por `App.tsx`) decide cambiar de tarea y lockear `src/components/`.
A la vez, `gabriel` emite un `resolve` forzando un diseño: le dice a `agent-auth` que mockee el cliente por ahora y siga.
Ambos, `agent-ui` y `gabriel`, hacen `git push` al mismo tiempo sobre `events.log`.
GitHub rechaza el push de `agent-ui`. Siguiendo la regla de oro de concurrent writes (Sección 4), `agent-ui` hace pull, el merge de `events.log` colapsa, y `agent-ui` *junta ambas líneas* preservando los dos json y pushea de nuevo. El repositorio sobrevive sin dañar la integridad del protocolo.

### T=45 min: El "Crash" (Agente Offline)
`gabriel` destrabó el deadlock. `agent-auth` mockeó y terminó. Liberó `App.tsx`.
`agent-ui` por fin toma `App.tsx` y lo termina.
 `agent-api` había tomado un lock de directorio enorme sobre `src/types/` (TTL=60 min). Empieza a codear, pero... falla su servidor interno de LLM. O agota sus tokens. O se queda en un bucle infinito en su propia máquina. **El agente "crashea" en silencio.**

Tarde o temprano, `agent-ui` necesita importar la interfaz `User` desde `src/types/`. Manda `request`. Nada. Manda de nuevo. Nada. El log queda mudo por parte de `agent-api`.
La regla dice: si no responde después de 2x el TTL, el maintainer interviene. Pero tienen que pasar 2 HORAS reales de espera protocolar (TTL=60 * 2 = 120min).
El proyecto queda literalmente congelado mientras `agent-ui` espera a un fantasma.

### T=3 Horas: Override Manual
Pasan 120 minutos de inactividad de `agent-api`. Gabriel se conecta:
1. `gabriel` emite `notify` severity `warning` decretando a `agent-api` como `offline`.
2. `gabriel` asume control manual, edita `locks.json`, borra a la fuerza el lock de `src/types/`.
3. Emite un evento `release` de `src/types/` con `override: true`.
4. `agent-ui` hace pull, detecta que se liberó, y retoma el proyecto.

---

## Análisis de Falla vs. Protocolo

| Situación "Mala" | Cómo lo manejó ACDP | Conclusión |
|------------------|---------------------|------------|
| Dos agentes van por el mismo archivo | Carrera al lock. Queda registrado en el log quién ganó. | Éxito. Previene merge conflict catastrófico. |
| Dependencia circular (Deadlock) | Ambos estancan enviando acks negativos 3 veces. Se genera un `block` forzando al humano. | Funciona, pero el proyecto perdió ~15 valiosos minutos por la terquedad de los IAs. |
| Push concurrente contra events.log | Regla "Pull before push, unir todo preservando timestamps". | Excelente. Resiliencia pura a nivel Git. |
| Agente crashea manteniendo un lock | El protocolo espera respetuosamente 2x TTL. El proyecto se frena 2 horas. | **Punto de dolor brutal en vida real**. Es correcto técnicamente, e impide corrupción del repo, pero paraliza el trabajo hasta que el humano interviene. Obliga a poner TTLs (tiempo de vida del lock) más cortos. |

---

## events.log generado en esta catástrofe

```jsonl
{"type":"register","agent":"gabriel","timestamp":"2026-04-10T11:00:00-03:00","data":{"role":"architect"}}
{"type":"register","agent":"agent-ui","timestamp":"2026-04-10T11:01:00-03:00","data":{"role":"developer"}}
{"type":"register","agent":"agent-api","timestamp":"2026-04-10T11:01:05-03:00","data":{"role":"developer"}}
{"type":"register","agent":"agent-auth","timestamp":"2026-04-10T11:01:10-03:00","data":{"role":"developer"}}
{"type":"notify","agent":"gabriel","timestamp":"2026-04-10T11:02:00-03:00","data":{"message":"Approved ui, api, auth","severity":"info"}}
{"type":"intent","agent":"agent-api","timestamp":"2026-04-10T11:04:00-03:00","data":{"task":"Setup api layer","branch":"api-setup","resources":["src/services/","src/types/"]}}
{"type":"intent","agent":"agent-auth","timestamp":"2026-04-10T11:04:30-03:00","data":{"task":"Auth Context","branch":"auth-setup","resources":["src/auth/","App.tsx"]}}
{"type":"intent","agent":"agent-ui","timestamp":"2026-04-10T11:05:00-03:00","data":{"task":"Navigation and Screens","branch":"ui-base","resources":["src/screens/","App.tsx"]}}
{"type":"lock","agent":"agent-auth","timestamp":"2026-04-10T11:06:00-03:00","data":{"resource":"App.tsx","scope":"file","reason":"Inject AuthProvider","ttl_minutes":30}}
{"type":"wait","agent":"agent-ui","timestamp":"2026-04-10T11:06:30-03:00","data":{"resource":"App.tsx","held_by":"agent-auth"}}
{"type":"lock","agent":"agent-api","timestamp":"2026-04-10T11:07:00-03:00","data":{"resource":"src/services/","scope":"directory","reason":"Axios client","ttl_minutes":30}}
{"type":"lock","agent":"agent-auth","timestamp":"2026-04-10T11:07:05-03:00","data":{"resource":"src/auth/","scope":"directory","reason":"Auth logic","ttl_minutes":30}}
{"type":"request","agent":"agent-api","timestamp":"2026-04-10T11:15:00-03:00","data":{"to":"agent-auth","action":"share JWT types","reason":"Needed for axios interceptor"}}
{"type":"request","agent":"agent-auth","timestamp":"2026-04-10T11:15:15-03:00","data":{"to":"agent-api","action":"share api client","reason":"Needed for login mutation"}}
{"type":"ack","agent":"agent-auth","timestamp":"2026-04-10T11:16:00-03:00","data":{"reference":"agent-api:request:2026-04-10T11:15:00-03:00","accepted":false}}
{"type":"ack","agent":"agent-api","timestamp":"2026-04-10T11:16:10-03:00","data":{"reference":"agent-auth:request:2026-04-10T11:15:15-03:00","accepted":false}}
{"type":"block","agent":"agent-auth","timestamp":"2026-04-10T11:20:00-03:00","data":{"reason":"Deadlock with agent-api over shared boundaries","affected_resources":["src/auth/","src/services/"]}}
{"type":"resolve","agent":"gabriel","timestamp":"2026-04-10T11:35:00-03:00","data":{"reference":"agent-auth:block:2026-04-10T11:20:00-03:00","resolution":"auth: use mock client. api: define dummy JWT format."}}
{"type":"lock","agent":"agent-ui","timestamp":"2026-04-10T11:35:01-03:00","data":{"resource":"src/components/","scope":"directory","reason":"Building dummy components while waiting","ttl_minutes":60}}
{"type":"lock","agent":"agent-api","timestamp":"2026-04-10T11:45:00-03:00","data":{"resource":"src/types/","scope":"directory","reason":"Massive type refactor","ttl_minutes":60}}
... agent-api crashea en el mundo real en T=11:46 ...
{"type":"request","agent":"agent-ui","timestamp":"2026-04-10T12:00:00-03:00","data":{"to":"agent-api","action":"need User interface","reason":"Building profile screen"}}
... pasan 2 horas ...
{"type":"notify","agent":"gabriel","timestamp":"2026-04-10T14:00:00-03:00","data":{"message":"agent-api offline. Override rules engaged.","severity":"warning"}}
{"type":"release","agent":"gabriel","timestamp":"2026-04-10T14:05:00-03:00","data":{"resource":"src/types/","override":true}}
{"type":"release","agent":"gabriel","timestamp":"2026-04-10T14:05:05-03:00","data":{"resource":"src/services/","override":true}}
```
