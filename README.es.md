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
  events.log             # Log JSON estructurado de mensajes
  locks.json             # Locks activos sobre recursos
  governance.json        # Reglas de autoridad y override
  agents.registry.json   # Definición de agentes confiables
  messages.schema.json   # JSON Schema para validación de mensajes
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
                │   │  state.md                │◄──────────┐
                │   │  agents.md               │◄───────┐  │
                │   │  locks.json              │◄────┐  │  │
                │   │  events.log (JSON)       │◄──┐ │  │  │
                │   │  governance.json         │   │ │  │  │
                │   │  agents.registry.json    │   │ │  │  │
                │   │                          │   │ │  │  │
                │   └──────────────────────────┘   │ │  │  │
                │                                  │ │  │  │
                └──────────────────────────────────┘ │ │  │  │
                                                     │ │  │  │
        ┌──────────────┐       ┌──────────────┐      │ │  │  │
        │  Agente 01   │       │  Agente 02   │      │ │  │  │
        │ (IA / humano)│       │ (IA / humano)│      │ │  │  │
        └──────┬───────┘       └──────┬───────┘      │ │  │  │
               │                      │              │ │  │  │
               │  lee estado          │              │ │  │  │
               ├──────────────────────┼──────────────┘ │  │  │
               │                      │                │  │  │
               │  declara intención   │                │  │  │
               ├──────────────────────┼────────────────┘  │  │
               │                      │                   │  │
               │  toma lock           │                   │  │
               ├──────────────────────┼───────────────────┘  │
               │                      │                      │
               │  modifica código     │                      │
               ├──────────────────────┤                      │
               │                      │                      │
               │  libera lock         │                      │
               ├──────────────────────┼──────────────────────┘
               │                      │
               │  actualiza estado    │
               └──────────────────────┘
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
