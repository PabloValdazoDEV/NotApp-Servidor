# Plantilla para crear un backend similar a NotApp

Este archivo sirve como **prompt maestro** para crear nuevos proyectos backend con una estructura parecida a NotApp:

- Node.js
- Express
- Prisma
- PostgreSQL
- JWT
- Cloudinary opcional
- Nodemailer opcional
- Socket.IO opcional
- Documentación lista para GitHub

La idea es que puedas abrir un proyecto vacío, pasarle este prompt a Codex y construir el backend paso a paso con una base ordenada.

---

## 1. Prompt maestro para Codex

Copia y pega este prompt cuando quieras crear un proyecto nuevo:

```text
Quiero crear un backend profesional con una estructura similar a NotApp.

Objetivo del proyecto:
[Describe aquí en 2-4 líneas qué hace la aplicación. Ejemplo: una app para gestionar reservas, tareas, finanzas personales, inventario, comunidad, etc.]

Quiero usar:
- Node.js
- Express
- Prisma
- PostgreSQL
- JWT para autenticación
- bcrypt para contraseñas
- dotenv para variables de entorno
- CORS configurable
- Arquitectura por rutas/carpetas
- README claro para GitHub/portfolio
- .env.example sin secretos

Opcional si encaja con el proyecto:
- Socket.IO para tiempo real
- Cloudinary para imágenes
- Multer para subida de archivos
- Nodemailer para emails transaccionales
- Onboarding/tutorial si tiene sentido

Requisitos importantes:
- No guardar secretos reales en el repositorio.
- Crear `.env.example`, pero nunca crear `.env` con valores reales.
- Crear `.gitignore` correcto.
- Crear `README.md` claro, breve y orientado a portfolio.
- Crear documentación de carpetas en `docs/documentacion-carpetas.md`.
- Mantener el código simple, entendible y escalable.
- Usar nombres de carpetas y archivos consistentes.
- Validar permisos en endpoints privados.
- Usar respuestas JSON consistentes.
- Añadir manejo de errores básico.

Estructura deseada:

.
├── app.js
├── package.json
├── .env.example
├── .gitignore
├── README.md
├── config/
├── middleware/
├── prisma/
├── router/
├── public/
├── uploads/
└── docs/

Quiero que me guíes paso a paso:

1. Primero crea la estructura base del proyecto.
2. Después configura Express, CORS y dotenv.
3. Después configura Prisma y el schema inicial.
4. Después crea autenticación con registro, login y `GET /me`.
5. Después crea rutas de ejemplo para el dominio principal de la app.
6. Después añade middlewares de seguridad y permisos.
7. Después añade servicios opcionales si hacen falta.
8. Después crea README y documentación.
9. Al final, dime comandos para instalar, configurar base de datos y arrancar.

Antes de escribir mucho código, proponme el modelo de datos inicial y la estructura de rutas.

No inventes credenciales ni datos privados. Si falta información, marca `Pendiente de confirmar`.
```

---

## 2. Cómo iniciar un proyecto nuevo conmigo

### Paso 1. Crea una carpeta vacía

```bash
mkdir MiProyecto-Servidor
cd MiProyecto-Servidor
```

### Paso 2. Abre la carpeta en tu editor

```bash
code .
```

O abre la carpeta manualmente desde tu IDE.

### Paso 3. Inicia una conversación con Codex

Dime algo como:

```text
Quiero crear un backend nuevo desde cero. Usa este archivo/prompt como guía.
```

Después pega el **Prompt maestro** de la sección anterior.

### Paso 4. Define el proyecto

Antes de generar código, responde estas preguntas:

```text
Nombre del proyecto:
Dominio principal:
Qué problema resuelve:
Tipos de usuarios:
Entidades principales:
Necesita imágenes: sí/no
Necesita emails: sí/no
Necesita tiempo real: sí/no
URL pública de portfolio:
```

Ejemplo:

```text
Nombre del proyecto: ReservaFácil
Dominio principal: reservas
Qué problema resuelve: gestionar reservas de pistas deportivas
Tipos de usuarios: clientes y administradores
Entidades principales: usuarios, centros, pistas, reservas, pagos
Necesita imágenes: sí
Necesita emails: sí
Necesita tiempo real: no
URL pública de portfolio: https://reservafacil.pablovaldazo.es
```

### Paso 5. Pídeme un plan corto

Usa este mensaje:

```text
Antes de implementar, dame un plan corto con estructura de carpetas, modelos Prisma y rutas principales.
```

Así revisamos la base antes de escribir código.

### Paso 6. Implementamos por bloques

El orden recomendado es:

1. Base de Express.
2. Prisma y conexión a PostgreSQL.
3. Auth.
4. Dominio principal.
5. Permisos.
6. Servicios externos.
7. Documentación.
8. Revisión final.

---

## 3. Estructura recomendada

```txt
.
├── app.js
├── package.json
├── .env.example
├── .gitignore
├── README.md
├── config/
│   ├── corsConfig.js
│   ├── nodemailer.js
│   └── cloudinaryUpload.js
├── middleware/
│   └── auth.middleware.js
├── prisma/
│   ├── prisma.js
│   └── schema.prisma
├── router/
│   ├── index.js
│   ├── auth.js
│   ├── profile.js
│   └── [modulos-del-proyecto].js
├── public/
│   └── email/
├── uploads/
└── docs/
    └── documentacion-carpetas.md
```

---

## 4. Archivos base que debería tener el proyecto

### `.gitignore`

```gitignore
node_modules
.env
uploads
dist
build
coverage
*.log
.DS_Store
```

### `.env.example`

```env
PORT=3000
DATABASE_URL=
JWT_SECRET=
VITE_API_URL=
VITE_API_KEY=

SMTP_HOST=
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASS=
MAIL_FROM=

NAME_CLOUDINARY=
API_KEY_CLOUDINARY=
API_SECRET_CLOUDINARY=
```

### `package.json` scripts recomendados

```json
{
  "scripts": {
    "dev": "nodemon app.js",
    "db": "npx prisma db push",
    "generate": "npx prisma generate",
    "deploy": "npm install && npx prisma generate",
    "test": "echo \"No tests configured yet\" && exit 0"
  }
}
```

---

## 5. Checklist de calidad

Antes de subir a GitHub, revisar:

- [ ] `.env` está en `.gitignore`.
- [ ] Existe `.env.example`.
- [ ] No hay claves reales en el README.
- [ ] `README.md` explica el proyecto sin abrumar.
- [ ] `docs/documentacion-carpetas.md` existe.
- [ ] `npm install` funciona.
- [ ] `npx prisma validate` funciona.
- [ ] `npx prisma generate` funciona.
- [ ] `node --check app.js` funciona.
- [ ] Las rutas privadas usan middleware de auth.
- [ ] Los permisos importantes están validados.
- [ ] Los errores devuelven JSON entendible.
- [ ] La URL pública del portfolio está actualizada.

---

## 6. Prompt para generar el README del proyecto nuevo

Cuando el proyecto ya tenga código, puedes pedir:

```text
Hazme un README profesional para GitHub y portfolio.

Quiero que:
- Explique qué hace el proyecto.
- Indique la URL pública: [URL].
- Liste tecnologías.
- Resuma funcionalidades principales.
- Explique arquitectura sin abrumar.
- Incluya instalación local.
- Incluya variables de entorno sin valores reales.
- Incluya endpoints principales.
- Indique estado del proyecto y próximos pasos.

No reveles secretos ni valores de `.env`.
Escribe en español claro y con tono profesional.
```

---

## 7. Prompt para documentar carpetas

```text
Genera documentación carpeta por carpeta en `docs/documentacion-carpetas.md`.

Quiero que explique:
- Qué contiene cada carpeta.
- Para qué sirve.
- Archivos importantes.
- Cómo se relaciona con el resto del proyecto.
- Dónde tocar según lo que quiera cambiar.

Ignora:
- node_modules
- .git
- uploads
- dist
- build
- coverage

No reveles valores de `.env`.
```

---

## 8. Prompt para revisión final antes de GitHub

```text
Revisa el proyecto antes de subirlo a GitHub.

Comprueba:
- Que no haya secretos.
- Que `.env` esté ignorado.
- Que exista `.env.example`.
- Que el README sea claro para portfolio.
- Que la documentación sea correcta.
- Que los comandos básicos funcionen.
- Que no haya archivos temporales innecesarios.

No hagas cambios destructivos.
Si ves algo peligroso, avísame antes.
```

---

## 9. Cómo trabajar conmigo usando este archivo

Cuando quieras iniciar otro backend, dime:

```text
Vamos a crear un backend nuevo usando `docs/plantilla-crear-backend-similar.md`.
El proyecto se llama [nombre] y sirve para [descripción].
Primero dame el plan, modelos y rutas. Luego implementamos.
```

Y a partir de ahí podemos construirlo por fases.

Mi recomendación: no intentes generar todo el proyecto enorme de una sola vez. Mejor hacerlo en bloques pequeños, comprobar que funciona y seguir.
