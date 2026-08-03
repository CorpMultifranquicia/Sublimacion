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
- **Login**: los 2 administradores acceden con email/contraseña vía Supabase Auth. Todas las tablas tienen RLS: solo usuarios autenticados leen/escriben.

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
