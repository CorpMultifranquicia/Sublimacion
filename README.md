# SubliApp

Sistema de gestión para negocios de sublimación: ventas, producción (kanban), catálogo con recetas y márgenes, inventario, compras y CRM.

**Versión local**: un programa de Windows que corre en una sola PC, sin internet ni servicios externos. La base de datos es un archivo SQLite junto al ejecutable.

## Funcionalidades

- **Inicio**: ventas y utilidad del mes comparadas con el mes anterior, cuentas por cobrar, entregas atrasadas y próximas, fechas especiales de clientes (próximos 7 días, con felicitación por WhatsApp), stock bajo y aviso si hace más de 7 días que no se descarga un respaldo.
- **Ventas**: pedidos con buscador de clientes y productos (o venta de "Mostrador"), fecha de entrega, notas y **abonos** (anticipo + pagos parciales, saldo pendiente). Al vender se descuenta el stock según la receta y se **guarda el costo de producción del momento**. Editar o anular una venta corrige el stock automáticamente. Recibo en PDF y mensajes de WhatsApp según el estado.
- **Cotizaciones**: se guardan con folio (COT-0001) y vencimiento; admiten líneas fuera del catálogo; PDF, resumen por WhatsApp y **conversión a venta con un clic**.
- **Producción**: kanban Por Diseñar → Imprimiendo → Listo → Entregado, ordenado por fecha de entrega, con pedidos atrasados resaltados, saldo pendiente visible, botón para avanzar de etapa y diseños adjuntos.
- **Productos y Precios**: receta (insumos + cantidad + % merma), costo, margen y **precio sugerido** según el margen objetivo de Configuración.
- **Inventario**: stock, alertas, valor del inventario y **kárdex** por insumo (cada venta, compra, merma y ajuste queda registrado). Mermas y ajustes se registran como movimiento propio.
- **Compras**: suman stock y recalculan el costo promedio ponderado; se pueden editar o anular.
- **Gastos**: gastos generales (alquiler, luz, internet, sueldos...) por mes y categoría.
- **Clientes**: contacto, email, fechas especiales, notas, total comprado, saldo e historial.
- **Reportes**: por período (mes, mes anterior, 3 meses, año o rango libre): ventas, costo de lo vendido, utilidad bruta, gastos, **utilidad neta**, cobrado/por cobrar, rentabilidad por producto y por cliente. **Exportación a Excel** con hojas en formato Tabla (tVentas, tCobros, tKardex...) listas para tablas dinámicas o Power Query.
- **Configuración**: datos del negocio y logo (salen en los PDF), moneda, margen objetivo, validez y condiciones de las cotizaciones, vista previa de documentos, descarga de respaldo.

Los recibos y cotizaciones son **documentos no fiscales**.

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
SubliApp.py              Lanzador: respaldo diario, levanta el servidor y abre el navegador.
backend/
  esquema.py             Estructura de la base y migraciones automáticas (PRAGMA user_version).
  base_datos.py          Todas las lecturas/escrituras y reglas de negocio (stock, kárdex,
                         abonos, costo promedio). Cada operación corre en una transacción.
  api.py                 Flask: sirve la interfaz y la API JSON en /api/...
  exportar.py            Genera el Excel de Reportes (openpyxl).
index.html               Estructura de la pantalla y paleta de colores (tailwind.config).
js/
  app.js                 Arranque, menú y navegación.
  store.js               Llama a la API, guarda el estado en memoria y hace los cálculos
                         (costos, márgenes, saldos, resúmenes por período).
  util.js                Formatos de dinero/fechas (fechas SIEMPRE locales), escape de HTML.
  ui.js                  Modal, avisos (toasts) y combo con buscador.
  pdf.js                 Recibo y cotización (jsPDF).
  vistas/<sección>.js    Una pantalla por archivo (ventas, inventario, reportes...).
vendor/                  Tailwind, jsPDF, FontAwesome e Inter incluidos (funciona sin internet).
SubliApp.spec            Receta de PyInstaller (genera dist/SubliApp/SubliApp.exe).
build_windows.bat        Compila el .exe en una PC Windows.
.github/workflows/       Compila el .exe en GitHub Actions.
```

Carpeta de datos (`SubliApp_datos/` junto al .exe):

```
subliapp.db              Base de datos
adjuntos/<venta>/        Imágenes de diseño de cada pedido
respaldos/               Copia diaria (últimas 30), "antes_de_borrar_..." y "antes_de_migrar_..."
```

### Cambiar la estructura de la base (ejemplo: un campo nuevo)

1. `backend/esquema.py`: agrega la columna en `ESQUEMA` (bases nuevas) y una función `migrar_a_N` con el `ALTER TABLE` (bases existentes); súmala a `MIGRACIONES` y sube `VERSION`. Al abrir el programa se migra solo, guardando antes una copia en `respaldos/`.
2. `backend/base_datos.py`: inclúyelo en la validación/guardado de esa entidad.
3. `js/vistas/<sección>.js`: agrégalo al formulario.

### Cambiar los colores

En `index.html`, el bloque `tailwind.config` redefine la paleta principal (`indigo`) con los tonos de la marca. Los PDF usan las constantes de color al inicio de `js/pdf.js`.

### Futuro: si el negocio crece

Si más adelante se necesita usar desde varias PCs, la API ya está separada del frontend: basta con escuchar en la red local (`host='0.0.0.0'` en `SubliApp.py`) y agregar login, o migrar `base_datos.py` a Postgres. El frontend no cambia.
