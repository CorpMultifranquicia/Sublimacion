# SubliApp

Sistema de gestión para negocios de sublimación: ventas, producción (kanban), catálogo con recetas y márgenes, inventario, compras y CRM.

## Estado actual (Fase 1 MVP)

App estática (HTML + Tailwind CDN + FontAwesome + JS vanilla con módulos ES) con persistencia en `localStorage`. Sin dependencias de build.

- **Dashboard**: KPIs de ingresos/gastos del mes, ventas recientes, alertas de stock.
- **Ventas**: registro de pedidos con múltiples productos, descuento automático de stock de insumos según receta.
- **Producción**: tablero kanban (Por Diseñar → Imprimiendo → Listo/Entregado) con drag & drop, sincronizado con el estado de la venta.
- **Productos y Precios**: CRUD de productos con constructor de receta (insumos + cantidad + % de merma), cálculo automático de costo de producción, margen % y ganancia neta.
- **Inventario**: CRUD de insumos, alertas por stock mínimo/crítico, filtro por categoría.
- **Compras**: registro de facturas de proveedor; actualiza stock y recalcula el costo unitario promedio ponderado del insumo.
- **Clientes (CRM)**: directorio con WhatsApp, fechas especiales y ranking de compras.
- **Reportes**: gráfico de ingresos vs gastos (6 meses), productos más vendidos del mes, top clientes.

## Cómo correrla

Cualquier servidor estático sirve (usa módulos ES, no abrir el `index.html` con `file://`):

```bash
python3 -m http.server 8080
# abrir http://localhost:8080
```

## Arquitectura

- `js/store.js` — capa de datos y lógica de negocio (cálculos de costos/márgenes, descuento de stock, costo promedio ponderado). Aislada del resto para poder sustituir `localStorage` por Supabase/Firebase sin tocar la UI.
- `js/modal.js` — modal genérico reutilizable para formularios.
- `js/app.js` — renderizado de vistas y wiring de eventos.

## Próximas fases (ver roadmap)

- Persistencia real en backend (Supabase/Firebase) en lugar de `localStorage`.
- Adjuntos en producción (Drive / subida de imágenes).
- Generación de PDF (recibos/cotizaciones) e integración de WhatsApp click-to-chat.
