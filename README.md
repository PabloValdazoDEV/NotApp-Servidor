# NotApp Servidor

Backend de **NotApp**, una aplicación para organizar compras compartidas en hogares: productos, listas, miembros, invitaciones y sincronización en tiempo real.

Este repositorio contiene la API que da soporte a la app disponible en:

**https://notapp.pablovaldazo.es**

> Este README está pensado para que cualquier persona que vea el proyecto desde GitHub pueda entender qué problema resuelve, cómo está construido y cómo se puede levantar en local sin perderse entre detalles internos.

## Qué Es NotApp

NotApp es una app orientada a hogares, parejas, familias o compañeros de piso que quieren coordinar la compra de forma sencilla.

Desde el backend se gestionan:

- Registro, login y recuperación de contraseña.
- Hogares compartidos con roles de `OWNER`, `ADMIN` y `MEMBER`.
- Invitaciones por email y control de invitaciones pendientes.
- Productos por hogar, con categorías, supermercado, precio e imagen.
- Listas de compra con cantidades, estados y sincronización en tiempo real.
- Onboarding con hogar tutorial para nuevos usuarios.
- Búsqueda de imágenes de productos en internet desde backend.
- Subida y gestión de imágenes en Cloudinary.

## Tecnologías

- **Node.js** y **Express** para la API REST.
- **PostgreSQL** como base de datos.
- **Prisma ORM** para modelar y consultar la base de datos.
- **Socket.IO** para sincronización en tiempo real de listas.
- **JWT** para autenticación.
- **bcrypt** para contraseñas.
- **Nodemailer** para emails transaccionales.
- **Cloudinary** para almacenar imágenes.
- **Multer** para recibir archivos desde formularios.
- **Axios** para llamadas HTTP externas, como búsqueda y descarga de imágenes.

## Funcionalidades Principales

### Autenticación

El servidor permite crear cuenta, iniciar sesión, consultar el usuario actual, cerrar sesión y recuperar contraseña mediante enlaces temporales enviados por email.

### Hogares

Cada usuario puede pertenecer a uno o varios hogares. Los hogares tienen miembros con roles y pueden marcarse como favoritos.

También existe un tipo especial de hogar tutorial (`is_tutorial`) para onboarding, separado de la lógica normal de hogares reales.

### Miembros e Invitaciones

Los usuarios con permisos pueden invitar a otras personas a un hogar. El backend controla:

- Límite de plazas por hogar.
- Invitaciones pendientes.
- Cancelación de invitaciones.
- Aceptación o rechazo de invitaciones.
- Roles dentro del hogar.

### Productos

Cada hogar tiene su propio catálogo de productos. Los productos pueden tener:

- Nombre.
- Descripción.
- Precio.
- Categorías.
- Supermercado.
- Imagen en Cloudinary.

El backend soporta imagen subida por el usuario o imagen seleccionada desde internet.

### Listas De Compra

Las listas permiten añadir productos, actualizar cantidades y marcar estados:

- `PENDING`
- `FOUND`
- `NOT_FOUND`

Cuando una lista cambia, Socket.IO puede avisar a los clientes conectados a esa lista.

### Onboarding

El onboarding guarda estado por usuario y puede crear un hogar tutorial con datos de prueba. Esto permite que un usuario nuevo pruebe la app sin tocar hogares reales.

### Búsqueda De Imágenes

El endpoint de búsqueda de imágenes se ejecuta desde backend para no exponer claves de APIs al frontend. Normaliza los resultados al formato:

```json
{
  "success": true,
  "images": [
    {
      "url": "https://...",
      "thumbnailUrl": "https://...",
      "title": "Producto"
    }
  ]
}
```

## Arquitectura Rápida

```txt
app.js
  ├─ Configura Express, CORS, Cloudinary y Socket.IO
  ├─ Monta las rutas desde router/
  └─ Escucha eventos en tiempo real para listas

router/
  ├─ auth.js         Autenticación y recuperación de contraseña
  ├─ home.js         Hogares y favoritos
  ├─ member.js       Miembros e invitaciones
  ├─ item.js         Productos e imágenes
  ├─ list.js         Listas de compra y estados
  ├─ onboarding.js   Tutorial y estado de onboarding
  └─ profile.js      Perfil de usuario

prisma/
  └─ schema.prisma   Modelos de base de datos
```

## Modelo De Datos

El modelo principal gira alrededor de estas entidades:

- `User`: cuenta de usuario, perfil, onboarding e invitaciones.
- `Home`: hogar compartido o tutorial.
- `Member`: relación entre usuario y hogar con rol.
- `Invitation`: invitación pendiente a un hogar.
- `Item`: producto disponible en un hogar.
- `List`: lista de compra.
- `ItemList`: producto dentro de una lista, con cantidad y estado.
- `HomeFavorite`: hogares favoritos por usuario.
- `OneTimeToken`: tokens temporales para registro especial y recuperación.

## Endpoints Principales

La API se monta desde `/` y agrupa endpoints por dominio.

| Área | Endpoints principales |
| --- | --- |
| Auth | `POST /login`, `GET /me`, `POST /forgot-password`, `POST /reset-password/:token` |
| Hogares | `POST /home/create-home`, `GET /home/user-home/:user_id`, `GET /home/:id`, `DELETE /home/:hogar_id` |
| Favoritos | `POST /home/:home_id/favorite`, `DELETE /home/:home_id/favorite` |
| Miembros | `POST /member/invite/:id_hogar`, `GET /member/invite/pending/:homeId`, `DELETE /member/invite/:invitationId` |
| Productos | `POST /item/create-item`, `POST /item/:item_id`, `DELETE /item/:item_id`, `GET /item/params/:id_home` |
| Imágenes | `GET /item/image-search?name=...&description=...&supermarket=...` |
| Listas | `POST /list/create-list`, `POST /list/add-item/:id_list`, `GET /list/home/:id_home`, `GET /list/:id_home/:id_list` |
| Onboarding | `GET /onboarding/me`, `POST /onboarding/tutorial-home`, `POST /onboarding/complete`, `POST /onboarding/skip` |

## Tiempo Real

Socket.IO se usa para sincronizar listas.

Eventos principales:

- `list:join`: el cliente entra en una sala de lista.
- `list:leave`: el cliente sale de esa sala.
- `list:sync`: el servidor envía el estado actual de la lista.

Esto permite que varios dispositivos puedan ver cambios en una lista de compra sin tener que recargar manualmente.

## Variables De Entorno

El proyecto usa `.env`, que está ignorado por Git. Nunca se deben subir credenciales reales al repositorio.

Variables principales:

```env
DATABASE_URL=
JWT_SECRET=
VITE_API_URL=
VITE_API_KEY=
URL=
URL_REGISTER=

NAME_CLOUDINARY=
API_KEY_CLOUDINARY=
API_SECRET_CLOUDINARY=

SMTP_HOST=
SMTP_PORT=
SMTP_SECURE=
SMTP_USER=
SMTP_PASS=
MAIL_FROM=
```

Variables opcionales para búsqueda de imágenes:

```env
GOOGLE_SEARCH_API_KEY=
GOOGLE_SEARCH_CX=
BING_IMAGE_SEARCH_API_KEY=
SERPAPI_API_KEY=
PEXELS_API_KEY=
UNSPLASH_ACCESS_KEY=
```

## Instalación Local

1. Instalar dependencias:

```bash
npm install
```

2. Crear un archivo `.env` con las variables necesarias.

3. Generar cliente Prisma:

```bash
npx prisma generate
```

4. Sincronizar schema con la base de datos:

```bash
npx prisma db push
```

5. Levantar servidor en desarrollo:

```bash
npm run dev
```

El servidor escucha por defecto en:

```txt
http://localhost:3000
```

## Scripts

```bash
npm run dev      # arranca el servidor con nodemon
npm run deploy   # instala dependencias y genera Prisma Client
npm run db       # aplica el schema con prisma db push
npm test         # placeholder, no hay suite de tests configurada todavía
```

## Seguridad Y Buenas Prácticas

- Las contraseñas se guardan con hash usando `bcrypt`.
- La autenticación se realiza con JWT.
- Las imágenes externas se validan antes de descargarlas.
- Las claves de búsqueda de imágenes viven en backend, no en frontend.
- `.env` está en `.gitignore`.
- Los hogares tutorial se marcan con `is_tutorial` para diferenciarlos de hogares reales.

## Estado Del Proyecto

NotApp es un proyecto funcional en evolución. El backend ya cubre las piezas principales de autenticación, hogares, listas, productos, invitaciones, onboarding, emails e imágenes.

Puntos que podrían seguir creciendo:

- Tests automatizados.
- Documentación OpenAPI/Swagger.
- Sistema de planes o límites avanzados.
- Panel interno de administración.

## Más Documentación

También hay una explicación carpeta por carpeta en:

```txt
docs/documentacion-carpetas.md
```

## Autor

Proyecto desarrollado por **Pablo Valdazo** como parte del ecosistema NotApp.

Demo / app:

**https://notapp.pablovaldazo.es**
