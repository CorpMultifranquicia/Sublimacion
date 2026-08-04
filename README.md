# SubliApp

Sistema de gestión para negocios de sublimación: ventas, producción (kanban), catálogo con recetas y márgenes, inventario, compras y CRM.

## Estado actual (Fases 1, 2 y 3 del roadmap)

App estática (HTML + Tailwind CDN + FontAwesome + JS vanilla con módulos ES), sin build de por medio salvo la inyección de credenciales. Backend: **Supabase** (Postgres + Auth + RLS + Storage). Deploy: **Vercel**.

- **Dashboard**: KPIs de ingresos/gastos del mes, ventas recientes, alertas de stock.
- **Ventas**: registro de pedidos con múltiples productos, descuento automático de stock de insumos según receta (vía función SQL transaccional `registrar_venta`). Descarga de recibo en PDF y envío del estado del pedido por WhatsApp.
- **Cotizaciones**: generador de PDF ad-hoc (cliente + productos) sin necesidad de registrar una venta.
- **Producción**: tablero kanban (Por Diseñar → Imprimiendo → Listo/Entregado) con drag & drop, sincronizado con el estado de la venta. Adjuntos por pedido (imágenes subidas a Supabase Storage o enlaces a Drive).
- **Productos y Precios**: CRUD de productos con constructor de receta (insumos + cantidad + % de merma), cálculo automático de costo de producción, margen % y ganancia neta.
- **Inventario**: CRUD de insumos, alertas por stock mínimo/crítico, filtro por categoría.
- **Compras**: registro de facturas de proveedor; actualiza stock y recalcula el costo unitario promedio ponderado del insumo (vía función SQL transaccional `registrar_compra`).
- **Clientes (CRM)**: directorio con WhatsApp directo, fechas especiales (con felicitación preformateada por WhatsApp), detalle de cliente con historial completo de compras, y ranking de mejores clientes.
- **Reportes**: gráfico de ingresos vs gastos (6 meses), productos más vendidos del mes, top clientes.
- **Login**: los administradores acceden con email/contraseña vía Supabase Auth. Todas las tablas tienen RLS: cualquier usuario autenticado tiene acceso total (crear, editar, eliminar, ver reportes) — no hay roles diferenciados, por diseño. Da cuenta a cada persona que use el sistema sabiendo que su acceso es total.
- **Precios de insumos y productos son editables directo**, sin pasar por Compras ni por una receta: en Inventario, el ✏️ de cualquier insumo permite cambiar su costo unitario y stock a mano; en Prod. y Precios, el ✏️ de cualquier producto permite cambiar su precio de venta. Compras solo es necesaria para *registrar una entrada de mercancía* (mueve stock y recalcula el costo promedio), no para poder editar un precio.

## Configurar Supabase (una sola vez)

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. Ve a **SQL Editor** y ejecuta completo el contenido de [`supabase/schema.sql`](supabase/schema.sql). Esto crea las tablas, las políticas RLS y las funciones `registrar_venta` / `registrar_compra`.
3. Ve a **Authentication → Users** y crea manualmente los 2 usuarios administradores (email + contraseña). No hay flujo de registro público, por diseño.
4. Ve a **Settings → API** y copia:
   - `Project URL`
   - `anon public` key (es segura de exponer en el cliente: el acceso real lo controla RLS, no esta key).

## Desarrollo local

```bash
cp js/config.example.js js/config.js
# edita js/config.js con tu Project URL y anon key
python3 -m http.server 8080
# abre http://localhost:8080
```

`js/config.js` está en `.gitignore` — nunca se commitea.

## Deploy en Vercel

1. Importa el repo en Vercel.
2. En **Settings → Environment Variables** agrega:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
3. Vercel usa `vercel.json` (build command `npm run build`, output `.`). El build corre `scripts/build-config.js`, que genera `js/config.js` a partir de esas variables — así las credenciales nunca quedan en el repo y puedes tener valores distintos por entorno (preview/producción).

## Traspasar el sistema a alguien más (carga de datos reales)

Cuando quieras entregarle la app a la persona que va a cargar el inventario real y armar las recetas:

1. **Limpia los datos de prueba.** En el SQL Editor de Supabase, ejecuta [`supabase/reset_datos_prueba.sql`](supabase/reset_datos_prueba.sql). Borra todos los insumos/productos/clientes/ventas/compras de prueba y reinicia los folios a 1 — pero no toca la estructura de tablas, las políticas, ni los usuarios. Es irreversible, léelo antes de correrlo.
   - Si subiste imágenes de prueba como adjuntos, bórralas aparte en **Storage → adjuntos** (el SQL no toca archivos, solo filas).
2. **Crea su acceso.** En **Authentication → Users → Add user**, dale su email + contraseña (marca "Auto Confirm User"). Tendrá el mismo acceso total que los demás administradores — no hay roles restringidos en este sistema.
3. **Pásale la URL de Vercel** y sus credenciales de acceso.

Orden recomendado para cargar datos desde cero (el sistema no lo obliga, pero evita ir y viniendo):

1. **Inventario** → crear todos los insumos (tinta, papel, tazas en blanco, franelas, etc.) con su costo unitario y stock inicial real.
2. **Prod. y Precios** → crear cada producto final, armar su receta seleccionando los insumos ya cargados (cantidad + % de merma) y fijar el precio de venta. El costo, margen % y ganancia neta se calculan solos.
3. **Clientes** (opcional en esta etapa) → cargar el directorio si ya lo tienen.
4. A partir de ahí, **Ventas**, **Compras**, **Producción** y **Reportes** ya funcionan solos con datos reales — no requieren configuración adicional.

## Arquitectura

- `supabase/schema.sql` — tablas, RLS y funciones de negocio (descuento de stock al vender, costo promedio ponderado al comprar) ejecutadas atómicamente en la base de datos.
- `js/supabaseClient.js` — inicializa el cliente de Supabase a partir de `window.__SUPABASE_CONFIG__`.
- `js/store.js` — capa de datos: lee/escribe en Supabase y mantiene una caché local en memoria para que el resto de la app renderice de forma síncrona. Cálculos de costo/margen/ganancia son puro JS sobre esa caché.
- `js/modal.js` — modal genérico reutilizable para formularios; deshabilita el botón de guardar mientras la operación está en curso (evita duplicados por doble clic).
- `js/pdf.js` — generación de recibos y cotizaciones en PDF (jsPDF). Edita `NEGOCIO_NOMBRE` / `NEGOCIO_CONTACTO` en este archivo con los datos reales del negocio.
- `js/imageUtils.js` — comprime imágenes en el navegador antes de subirlas a Storage (máx. 1600px, JPEG calidad 80%, rechaza archivos de más de 8MB).
- `js/app.js` — autenticación (login/logout), sidebar responsive con menú hamburguesa en móvil, búsqueda + paginación (8 filas) en Ventas/Productos/Inventario/Compras/Clientes, renderizado de vistas y wiring de eventos.
- `scripts/build-config.js` — genera `js/config.js` desde variables de entorno en el build de Vercel.
- `supabase/migrations/` — cambios incrementales de esquema para aplicar sobre un proyecto Supabase ya provisionado (ejecutar en orden, una sola vez cada uno).

Las 3 fases del roadmap original están implementadas. Ideas futuras no contempladas en el roadmap: roles/permisos más allá de los 2 admins, notificaciones automáticas de stock bajo, integración con la API oficial de WhatsApp Business (hoy es click-to-chat vía `wa.me`, requiere abrir WhatsApp manualmente).
