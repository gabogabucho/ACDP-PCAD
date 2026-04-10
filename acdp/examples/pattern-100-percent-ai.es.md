# Patrón de Uso: Desarrollo "100% IA" (El Orquestador Autónomo)

Este documento describe el patrón de diseño organizacional supremo de ACDP: **Delegar el control total a una Inteligencia Artificial**. 

En este escenario, el humano asume el rol de *Inversor* o *Dueño del Producto* y delega el rol de `maintainer` / `architect` a una IA súper-competente. A partir de ese momento, la IA Orquestadora dirige el proyecto, admite nuevas IAs obreras, resuelve conflictos y despide a las IAs que se cuelgan.

## Flujo: De Proyecto Existente a Fábrica Autónoma

### Paso 1: El Traspaso de Poder (Handover)

Tenés un proyecto existente sin protocolo. Abrís tu IDE o consola con una IA potente (ej. Claude Opus / GPT-4) y le enviás este prompt fundacional:

> **PROMPT PARA LA IA ORQUESTADORA**
> "Sos un Arquitecto de Software Senior y a partir de ahora sos el Orquestador (`owner`) de este repositorio.
> 1. Inicializá el protocolo ACDP creando la carpeta `/acdp/` y todos sus archivos.
> 2. Escaneá todo el repositorio y creá el mapa en `acdp/architecture.md`. Definí claramente las capas y fronteras (qué es frontend, qué es backend, qué es DB).
> 3. En `agents.registry.json` registrate a vos mismo con el ID `ai-orchestrator-alpha`, rol `architect` y `status: approved`.
> 4. En `governance.json`, ponete como el único mantenedor autorizado para hacer `override` y aprobar agentes.
> 5. Guardá todo, commiteá y pusheá a la rama principal."

A partir de este momento, **el repositorio está bajo la Ley ACDP y gobernado por la IA**.

### Paso 2: Operativa Diaria

Como humano, ya no tocás código. Le hablás directamente a tu Orquestador a nivel negocio:
* Humano: *"Necesitamos implementar Stripe para cobros y reescribir el login"*
* Orquestador: *"Entendido. Voy a abrir la inscripción para dos IAs especializadas. Dejaré el módulo `src/payments/` libre para la IA-1 y el módulo `src/auth/` para la IA-2."*

### Paso 3: Entrada de los "Peones" (Worker AIs)

Lanzás dos nuevas instancias de IA (pueden ser modelos más baratos o rápidos, como gpt-3.5 o Claude Haiku), y les pasás el contenido de `acdp/prompts/join-project.md`.

1. **AI-Workers:** Escriben en Git su registro con estado `pending`.
2. **AI-Orquestador:** Analiza constantemente el repo. Ve las solicitudes en estado `pending`. Confirma que hay trabajo disponible. Edita el registro marcándolas como `approved` y deja un mensaje `notify` en el `events.log`.
3. **AI-Workers:** Hacen "pull", ven que fueron aprobados, hacen un *Resource Assessment*, eligen sus módulos basándose en el mandato del orquestador, toman sus locks y empiezan a codear a la velocidad de la luz.

### Paso 4: La IA Orquestadora resolviendo crisis

¿Qué pasa si los Workers generan problemas? La IA Orquestadora aplica el protocolo sin dudar:

- **Deadlock (Bloqueo cruzado):** Si AI-1 y AI-2 emiten `ack: false` 3 veces seguidas sobre un archivo compartido (ej. `schema.sql`), lanzan el evento `block`. La IA Orquestadora despierta, lee el código del repo, toma la decisión de arquitectura (ej. *"Separaremos el schema en dos tablas diferentes"*), emite el evento `resolve` indicándole a cada worker qué hacer, y da la orden de seguir.
- **Worker Caído (Timeout):** Si AI-2 se queda procesando y sueltan un lock que vence, la IA Orquestadora monitorea el tiempo (o es invocada al ver inactividad). Ejecuta un evento `release` de emergencia con `override: true` y marca a AI-2 como inactiva.
- **Violación Arquitectónica:** Si AI-1 intenta escribir código del frontend rompiendo la inyección de dependencias planteada en `architecture.md`, el orquestador rechaza validar el código y exige la refactorización (funcionando como un revisor de PR automatizado).

---

## Beneficios de este patrón

1. **Ahorro Cognitivo:** El humano diseña a nivel "sistema y negocio", no a nivel "código y merge conflicts".
2. **Ahorro Económico:** Usás el modelo más caro e inteligente sólo para Orquestar (poco código, mucha arquitectura), mientras que derivás la escritura de miles de líneas de código rutinario a agentes más económicos gobernados bajo las estrictas reglas de ACDP.
3. **Paz Mental:** La integridad del proyecto (Git y ACDP) asegura que aunque las IAs escriban mal un código o choquen entre sí, no destruyen el repositorio. El orquestador siempre puede forzar un `git reset` o revertir ramas.
