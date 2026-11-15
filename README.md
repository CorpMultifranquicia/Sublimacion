# SubliApp

Sistema de gestión para negocios de sublimación: ventas, producción (kanban), catálogo con recetas y márgenes, inventario, compras y CRM.

**Versión local**: un programa de Windows que corre en una sola PC, sin internet ni servicios externos. La base de datos es un archivo SQLite junto al ejecutable.

## Funcionalidades

- **Dashboard**: KPIs de ingresos/gastos del mes, ventas recientes, alertas de stock.
- **Ventas**: pedidos con múltiples productos. Al registrar una venta se descuenta del stock cada insumo de la receta (cantidad × (1 + % merma) × unidades). Recibo en PDF y estado del pedido por WhatsApp.
- **Cotizaciones**: PDF ad-hoc (cliente + productos) sin registrar una venta.
- **Producción**: kanban (Por Diseñar → Imprimiendo → Listo/Entregado) con drag & drop. Adjuntos por pedido: imágenes (guardadas en la PC) o enlaces a Drive.
- **Productos y Precios**: CRUD con receta (insumos + cantidad + % de merma), costo de producción, margen % y ganancia neta.
- **Inventario**: CRUD de insumos, alertas por stock mínimo/crítico, filtro por categoría. Costo y stock editables a mano.
- **Compras**: facturas de proveedor; suman stock y recalculan el costo unitario promedio ponderado del insumo.
- **Clientes (CRM)**: directorio, WhatsApp directo, fechas especiales, historial de compras y ranking.
- **Reportes**: ingresos vs gastos (6 meses), productos más vendidos, top clientes.

No hay login: el programa solo escucha en `127.0.0.1` (nadie fuera de esa PC puede entrar). Quien usa la PC tiene acceso total.

## Instalar en la PC del negocio

1. En GitHub, pestaña **Actions → "Compilar SubliApp para Windows"**, abre la última ejecución exitosa y descarga el artifact **SubliApp-windows** (un .zip).
   - Para generar una nueva: botón **Run workflow**. También se ejecuta solo cada vez que se hace push de cambios al código.
   - Alternativa sin GitHub: en una PC Windows con Python instalado, doble clic en `build_windows.bat` → queda en `dist\SubliApp\`.
2. Descomprime la carpeta en un lugar fijo, p. ej. `C:\SubliApp\` (no en "Descargas" ni en "Archivos de programa").
3. Crea un acceso directo de `SubliApp.exe` en el escritorio.

El uso diario, respaldos y restauración están explicados para el usuario final en [`LEEME.txt`](LEEME.txt) (viene dentro del .zip).

### Actualizar a una versión nueva

Descarga el .zip nuevo y reemplaza todo **excepto** la carpeta `SubliApp_datos`. Los datos no se tocan.

## Desarrollo

Requiere Python 3.10+.

```bash
python -m venv .venv
```

```bash
.venv/bin/pip install -r requirements.txt
```

```bash
.venv/bin/python SubliApp.py
```

Abre `http://127.0.0.1:8765`. En desarrollo los datos van a `datos/` (ignorada por git). Se puede cambiar con la variable de entorno `SUBLIAPP_DATOS`.

Opciones del lanzador: `--sin-navegador` (no abre el navegador) y `--borrar-datos` (vacía la base, pide confirmación y guarda copia antes).

## Arquitectura

```
SubliApp.py           Lanzador: respaldo diario, levanta el servidor y abre el navegador.
backend/
  base_datos.py       SQLite: esquema, lectura completa y todas las escrituras.
                      registrar_venta / registrar_compra corren en una transacción.
  api.py              Flask: sirve la interfaz y la API JSON en /api/...
index.html, css/, js/ Interfaz (HTML + Tailwind + JS vanilla con módulos ES).
  js/store.js         Capa de datos del frontend: llama a /api/... y mantiene una
                      caché en memoria; costos/márgenes se calculan aquí en JS.
  js/app.js           Vistas, modales y eventos.
  js/pdf.js           Recibos y cotizaciones (edita NEGOCIO_NOMBRE / NEGOCIO_CONTACTO).
  js/imageUtils.js    Comprime imágenes antes de guardarlas (máx. 1600px, JPEG 80%).
vendor/               Tailwind, jsPDF, FontAwesome y fuente Inter incluidos
                      (por eso funciona sin internet).
SubliApp.spec         Receta de PyInstaller (genera dist/SubliApp/SubliApp.exe).
build_windows.bat     Compila el .exe en una PC Windows.
.github/workflows/    Compila el .exe en GitHub Actions.
```

Carpeta de datos (`SubliApp_datos/` junto al .exe):

```
subliapp.db           Base de datos
adjuntos/<venta>/     Imágenes de diseño de cada pedido
respaldos/            Copia diaria (últimas 30) + copias "antes_de_borrar_..."
```

### Agregar un campo nuevo (ejemplo)

1. `backend/base_datos.py`: agrégalo al `CREATE TABLE` y a la tupla `CAMPOS_...` de esa tabla. Para una base ya existente, agrega también un `ALTER TABLE ... ADD COLUMN` en `BaseDatos.__init__` (protegido con `try/except sqlite3.OperationalError` por si ya existe).
2. `js/app.js`: agrégalo al formulario del modal correspondiente.

### Futuro: si el negocio crece

Si más adelante se necesita usar desde varias PCs, la API ya está separada del frontend: basta con escuchar en la red local (`host='0.0.0.0'` en `SubliApp.py`) y agregar login, o migrar `base_datos.py` a Postgres. El frontend no cambia.
