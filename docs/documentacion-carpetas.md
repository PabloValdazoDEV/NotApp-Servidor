# Documentación carpeta por carpeta

## 1. Introducción

Este proyecto es el **backend de NotApp**, una aplicación para organizar compras compartidas por hogares.

Está construido con **Node.js**, **Express**, **Prisma**, **PostgreSQL** y **Socket.IO**. Su responsabilidad principal es ofrecer una API para que el frontend pueda gestionar usuarios, hogares, productos, listas, invitaciones, onboarding e imágenes.

Dentro del repositorio encontrarás:

- Rutas HTTP agrupadas por dominio funcional.
- Configuración de servicios externos como Cloudinary y SMTP.
- El modelo de base de datos con Prisma.
- Middleware de autenticación.
- Plantillas y assets para emails.

## 2. Cómo leer esta documentación

La documentación está organizada por carpetas. Puedes leerla de principio a fin o saltar directamente a la parte que necesites.

Si buscas entender el proyecto rápido, lee primero:

- `app.js`
- `router/`
- `prisma/schema.prisma`
- `config/`

Si buscas modificar una funcionalidad concreta, revisa la sección **Dónde tocar según lo que quieras cambiar**.

## 3. Resumen rápido de la estructura

```txt
.
├── app.js
├── package.json
├── config/
├── middleware/
├── prisma/
├── public/
├── router/
├── uploads/
└── docs/
```

Carpetas ignoradas en esta documentación:

- `node_modules/`
- `.git/`
- archivos temporales o generados

## 4. Carpetas principales

### `config/`

**Qué contiene:** configuración de servicios externos y utilidades compartidas.

**Para qué sirve:** centraliza piezas que se usan en varias rutas, como envío de emails, subida de imágenes, CORS y plantillas de email.

**Archivos importantes:**

- `corsConfig.js`: define qué orígenes pueden llamar a la API.
- `nodemailer.js`: configura el transporte SMTP para enviar emails.
- `cloudinaryUpload.js`: encapsula la subida de imágenes a Cloudinary.
- `emailTemplate.js`: genera el HTML de los emails transaccionales.

**Relación con el resto del proyecto:** las rutas importan estos módulos para enviar correos, subir imágenes o validar peticiones desde el frontend.

### `middleware/`

**Qué contiene:** middlewares de Express.

**Para qué sirve:** un middleware es una función que se ejecuta antes de llegar a una ruta. En este proyecto se usa para validar autenticación.

**Archivo importante:**

- `auth.middleware.js`: comprueba si llega un token JWT válido en `Authorization`. También permite una `x-api-key` configurada por entorno para casos internos.

**Relación con el resto del proyecto:** la mayoría de rutas privadas usan este middleware para saber qué usuario está haciendo la petición.

### `prisma/`

**Qué contiene:** conexión y schema de Prisma.

**Para qué sirve:** Prisma actúa como capa de acceso a base de datos. Permite consultar PostgreSQL usando modelos JavaScript en vez de escribir SQL manual en cada ruta.

**Archivos importantes:**

- `schema.prisma`: define los modelos de base de datos.
- `prisma.js`: crea y exporta una instancia de `PrismaClient`.

**Modelos principales:**

- `User`: usuarios registrados.
- `Home`: hogares reales o tutoriales.
- `Member`: relación entre usuario y hogar con rol.
- `Invitation`: invitaciones pendientes.
- `Item`: productos de un hogar.
- `List`: listas de compra.
- `ItemList`: productos dentro de una lista.
- `HomeFavorite`: hogares favoritos.
- `OneTimeToken`: tokens temporales para recuperar contraseña o registro por invitación.

**Relación con el resto del proyecto:** todas las rutas que leen o escriben datos usan `prisma/prisma.js`.

### `public/`

**Qué contiene:** assets estáticos usados en emails.

**Para qué sirve:** permite adjuntar imágenes como logo o cabecera en correos enviados por la aplicación.

**Archivos importantes:**

- `public/email/logo.png`
- `public/email/header.png`

**Relación con el resto del proyecto:** `config/emailTemplate.js` usa estos recursos para construir emails más cuidados visualmente.

### `router/`

**Qué contiene:** rutas HTTP de la API, separadas por dominio.

**Para qué sirve:** organiza la lógica de negocio en archivos más manejables. Cada archivo agrupa endpoints relacionados.

**Archivos importantes:**

- `index.js`: monta todos los routers.
- `auth.js`: registro, login, sesión y recuperación de contraseña.
- `home.js`: hogares, favoritos, transferencia de propietario y borrado.
- `member.js`: invitaciones, miembros y roles.
- `item.js`: productos, imágenes, importación entre hogares y búsqueda de imágenes.
- `list.js`: listas de compra, productos dentro de listas, estados y paginación.
- `onboarding.js`: estado de tutorial, hogar tutorial y paso de instalación.
- `profile.js`: consulta y edición del perfil de usuario.

**Relación con el resto del proyecto:** `app.js` importa `router/index.js`, y desde ahí se montan todas las rutas de la API.

### `uploads/`

**Qué contiene:** archivos temporales subidos por usuarios antes de enviarse a Cloudinary.

**Para qué sirve:** Multer guarda temporalmente archivos en esta carpeta cuando se sube una imagen desde el frontend.

**Relación con el resto del proyecto:** rutas como productos, hogares y perfil pueden recibir imágenes. Después se suben a Cloudinary.

**Nota:** esta carpeta está ignorada por Git. No debe subirse al repositorio.

### `docs/`

**Qué contiene:** documentación técnica del proyecto.

**Para qué sirve:** guardar documentación adicional que no cabe cómodamente en el README principal.

**Archivos importantes:**

- `documentacion-carpetas.md`: este documento.

## 5. Archivos importantes de la raíz

### `app.js`

**Qué contiene:** punto de entrada del servidor.

**Para qué sirve:** configura Express, CORS, Cloudinary, Socket.IO y monta las rutas principales.

**Relación con el resto del proyecto:** es el archivo que se ejecuta cuando se lanza el servidor con `npm run dev`.

También contiene la lógica inicial de Socket.IO para sincronizar listas mediante eventos como `list:join`, `list:leave` y `list:sync`.

### `package.json`

**Qué contiene:** dependencias, metadatos y scripts del proyecto.

**Scripts principales:**

- `npm run dev`: arranca el servidor con `nodemon`.
- `npm run deploy`: instala dependencias y genera Prisma Client.
- `npm run db`: ejecuta `prisma db push`.
- `npm test`: actualmente es un placeholder.

### `.env`

**Qué contiene:** variables de entorno locales.

**Para qué sirve:** guardar credenciales y configuración sensible como base de datos, JWT, Cloudinary o SMTP.

**Importante:** no debe subirse a GitHub. El proyecto ya lo incluye en `.gitignore`.

### `.gitignore`

**Qué contiene:** lista de archivos y carpetas que Git debe ignorar.

**Para qué sirve:** evita subir dependencias, archivos temporales, imágenes subidas y credenciales.

Incluye entradas importantes como:

- `node_modules`
- `uploads`
- `.env`
- `.DS_Store`

## 6. Flujo general del proyecto

### Flujo de autenticación

1. El usuario se registra o inicia sesión.
2. El backend valida credenciales.
3. Si todo es correcto, devuelve un token JWT.
4. El frontend envía ese token en `Authorization`.
5. `auth.middleware.js` valida el token antes de acceder a rutas privadas.

### Flujo de hogares

1. Un usuario crea un hogar.
2. Se crea automáticamente como `OWNER`.
3. Puede invitar a otros usuarios.
4. Los miembros se gestionan por roles.
5. Cada hogar tiene sus propios productos y listas.

### Flujo de listas

1. Se crea una lista asociada a un hogar.
2. Se añaden productos mediante `ItemList`.
3. Cada producto de la lista puede tener cantidad, cantidad comprada y estado.
4. Cuando hay cambios, Socket.IO puede avisar a los clientes conectados.

### Flujo de imágenes

1. El frontend puede subir un archivo o enviar una `imageUrl`.
2. El backend valida la imagen.
3. La imagen se sube a Cloudinary.
4. En base de datos se guarda el `public_id`, no la URL externa original.

### Flujo de onboarding

1. El frontend consulta `GET /onboarding/me`.
2. El backend devuelve el estado de onboarding del usuario.
3. Si hace falta, el frontend puede llamar a `POST /onboarding/tutorial-home`.
4. El backend crea o recrea un hogar tutorial con datos de ejemplo.
5. Al terminar o saltar, se actualiza el estado del usuario.

## 7. Dónde tocar según lo que quieras cambiar

- Para cambiar login, registro o recuperación de contraseña: `router/auth.js`.
- Para cambiar hogares o favoritos: `router/home.js`.
- Para cambiar invitaciones, roles o miembros: `router/member.js`.
- Para cambiar productos, imágenes o búsqueda de imágenes: `router/item.js`.
- Para cambiar listas de compra: `router/list.js`.
- Para cambiar onboarding/tutorial: `router/onboarding.js`.
- Para cambiar perfil de usuario: `router/profile.js`.
- Para cambiar modelos de base de datos: `prisma/schema.prisma`.
- Para cambiar envío de emails: `config/nodemailer.js` y `config/emailTemplate.js`.
- Para cambiar imágenes en Cloudinary: `config/cloudinaryUpload.js`.
- Para cambiar orígenes permitidos por CORS: `config/corsConfig.js`.
- Para cambiar autenticación por token: `middleware/auth.middleware.js`.
- Para cambiar sincronización en tiempo real: `app.js` y las emisiones dentro de rutas de listas.

## 8. Notas y pendientes

- El proyecto usa `.env`, pero sus valores no se documentan aquí por seguridad.
- `npm test` todavía no ejecuta una suite real de tests.
- La documentación OpenAPI/Swagger está pendiente de confirmar.
- El frontend no está dentro de este repositorio. Este repositorio documenta el servidor.
- La URL pública indicada para portfolio es `https://notapp.pablovaldazo.es`.
