-- SubliApp — Limpieza de datos de prueba antes del traspaso.
-- Borra TODOS los datos de negocio (insumos, productos, recetas, clientes,
-- ventas, compras y sus detalles) y reinicia los folios de venta/compra a 1.
-- Conserva intactos: estructura de tablas, políticas RLS, funciones SQL
-- y los usuarios de Supabase Auth (nadie pierde su acceso).
--
-- ⚠️ Acción irreversible. Ejecútalo solo cuando quieras dejar el catálogo
-- completamente vacío para que alguien empiece a cargar datos reales.
--
-- Nota: esto NO borra los archivos ya subidos al bucket "adjuntos" de
-- Storage (son objetos de archivo, no filas de esta base). Si quieres
-- limpiarlos también, hazlo manualmente en el dashboard de Supabase:
-- Storage → adjuntos → seleccionar todo → eliminar.

truncate table
    ventas_detalle,
    venta_adjuntos,
    ventas,
    compras_detalle,
    compras,
    recetas_detalle,
    productos_finales,
    clientes,
    insumos
restart identity cascade;
