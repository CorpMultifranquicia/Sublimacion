"""
exportar.py — Genera un .xlsx con la información de un período.

Cada hoja es una Tabla de Excel (con filtros y nombre propio: tVentas, tCobros...),
lista para analizar con tablas dinámicas o Power Query.
"""

import io
from datetime import date

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

MONEDA = '#,##0.00'
COSTO = '#,##0.0000'
PORC = '0.0%'
FECHA = 'dd/mm/yyyy'


def _fecha(iso):
    return date.fromisoformat(iso) if iso else None


def _folio(prefijo, n):
    return f'{prefijo}-{n:04d}'


def _hoja(libro, titulo, nombre_tabla, columnas, filas):
    """columnas: lista de (encabezado, formato_numero_o_None, ancho)."""
    ws = libro.create_sheet(titulo)
    ws.append([c[0] for c in columnas])
    for fila in filas:
        ws.append(fila)
    for i, (_, formato, ancho) in enumerate(columnas, start=1):
        letra = get_column_letter(i)
        ws.column_dimensions[letra].width = ancho
        if formato:
            for celda in ws[letra][1:]:
                celda.number_format = formato
    if filas:
        ref = f'A1:{get_column_letter(len(columnas))}{len(filas) + 1}'
        tabla = Table(displayName=nombre_tabla, ref=ref)
        tabla.tableStyleInfo = TableStyleInfo(name='TableStyleMedium2', showRowStripes=True)
        ws.add_table(tabla)
    else:
        ws['A2'] = 'Sin datos en el período'
        ws['A2'].font = Font(italic=True, color='888888')
    ws.freeze_panes = 'A2'
    return ws


def libro_excel(estado, desde, hasta, movimientos):
    en_periodo = lambda f: f and desde <= f <= hasta
    clientes = {c['id']: c['nombre'] for c in estado['clientes']}
    nombre_cliente = lambda cid: clientes.get(cid, 'Mostrador') if cid else 'Mostrador'

    ventas = [v for v in estado['ventas'] if en_periodo(v['fecha'])]
    compras = [c for c in estado['compras'] if en_periodo(c['fecha'])]
    gastos = [g for g in estado['gastos'] if en_periodo(g['fecha'])]
    pagos = [(v, p) for v in estado['ventas'] for p in v['pagos'] if en_periodo(p['fecha'])]

    total_venta = lambda v: sum(d['cantidad'] * d['precio_unitario'] for d in v['detalle'])
    costo_venta = lambda v: sum(d['cantidad'] * d['costo_unitario'] for d in v['detalle'])
    pagado = lambda v: sum(p['monto'] for p in v['pagos'])

    libro = Workbook()
    libro.remove(libro.active)

    # --- Resumen ---
    ingresos = sum(map(total_venta, ventas))
    costo = sum(map(costo_venta, ventas))
    total_gastos = sum(g['monto'] for g in gastos)
    total_compras = sum(i['cantidad'] * i['costo_unitario'] for c in compras for i in c['items'])
    ws = libro.create_sheet('Resumen')
    ws['A1'] = estado['config'].get('negocio_nombre') or 'SubliApp'
    ws['A1'].font = Font(bold=True, size=14)
    ws['A2'] = f'Período: {desde} a {hasta}' if desde != '0000-01-01' else 'Período: todo el historial'
    filas = [
        ('Ventas', ingresos), ('Costo de lo vendido', costo), ('Utilidad bruta', ingresos - costo),
        ('Gastos generales', total_gastos), ('Utilidad neta', ingresos - costo - total_gastos), None,
        ('Cobrado en el período', sum(p['monto'] for _, p in pagos)),
        ('Por cobrar (ventas del período)', sum(total_venta(v) - pagado(v) for v in ventas)),
        ('Compras de insumos', total_compras), None,
        ('Cantidad de ventas', len(ventas)),
    ]
    fila = 4
    for item in filas:
        if item:
            ws.cell(fila, 1, item[0])
            es_conteo = item[0].startswith('Cantidad')
            c = ws.cell(fila, 2, item[1] if es_conteo else float(item[1]))
            c.number_format = '0' if es_conteo else MONEDA
            if item[0].startswith('Utilidad'):
                ws.cell(fila, 1).font = Font(bold=True)
                c.font = Font(bold=True)
        fila += 1
    ws['A4'].fill = ws['B4'].fill = PatternFill('solid', fgColor='EEF2FF')
    ws.column_dimensions['A'].width = 34
    ws.column_dimensions['B'].width = 18
    ws.cell(fila + 1, 1, 'Margen bruto').font = Font(bold=True)
    ws.cell(fila + 1, 2, (ingresos - costo) / ingresos if ingresos else 0).number_format = PORC

    # --- Ventas (una fila por producto vendido) ---
    _hoja(libro, 'Ventas', 'tVentas', [
        ('Folio', None, 11), ('Fecha', FECHA, 12), ('Cliente', None, 24), ('Producto', None, 28),
        ('Cantidad', '#,##0.##', 10), ('Precio unit.', MONEDA, 13), ('Subtotal', MONEDA, 13),
        ('Costo unit.', COSTO, 13), ('Costo total', MONEDA, 13), ('Utilidad', MONEDA, 13), ('Margen', PORC, 9),
        ('Estado', None, 14), ('Entrega', FECHA, 12), ('Tasa Bs/$', COSTO, 11), ('Subtotal Bs', MONEDA, 15),
    ], [
        [_folio('VEN', v['folio']), _fecha(v['fecha']), nombre_cliente(v['cliente_id']), d['producto_nombre'],
         d['cantidad'], d['precio_unitario'], d['cantidad'] * d['precio_unitario'], d['costo_unitario'],
         d['cantidad'] * d['costo_unitario'], d['cantidad'] * (d['precio_unitario'] - d['costo_unitario']),
         (1 - d['costo_unitario'] / d['precio_unitario']) if d['precio_unitario'] else 0,
         v['estado'], _fecha(v['fecha_entrega']), v.get('tasa'),
         d['cantidad'] * d['precio_unitario'] * v['tasa'] if v.get('tasa') else None]
        for v in sorted(ventas, key=lambda v: v['folio']) for d in v['detalle']
    ])

    # --- Rentabilidad por producto ---
    por_producto = {}
    for v in ventas:
        for d in v['detalle']:
            r = por_producto.setdefault(d['producto_nombre'], [0, 0, 0])
            r[0] += d['cantidad']
            r[1] += d['cantidad'] * d['precio_unitario']
            r[2] += d['cantidad'] * d['costo_unitario']
    _hoja(libro, 'Por producto', 'tProductos', [
        ('Producto', None, 30), ('Unidades', '#,##0.##', 11), ('Ventas', MONEDA, 14), ('Costo', MONEDA, 14),
        ('Utilidad', MONEDA, 14), ('Margen', PORC, 9),
    ], [[n, u, s, c, s - c, (s - c) / s if s else 0]
        for n, (u, s, c) in sorted(por_producto.items(), key=lambda x: -(x[1][1] - x[1][2]))])

    # --- Cobros ---
    _hoja(libro, 'Cobros', 'tCobros', [
        ('Fecha', FECHA, 12), ('Venta', None, 11), ('Cliente', None, 24), ('Monto $', MONEDA, 13),
        ('Método', None, 16), ('Pagó en', None, 9), ('Monto Bs', MONEDA, 14), ('Tasa', COSTO, 11), ('Nota', None, 30),
    ], [[_fecha(p['fecha']), _folio('VEN', v['folio']), nombre_cliente(v['cliente_id']), p['monto'], p['metodo'],
         'Bs' if p.get('moneda') == 'VES' else '$', p.get('monto_original'), p.get('tasa'), p['nota']]
        for v, p in sorted(pagos, key=lambda x: x[1]['fecha'])])

    # --- Cuentas por cobrar (todas las ventas con saldo hasta la fecha final) ---
    pendientes = [v for v in estado['ventas'] if v['fecha'] <= hasta and total_venta(v) - pagado(v) > 0.005]
    _hoja(libro, 'Por cobrar', 'tPorCobrar', [
        ('Venta', None, 11), ('Fecha', FECHA, 12), ('Cliente', None, 24), ('Total', MONEDA, 13),
        ('Abonado', MONEDA, 13), ('Saldo', MONEDA, 13), ('Días', '0', 7),
    ], [[_folio('VEN', v['folio']), _fecha(v['fecha']), nombre_cliente(v['cliente_id']), total_venta(v), pagado(v),
         total_venta(v) - pagado(v), (date.today() - date.fromisoformat(v['fecha'])).days]
        for v in sorted(pendientes, key=lambda v: v['fecha'])])

    # --- Compras ---
    _hoja(libro, 'Compras', 'tCompras', [
        ('Folio', None, 11), ('Fecha', FECHA, 12), ('Proveedor', None, 24), ('Insumo', None, 28),
        ('Cantidad', '#,##0.##', 10), ('Costo unit.', COSTO, 13), ('Subtotal', MONEDA, 13),
    ], [[_folio('COM', c['folio']), _fecha(c['fecha']), c['proveedor'], i['insumo_nombre'], i['cantidad'],
         i['costo_unitario'], i['cantidad'] * i['costo_unitario']]
        for c in sorted(compras, key=lambda c: c['folio']) for i in c['items']])

    # --- Gastos ---
    _hoja(libro, 'Gastos', 'tGastos', [
        ('Fecha', FECHA, 12), ('Categoría', None, 18), ('Descripción', None, 36), ('Monto', MONEDA, 13),
    ], [[_fecha(g['fecha']), g['categoria'], g['descripcion'], g['monto']] for g in sorted(gastos, key=lambda g: g['fecha'])])

    # --- Inventario actual ---
    _hoja(libro, 'Inventario', 'tInventario', [
        ('Insumo', None, 28), ('Categoría', None, 13), ('Unidad', None, 9), ('Stock', '#,##0.00', 11),
        ('Stock mínimo', '#,##0.00', 12), ('Costo unit.', COSTO, 13), ('Valor', MONEDA, 13),
    ], [[i['nombre'], i['categoria'], i['unidad_medida'], i['stock_actual'], i['stock_minimo'], i['costo_unitario'],
         max(i['stock_actual'], 0) * i['costo_unitario']] for i in estado['insumos']])

    # --- Kárdex del período ---
    _hoja(libro, 'Kárdex', 'tKardex', [
        ('Fecha', FECHA, 12), ('Insumo', None, 26), ('Movimiento', None, 20), ('Referencia', None, 11),
        ('Cantidad', '#,##0.00', 11), ('Costo unit.', COSTO, 13), ('Stock resultante', '#,##0.00', 15), ('Nota', None, 30),
    ], [[_fecha(m['fecha']), m['insumo_nombre'], m['tipo'], m['referencia'] or '', m['cantidad'], m['costo_unitario'],
         m['stock_resultante'], m['nota'] or ''] for m in movimientos if en_periodo(m['fecha'])])

    for ws in libro.worksheets:
        for celda in ws[1]:
            celda.alignment = Alignment(vertical='center')

    salida = io.BytesIO()
    libro.save(salida)
    salida.seek(0)
    return salida
