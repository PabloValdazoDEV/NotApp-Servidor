# Actualización de compra y UX

El frontend conserva las API reales, OAuth, correo, fotografías, permisos,
tutorial, caché offline y sincronización por Socket.IO. La compra parcial guarda
`purchased_quantity` y deja las unidades restantes en `NOT_FOUND`.

El cierre copia solo esas unidades a una lista nueva o a una lista activa del
mismo hogar. `ShoppingCarry` registra los incrementos de cada traslado y evita
repeticiones. Deshacer descuenta únicamente esos incrementos, conserva cambios
posteriores y rechaza el deshacer si perdería una compra posterior. No borra la
lista de destino. Las filas ya resueltas del destino conservan sus resultados;
el producto que falta crea una fila pendiente distinta.

La rama que estaba publicada también necesita los campos de acceso con Google y
la tabla de registros pendientes. El SQL de compra que se preparó para la base
local no cubre esos cambios: para producción usar
[20261004_production_update.sql](../prisma/updates/20261004_production_update.sql).
Este script completo añade `User.google_sub`, `User.password_enabled`,
`PendingRegistration`, `ShoppingCarry`, `ShoppingMutation` y la columna nullable
`ItemList.created_mutation_id`. Conserva las cuentas con contraseña habilitada,
el historial, las cantidades y los resultados existentes.

Antes de publicar el backend, guardar un volcado propio de **la base de
producción** y comprobar que puede restaurarse en otra base. El script comprueba
los campos y enums del esquema que hay en `origin/main` (`a230aed`), aborta si
faltan y aplica todos los cambios en una transacción. Si producción llevaba
más tiempo sin actualizarse, comparar primero su esquema. Puede ejecutarse de
nuevo y también sobre una base donde ya se aplicó el SQL de compras anterior.

En el servidor desplegado, desde `NotApp-Servidor` y con la `DATABASE_URL` de
producción, ejecutar después de verificar esa copia:

```bash
npm ci
npx prisma db execute --schema prisma/schema.prisma --file prisma/updates/20261004_production_update.sql
npx prisma generate
```

Después reiniciar el backend actualizado y publicar el frontend. El script
`npm run deploy` instala dependencias y genera Prisma Client, pero no aplica
este SQL. Si GitHub dispara el despliegue automáticamente, completar la copia
y la actualización de la base antes de activar el código nuevo. Conservar las
variables de producción; la configuración local apunta al Docker del ordenador
de desarrollo. No ejecutar `prisma db push`, `migrate reset` ni el seed como
parte de esta actualización. Un proyecto nuevo puede usar el esquema Prisma
actual en una base vacía.

Los enlaces públicos a un hogar siguen funcionando con registro por código y
acceso con Google. El token se conserva hasta verificar el email; al completar
el registro se incorpora al hogar respetando el límite de miembros de su plan.
Las invitaciones por email conservan su confirmación y su token de un solo uso.

Las altas, los cambios de cantidad y los traslados usan transacciones
serializables. `ShoppingMutation` reconoce reintentos mediante un identificador
estable y devuelve la fila actual sin sumar las unidades otra vez. Las
importaciones sobre una fila pendiente usan un incremento atómico; una fila
resuelta se mantiene y recibe una fila pendiente distinta. Un nuevo traslado
después de deshacer tiene un identificador diferente, para rechazar un deshacer
antiguo que llegue tarde.

Esta actualización se verifica con PostgreSQL temporal local. La copia de la
carpeta del proyecto conserva código, configuración e historial; no es un
volcado de una base remota. También se guardó la base de la instalación local y
se verificó su copia mediante restauración completa en otra base local. El SQL
se aplicó a esa instalación local tras la comprobación. No se ha aplicado a
ninguna base remota ni se ha publicado la aplicación.
