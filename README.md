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
| Auth | `POST /login`, `POST /auth/google`, `POST /auth/register/verify`, `POST /auth/register/resend`, `POST /auth/claim-invitation`, `GET /me`, `POST /forgot-password`, `POST /reset-password/:token` |
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
CAPACITOR_ORIGINS=https://localhost,capacitor://localhost,http://localhost
VITE_API_KEY=
URL=
URL_REGISTER=
REGISTRATION_CODE_EXPIRES_MINUTES=15

# Google Sign-In
GOOGLE_WEB_CLIENT_ID=
GOOGLE_SERVER_CLIENT_ID=
GOOGLE_ANDROID_CLIENT_ID=
GOOGLE_IOS_CLIENT_ID=
GOOGLE_CLIENT_IDS=

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

## Google Sign-In E Invitaciones

El frontend recibe la credencial de Google y la envía a `POST /auth/google`.
El backend verifica la firma, la audiencia, la caducidad, el `sub` de Google y
que el email esté verificado. Nunca se debe confiar en un email enviado por el
cliente sin verificar el `id_token`.

Cuando alguien abre un enlace de invitación y pulsa Google:

1. Se valida el token de invitación y su caducidad.
2. Se busca una cuenta existente por `google_sub` y, si no existe, por email
   verificado para vincularla sin crear duplicados.
3. Si no existe, se crea la cuenta con el email de Google y una contraseña
   aleatoria que no se expone al cliente.
4. La invitación se asigna a esa cuenta y sigue pendiente hasta que el usuario
   la acepte desde NotApp.

El enlace de invitación demuestra que la persona tiene acceso al correo al que
se envió. Por eso, si la invitación fue enviada a `correo-a@example.com` y la
cuenta de Google usa `correo-b@gmail.com`, ambas cuentas pueden quedar
vinculadas sin cambiar el email original guardado en la invitación. Si el
usuario ya tenía una sesión abierta, la página ofrece vincular el enlace a esa
cuenta.

## Google En Cada Entorno Y Plataforma

Usa un proyecto de Google Cloud y crea clientes OAuth separados para Web, iOS
y Android. El backend debe permitir todos los client IDs que puedan emitir
tokens válidos mediante `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_SERVER_CLIENT_ID`,
`GOOGLE_ANDROID_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID` o `GOOGLE_CLIENT_IDS`.

- **Dominio web:** añade el origen exacto, por ejemplo
  `https://notapp.pablovaldazo.es`, en *Authorized JavaScript origins*. Para
  local añade también `http://localhost:5173`.
- **Staging:** usa otro origen web y, preferiblemente, otro proyecto o clientes
  OAuth de pruebas. La web de staging debe apuntar a una API y base de datos de
  staging.
- **iOS:** al crear la app nativa habrá que configurar el client ID de iOS, su
  URL scheme reverso y solicitar un ID token cuya audiencia sea el client ID
  del servidor. El token se enviará al mismo endpoint `/auth/google`.
- **Android:** configura el paquete de la aplicación y la huella del
  certificado de firma; la app debe pedir un ID token para el client ID del
  servidor y enviarlo al mismo endpoint.
- **CORS:** `VITE_API_URL` en el backend es la lista de orígenes permitidos,
  separados por comas. En producción debe incluir el dominio web y los
  orígenes locales que realmente use Capacitor, nunca `*` junto con
  credenciales.
- Para Capacitor, `CAPACITOR_ORIGINS` debe incluir `https://localhost` y
  `capacitor://localhost`, que son los orígenes internos del WebView nativo.

Los client IDs no son secretos y pueden aparecer en el frontend. `JWT_SECRET`,
`DATABASE_URL`, claves SMTP y claves de Cloudinary sí son secretos y solo deben
vivir en el servidor o en el gestor de secretos del proveedor.

En iOS hay además una condición de App Store: si la app usa Google u otro
login social para la cuenta principal, normalmente debe ofrecer una opción
equivalente de **Sign in with Apple**. Conviene implementar Apple antes de
enviar la primera versión a revisión.

## Registro Con Email Y Contraseña

El registro normal solicita nombre, email y una única contraseña. El servidor
guarda temporalmente esos datos con el password ya cifrado, envía un código de
seis cifras y solo crea o activa la cuenta después de verificarlo. El código
caduca por defecto en 15 minutos; `REGISTRATION_CODE_EXPIRES_MINUTES` acepta
valores entre 15 y 30. También se puede solicitar el reenvío del código.

Si el email ya pertenece a una cuenta creada con Google, la verificación no
crea otra cuenta: activa el acceso mediante contraseña sobre el mismo usuario,
conservando hogares, listas, invitaciones y el vínculo `google_sub`. Las
cuentas que ya tienen contraseña siguen sin poder sobrescribirse mediante un
nuevo registro.

## Límites De Peticiones

El servidor devuelve `429` y `Retry-After` cuando se supera un límite. La
protección base permite 1.000 peticiones por IP cada 15 minutos y cada sesión
autenticada tiene además un máximo de 600 peticiones cada 15 minutos.

Las rutas sensibles tienen límites más estrictos: login y Google permiten 20
intentos por IP cada 15 minutos, registro 10 por IP y 3 por email cada hora,
reenvío de códigos 3 cada 15 minutos, recuperación de contraseña 5 por IP y 3
por email cada 15 minutos, búsqueda de imágenes 30 por usuario cada 15 minutos
y operaciones pesadas 60 por usuario cada 15 minutos. El menú público permite
120 consultas por IP cada 15 minutos. Socket.IO permite 60 conexiones nuevas
por IP y 120 eventos de listas por usuario cada 15 minutos.

Estos límites se guardan en memoria del proceso. Son adecuados para una única
instancia del servidor; si se despliega con varias instancias, hay que mover
los contadores a Redis u otro almacén compartido y mantener el límite del proxy
o CDN delante del servidor.

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

Al desplegar esta versión sobre una base de datos existente, este paso añade
`User.google_sub`, `User.password_enabled` y `PendingRegistration`. Hazlo
primero contra staging y verifica el estado antes de aplicarlo en producción.

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
npm test         # ejecuta los tests unitarios del backend
```

La suite inicial cubre utilidades puras del backend, como el parseo de
booleanos y la resolución de planes. Antes de publicar se debe ampliar con
pruebas de autenticación, permisos, hogares, listas, productos y eliminación
de cuenta, ejecutadas siempre contra una base de datos de desarrollo o
staging.

## Seguridad Y Buenas Prácticas

- Las contraseñas se guardan con hash usando `bcrypt`.
- La autenticación se realiza con JWT.
- Las imágenes externas se validan antes de descargarlas.
- Las claves de búsqueda de imágenes viven en backend, no en frontend.
- `.env` está en `.gitignore`.
- `.env.example` solo contiene nombres y valores de ejemplo; las credenciales
  reales deben configurarse en cada entorno de despliegue.
- Los hogares tutorial se marcan con `is_tutorial` para diferenciarlos de hogares reales.

## Estado Del Proyecto

NotApp es un proyecto funcional en evolución. El backend ya cubre las piezas principales de autenticación, hogares, listas, productos, invitaciones, onboarding, emails e imágenes.

Puntos que podrían seguir creciendo:

- Tests de integración contra una base de datos de staging.
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
