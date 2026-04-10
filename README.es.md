# ACDP — Protocolo de Coordinación Agéntica para Desarrollo

🌐 **[Read in English](README.md)**

## Descripción

ACDP (Protocolo de Coordinación Agéntica para Desarrollo) es un estándar abierto que define cómo múltiples agentes (IAs y humanos) pueden colaborar sobre un mismo repositorio de código sin generar conflictos, manteniendo coherencia y trazabilidad en entornos de desarrollo dinámicos.

ACDP introduce una capa de coordinación sobre sistemas de control de versiones tradicionales, permitiendo trabajo paralelo estructurado en contextos de alta iteración.

---

## Problema

El desarrollo asistido por IA (vibecoding) introduce nuevas dinámicas:

* Múltiples agentes generan cambios simultáneamente
* Los cambios son amplios y poco incrementales
* El historial pierde valor como fuente de verdad
* Aumentan los conflictos de integración
* No existe un protocolo común de coordinación entre agentes

Los sistemas actuales están diseñados para colaboración humana incremental, no para coordinación multiagente.

---

## Objetivo

Definir un protocolo que permita:

* Coordinación entre agentes sin autoridad central obligatoria
* Trabajo concurrente sin conflictos destructivos
* Comunicación estructurada entre agentes
* Persistencia del estado compartido
* Trazabilidad de decisiones y acciones

---

## Enfoque

ACDP opera como una capa lógica dentro del repositorio. No reemplaza el sistema de control de versiones, sino que lo complementa.

Se basa en:

* Estado compartido dentro del repositorio
* Reglas de comportamiento explícitas
* Coordinación mediante archivos estructurados
* Consenso distribuido entre agentes

---

## Componentes principales

### Identidad de agentes

Cada agente se registra y opera bajo una identidad definida, verificada mediante una clave pública en el registro de agentes.

### Declaración de intención

Antes de modificar el sistema, un agente declara su intención — qué va a hacer, qué recursos va a tocar y en qué rama.

### Locks de recursos

Se evita la modificación concurrente de los mismos recursos mediante locks lógicos con expiración automática (TTL).

### Estado compartido

El sistema mantiene una representación legible del estado actual del proyecto.

### Registro de eventos

Las acciones relevantes se registran en un log secuencial de solo lectura (append-only).

### Límites de arquitectura

Los módulos, sus dueños, áreas restringidas y reglas de coordinación entre módulos se definen explícitamente.

### Comunicación entre agentes

Toda la coordinación entre agentes ocurre mediante mensajes JSON estructurados que se agregan a `events.log`. El protocolo define 12 tipos de mensaje (`register`, `intent`, `lock`, `release`, `update`, `complete`, `wait`, `block`, `resolve`, `notify`, `request`, `ack`) con un schema formal para validación.

### Gobernanza

Se definen reglas sobre quién puede participar, cómo se toman decisiones y quién puede sobreescribir locks.

---

## Arquitectura

ACDP se implementa dentro del repositorio mediante una estructura estándar:

```
/acdp/
  protocol.md            # Reglas de coordinación
  architecture.md        # Mapa de módulos y ownership
  state.md               # Snapshot del estado actual
  agents.md              # Registro de agentes activos
  events.log             # Log JSONL ({ type, agent, timestamp, data })
  locks.json             # Store canónico de locks ({ "locks": [...] })
  governance.json        # Reglas de autoridad y override
  agents.registry.json   # Definición de agentes confiables
  messages.schema.json   # JSON Schema para validación de mensajes
  cli.js                 # Entrada CLI protocol-safe
  lock-manager.js        # Gestor de locks con ciclo de vida TTL
  export-logs.js         # Exportador gzip para snapshots de events.log
  log-exports/           # Archivos exportados (ignorados por Git)
  prompts/
    init-project.md      # Prompt para iniciar un proyecto con ACDP
    join-project.md      # Prompt para que un agente se una al proyecto
  examples/
    simulation-php.md    # Simulación completa con 3 agentes
    simulation-stress-test.md
    pattern-100-percent-ai.md
    pattern-100-percent-ai.es.md
/scripts/
  git-hooks/
    pre-commit           # Guard protocolar versionado (activación manual)
```

---

## Guía visual de funcionamiento

```
                ┌──────────────────────────────────┐
                │           Repositorio            │
                │                                  │
                │   Código del proyecto            │
                │   (/src, /api, etc.)             │
                │                                  │
                │   ┌──────────────────────────┐   │
                │   │         /acdp/           │   │
                │   │                          │   │
                │   │  protocol.md             │   │
                │   │  architecture.md         │   │
                │   │  messages.schema.json    │   │
                │   │  cli.js                  │◄─────────┐
                │   │  lock-manager.js         │◄──────┐  │
                │   │  state.md                │◄────┐ │  │
                │   │  agents.md               │◄──┐ │ │  │
                │   │  locks.json              │◄┐ │ │ │  │
                │   │  events.log (JSONL)      │◄┼─┘ │ │  │
                │   │  export-logs.js          │  │   │ │  │
                │   └──────────────────────────┘  │   │ │  │
                │   /scripts/git-hooks/pre-commit│◄──┘ │  │
                └──────────────────────────────────┴────┴──┘
                                                     ▲
        ┌──────────────┐       ┌──────────────┐      │
        │  Agente 01   │       │  Agente 02   │      │
        │ (IA / humano)│       │ (IA / humano)│      │
        └──────┬───────┘       └──────┬───────┘      │
               │                      │              │
               ├──── lee estado ──────┼──────────────┤
               ├── declara intención ─┼──────────────┤
               ├── toma/renueva lock ─┼──────────────┤
               ├──── cleanup/watch ───┼──────────────┤
               ├── libera/completa ───┼──────────────┤
               └──── exporta logs ────┴──────────────┘
```

---

## Flujo de trabajo

1. Un agente accede al repositorio
2. Lee el estado en `/acdp/`
3. Se registra como agente activo
4. Declara su intención
5. Verifica disponibilidad de recursos
6. Toma un lock lógico
7. Realiza cambios en una rama propia
8. Registra eventos relevantes
9. Libera el lock
10. Actualiza el estado

---

## Modelo de acceso

ACDP no gestiona el acceso al repositorio.

El acceso se controla mediante el sistema de control de versiones.

ACDP define:

* Qué agentes son reconocidos
* Cómo deben comportarse
* Cómo se validan sus acciones

Los agentes no reconocidos pueden ser ignorados por el sistema.

---

## Filosofía

* Simplicidad sobre complejidad
* Coordinación sobre control
* Estado compartido sobre sincronización implícita
* Consenso distribuido sobre autoridad central
* Observabilidad para humanos

---

## 🛠️ Automatización CLI (ACDP CLI)

Para evitar el consumo masivo de "tokens" en la IA y prevenir errores de sintaxis al alterar JSONs a mano, ACDP incluye una utilidad CLI nativa (`acdp/cli.js`).

**Las operaciones de lock deben pasar por la CLI.** No edites `acdp/locks.json` a mano ni agregues JSON ad-hoc a `acdp/events.log` para el ciclo de vida normal de locks.

La CLI se apoya en `acdp/lock-manager.js`, que implementa un ciclo de vida de locks con TTL: adquisición, renovación por el mismo agente, cleanup de locks expirados, detección de conflictos entre scopes `file`/`directory` y persistencia canónica en `acdp/locks.json`.

Los agentes pueden ejecutar operaciones protocol-safe como estas:
- `node acdp/cli.js lock "src/app.js" file "Implementando feature" 30`
- `node acdp/cli.js release "src/app.js" "Feature completado"`
- `node acdp/cli.js status`
- `node acdp/cli.js cleanup` (Elimina locks expirados y emite eventos `release` schema-compliant con `data.expired: true`.)
- `node acdp/cli.js batch "refresh-cache" "src/cache/data.json" 5 file` (Para flujos breves de intent → lock → release.)
- `node acdp/cli.js finish` (Declara globalmente el proyecto como terminado.)
- `node acdp/cli.js watch` (Lanza un radar de terminal en tiempo real y muestra contexto TTL de locks cuando corresponde.)
- `node acdp/export-logs.js` (Exporta `events.log` a un archivo gzip dentro de `acdp/log-exports/`, ignorado por Git.)

La CLI mantiene los artefactos del protocolo alineados con el formato documentado:
- `acdp/locks.json` usa la forma canónica `{ "locks": [...] }`
- las entradas de `acdp/events.log` usan registros JSONL `{ type, agent, timestamp, data }` compatibles con `acdp/messages.schema.json`
- `cleanup`, `batch` y los flujos normales de `release`/`complete` emiten eventos canónicos, no payloads legacy
- `watch` solo observa el stream JSONL en vivo; `export-logs` lo snapshottea para auditoría o archivo

### Endurecimiento remote-first

ACDP ahora soporta una fase inicial de coordinación remote-first sobre Git.

- Si existe `origin/acdp/state`, esa rama pasa a ser la rama autoritativa de coordinación.
- Las mutaciones remotas deben cumplir sync-before-mutate: primero fetch/lectura del último head de coordinación y recién después publicación desde esa revisión exacta.
- El ciclo de vida remoto de locks ahora puede llevar `lock_id` y `base_coord_rev`, preservando al mismo tiempo el formato JSONL existente de los eventos.
- Si `origin/acdp/state` no existe, la CLI vuelve al comportamiento local/legacy actual.

Comandos útiles:

- `node acdp/cli.js sync` — obtiene y reporta el head actual de coordinación remota cuando existe.
- `node acdp/cli.js status --remote` — muestra disponibilidad de coordinación remota, revisión actual, salud del remoto autoritativo, divergencia esperada de feature branches, señales de snapshot de coordinación stale y diferencias locales contra la rama autoritativa.
- `node acdp/cli.js status --remote --json` — la misma información en formato machine-readable.
- `node acdp/cli.js lock-remote "src/file.js" file "Implementar feature" 30` — adquiere o renueva un lock en `origin/acdp/state`, con retry acotado ante carreras por cambio de head remoto.
- `node acdp/cli.js release-remote "src/file.js" "Feature completo"` — libera un lock remoto y agrega eventos de ciclo de vida compatibles en la rama de coordinación.
- `node acdp/cli.js renew "src/file.js" 45` — renueva de forma explícita un lock existente por recurso o por `lock_id`; en modo remoto preserva `lock_id` y actualiza `base_coord_rev`.
- `node acdp/cli.js cleanup-remote` — elimina de forma segura solo los locks que siguen expirados sobre la última base remota y emite eventos `release` compatibles con `expired: true`.
- `node acdp/cli.js heartbeat "sigo trabajando"` — agrega un `update` liviano y schema-compatible como señal de vida, usando la rama remota cuando existe.
- `node acdp/cli.js doctor --json` — informa readiness remota, salud de la rama actual, sanidad de archivos del protocolo, errores de parseo del remoto autoritativo y locks del agente actual. Devuelve exit code distinto de cero cuando falla la salud.

Notas de observabilidad remota:

- `local_stale` se mantiene en la salida JSON como alias backward-compatible de `local_protocol_differs_from_remote`.
- La divergencia esperada entre una feature branch y `acdp/state` ahora se reporta separada de un snapshot de coordinación realmente stale.
- Si `locks.json` o `events.log` autoritativos en `origin/acdp/state` están malformados, los comandos de observabilidad lo informan explícitamente y la salud falla en lugar de tratarlos silenciosamente como vacíos.

El flujo endurecido mantiene intencionalmente `locks.json` y `events.log` como archivos canónicos de coordinación; el cambio está en *dónde* se publican y *cómo* la tooling prueba frescura.

La guía operativa/migración está en [`docs/remote-operations.md`](docs/remote-operations.md).
Las notas prácticas de pruebas remotas y la interpretación de señales están en [`docs/remote-simulation-notes.md`](docs/remote-simulation-notes.md).

**Definición de DONE (Criterio de Salida):**
Cuando el archivo `state.md` del proyecto indique `Status: DONE` (lo cual se fuerza de manera nativa corriendo `node acdp/cli.js finish`), todos los agentes participantes DEBEN cesar sus operaciones de inmediato, cancelar sus bucles internos de búsqueda de tareas y cerrar sesión formalmente. No se admiten tareas automatizadas adicionales.

---

## 🔒 Guard de commits versionado

ACDP incluye un guard pre-commit versionado en `scripts/git-hooks/pre-commit`.

Qué valida:
- bloquea commits cuando `acdp/locks.json` todavía contiene locks activos
- exige que `acdp/locks.json` conserve la forma canónica `{ "locks": [...] }`
- exige que `acdp/events.log` siga siendo JSONL válido y use `agent/data`, no `agent_id/payload`
- verifica que los tipos de evento sigan alineados con `acdp/messages.schema.json`

Instalación sugerida:

```bash
git config core.hooksPath scripts/git-hooks
```

Este hook **no se habilita automáticamente**. Habilitalo manualmente apuntando `core.hooksPath` a `scripts/git-hooks` o copiando `scripts/git-hooks/pre-commit` a `.git/hooks/pre-commit`. En sistemas tipo Unix, asegurate de que sea ejecutable.

---

## Inicio rápido: Prompts para IA

ACDP incluye prompts listos para copiar y pegar en cualquier agente de IA (Claude, GPT, Gemini, etc.).

### Iniciar un proyecto nuevo

Usá [`acdp/prompts/init-project.md`](acdp/prompts/init-project.md) — le da a la IA las instrucciones para inicializar la estructura ACDP, registrarse como primer agente, definir la arquitectura y comenzar a trabajar.

### Sumar un agente a un proyecto existente

Usá [`acdp/prompts/join-project.md`](acdp/prompts/join-project.md) — le da a la IA las instrucciones para leer el estado actual, registrarse, verificar locks activos, declarar intención y contribuir sin conflictos.

---

## Simulación

Ver [`acdp/examples/simulation-php.md`](acdp/examples/simulation-php.md) para un recorrido completo de 3 agentes (2 IAs + 1 humano) construyendo un sitio PHP, incluyendo:

* Trabajo paralelo sin conflictos
* Un conflicto de lock resuelto mediante mensajes request/ack/notify
* Un archivo de configuración compartido gestionado sin merge conflicts
* El `events.log` completo (23 mensajes)

Para escenarios remote-first más operativos — reconexiones, snapshots stale, carreras por el mismo recurso y cleanup bajo carrera con renewal — ver [`docs/remote-simulation-notes.md`](docs/remote-simulation-notes.md).

---

## Estado del proyecto

Versión: v0.1 (experimental)

ACDP está en etapa inicial y orientado a validación práctica en entornos reales.

---

## Contribuciones

Las contribuciones son bienvenidas.
El objetivo es iterar el protocolo a partir de su uso.

---

## Autor

Gabriel Urrutia
Twitter: [@gabogabucho](https://twitter.com/gabogabucho)
