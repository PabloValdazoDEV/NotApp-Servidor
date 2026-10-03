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

Para una base existente, conservar primero un volcado propio y aplicar
[20261004_shopping_carry.sql](../prisma/updates/20261004_shopping_carry.sql).
El script crea dos tablas, añade una columna nullable, cambia el índice
producto/lista para admitir historial y registra las copias existentes. No
elimina registros ni cambia cantidades.

En el servidor desplegado, desde `NotApp-Servidor` y con la `DATABASE_URL` de
producción, ejecutar después de guardar la copia de esa base:

```bash
npm ci
npx prisma db execute --schema prisma/schema.prisma --file prisma/updates/20261004_shopping_carry.sql
npx prisma generate
```

Después reiniciar el backend actualizado y publicar el frontend. El script
`npm run deploy` instala dependencias y genera Prisma Client, pero no aplica
este SQL. Conservar las variables de producción; la configuración local apunta
al Docker del ordenador de desarrollo.

Estos pasos presuponen el esquema de la versión anterior, incluida la columna
`List.copied_from_not_found_list_id`. Si la instalación está más atrasada,
comparar primero su esquema. Un proyecto nuevo puede usar el esquema Prisma
actual.

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
