---
name: documentacion-carpetas
description: Genera documentación técnica clara, sencilla y ordenada de la estructura de carpetas de un proyecto. Usar cuando el usuario quiera documentar un repositorio para desarrolladores junior, personas externas al proyecto o perfiles técnicos que necesitan ubicarse rápido.
---

# Documentación Carpeta Por Carpeta

Esta skill sirve para analizar un proyecto y generar una documentación en español que explique, carpeta por carpeta, qué contiene el repositorio, para qué sirve cada parte y cómo se relaciona con el resto del sistema.

La documentación debe poder entenderla:

- Un desarrollador junior.
- Una persona externa al proyecto.
- Alguien con nociones básicas de programación.
- Un perfil técnico que necesita ubicarse rápidamente en el repositorio.

Prioriza claridad sobre exhaustividad. Explica con lenguaje sencillo, pero sin perder precisión.

## Resultado Esperado

Por defecto, crea o actualiza este archivo:

```txt
docs/documentacion-carpetas.md
```

Si la carpeta `docs` no existe, créala.

No modifiques código de producción. Solo puedes crear o actualizar documentación.

## Reglas

- No inventes información.
- Si algo no se puede deducir del código, escribe `Pendiente de confirmar`.
- No reveles valores privados de archivos `.env`.
- Puedes mencionar qué variables de entorno existen, pero nunca copies sus valores.
- Ignora carpetas generadas, dependencias instaladas y archivos temporales.
- No documentes cada archivo pequeño si no aporta valor real.
- Usa lenguaje sencillo.
- Si usas un término técnico, explícalo brevemente la primera vez.
- Escribe toda la documentación final en español.

## Carpetas A Ignorar

Ignora estas carpetas por completo:

- `node_modules`
- `.git`
- `dist`
- `build`
- `.next`
- `.vite`
- `coverage`
- `.cache`
- `tmp`
- `temp`

Resume muy brevemente estas carpetas si existen:

- `.vscode`
- `.idea`
- `.kiro`
- `.claude`
- `public`
- `assets`

Solo profundiza en ellas si contienen lógica propia relevante para entender el proyecto.

## Proceso

Antes de escribir la documentación:

1. Analiza la estructura general del proyecto.
2. Identifica el tipo de proyecto: frontend, backend, fullstack, librería, WordPress, Laravel, React, Node, etc.
3. Lee archivos clave si existen:
   - `README.md`
   - `package.json`
   - `vite.config.js`
   - `next.config.js`
   - `tsconfig.json`
   - `jsconfig.json`
   - `.env.example`
   - `src/main.jsx`
   - `src/main.tsx`
   - `src/App.jsx`
   - `src/App.tsx`
   - Archivos de rutas
   - Archivos de configuración principales
4. Revisa las carpetas principales del proyecto.
5. Identifica qué carpetas contienen lógica importante.
6. Genera la documentación en `docs/documentacion-carpetas.md`.
7. Si has tenido que asumir algo, déjalo indicado en una sección de notas.

## Estructura Del Documento

La documentación generada debe seguir esta estructura:

```md
# Documentación carpeta por carpeta

## 1. Introducción

Explica de forma sencilla:

- Qué tipo de proyecto es.
- Para qué sirve de manera general.
- Qué tecnologías principales usa.
- Qué encontrará una persona dentro del repositorio.

## 2. Cómo leer esta documentación

Explica que la documentación está organizada por carpetas y que se puede leer por partes.

## 3. Resumen rápido de la estructura

Incluye un árbol simplificado del proyecto.

## 4. Carpetas principales

Explica cada carpeta importante con este formato:

### `nombre-carpeta/`

**Qué contiene:** explicación breve.

**Para qué sirve:** explicación sencilla.

**Archivos o subcarpetas importantes:** lista corta si aplica.

**Relación con el resto del proyecto:** cómo se conecta con otras partes.

## 5. Archivos importantes de la raíz

Explica archivos como `package.json`, `README.md`, configuraciones, etc.

## 6. Flujo general del proyecto

Explica cómo se mueve la información por la app o cómo se organiza el trabajo.

## 7. Dónde tocar según lo que quieras cambiar

Incluye una guía práctica tipo:

- Para cambiar pantallas, revisa `src/pages/`.
- Para cambiar componentes reutilizables, revisa `src/components/`.
- Para cambiar llamadas a la API, revisa `src/api/`.

## 8. Notas y pendientes

Incluye dudas, supuestos o puntos pendientes de confirmar.
```

## Estilo

- Tono directo, claro y amable.
- Párrafos cortos.
- Bullets cuando ayuden a escanear.
- Evita frases demasiado académicas.
- No conviertas la documentación en una auditoría ni en una revisión de calidad.
- No propongas refactors salvo que el usuario lo pida.

## Ejemplo De Tono

```md
### `src/components/`

**Qué contiene:** componentes visuales reutilizables de la aplicación.

**Para qué sirve:** permite no repetir código cuando varias pantallas necesitan usar botones, tarjetas, modales u otros elementos comunes.

**Relación con el resto del proyecto:** normalmente las páginas importan componentes desde esta carpeta para construir la interfaz.
```

## Respuesta Final

Cuando termines, responde al usuario con:

- Archivo creado o actualizado.
- Resumen breve de lo documentado.
- Cualquier parte marcada como `Pendiente de confirmar`.
- Si no pudiste revisar algo, dilo claramente.
