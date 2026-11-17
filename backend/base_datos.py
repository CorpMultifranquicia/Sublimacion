"""
base_datos.py — Todo el acceso a SQLite de SubliApp.

Un solo archivo de base de datos (subliapp.db) dentro de la carpeta de datos.
Aquí viven:
  - el esquema de tablas y sus migraciones (ver esquema.py),
  - la lectura completa del estado que consume el frontend,
  - todas las escrituras. Cada operación corre en una transacción:
    o se guarda todo, o nada.

Reglas de negocio importantes:
  - Toda variación de stock queda registrada en movimientos_inventario (kárdex).
  - Al vender se guarda el costo de producción de ese momento (para reportes de
    ganancia real) y el nombre del producto (para que el historial no se pierda).
  - Anular/editar una venta o compra revierte exactamente los movimientos de stock
    que esa operación generó.
"""

import base64
import shutil
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path

from .esquema import preparar_base

ESTADOS_PRODUCCION = ('Por Diseñar', 'Imprimiendo', 'Listo', 'Entregado')
CATEGORIAS_INSUMO = ('Consumible', 'Sustrato')
METODOS_PAGO = ('Efectivo', 'Transferencia', 'Pago móvil', 'Zelle', 'Punto de venta', 'Otro')

# Campos que el frontend puede escribir en cada tabla (todo lo demás se ignora).
CAMPOS_PRODUCTO = ('nombre', 'categoria', 'precio_venta')
CAMPOS_CLIENTE = ('nombre', 'telefono', 'email', 'fecha_especial', 'tipo_fecha', 'notas')
CAMPOS_GASTO = ('fecha', 'categoria', 'descripcion', 'monto')

# Configuración del negocio: clave -> valor por defecto.
CONFIG_DEFECTO = {
    'negocio_nombre': 'Zafiro Lab',
    'negocio_eslogan': 'Sublimación y personalización',
    'negocio_rif': '',
    'negocio_telefono': '',
    'negocio_direccion': '',
    'negocio_email': '',
    'negocio_redes': '',
    'logo': '',                      # imagen como data URL; si nunca se configuró, se usa LOGO_PREDETERMINADO
    'moneda': '$',
    'margen_objetivo': '50',         # % sobre el precio de venta
    'cotizacion_validez_dias': '15',
    'cotizacion_condiciones': 'Precios sujetos a cambio sin previo aviso. Se requiere 50% de anticipo para iniciar el pedido.',
    'recibo_pie': '¡Gracias por tu compra!',
    'ultimo_respaldo': '',           # fecha ISO de la última descarga de respaldo
    # Bolívares: los precios se manejan en la moneda base ($) y se convierten con la tasa del día.
    'bs_activo': '1',                # '1' muestra equivalentes en Bs y permite documentos en Bs
    'moneda_local': 'Bs',
    'tasa_dia': '',                  # Bs por $ (se carga a mano)
    'tasa_fecha': '',                # fecha ISO de la tasa cargada
    'documentos_moneda': 'ambas',    # moneda por defecto de los PDF: base / local / ambas
}

MONEDAS_PAGO = ('USD', 'VES')

# Logo de Zafiro Lab que trae el programa de fábrica (backend/logo_predeterminado.png).
_RUTA_LOGO = Path(__file__).with_name('logo_predeterminado.png')
_logo_cache = None


def logo_predeterminado():
    global _logo_cache
    if _logo_cache is None:
        _logo_cache = ('data:image/png;base64,' + base64.b64encode(_RUTA_LOGO.read_bytes()).decode()
                       if _RUTA_LOGO.exists() else '')
    return _logo_cache


class ErrorDeDatos(ValueError):
    """Error de validación que se le muestra tal cual al usuario."""


def nuevo_id():
    return str(uuid.uuid4())


def hoy():
    return date.today().isoformat()


def r4(n):
    return round(float(n), 4)


def numero(valor, nombre, minimo=None):
    try:
        n = float(valor)
    except (TypeError, ValueError):
        raise ErrorDeDatos(f'{nombre}: valor inválido.')
    if minimo is not None and n < minimo:
        raise ErrorDeDatos(f'{nombre} no puede ser menor que {minimo}.')
    return n


def folio_txt(prefijo, folio):
    return f'{prefijo}-{folio:04d}'


class BaseDatos:
    def __init__(self, carpeta_datos: Path):
        self.carpeta = Path(carpeta_datos)
        self.carpeta.mkdir(parents=True, exist_ok=True)
        self.ruta = self.carpeta / 'subliapp.db'
        self.carpeta_adjuntos = self.carpeta / 'adjuntos'
        self.carpeta_adjuntos.mkdir(exist_ok=True)
        preparar_base(self.ruta)

    # ---------- Conexión ----------

    @contextmanager
    def conexion(self):
        """Abre una conexión, hace commit si todo sale bien y rollback si algo falla."""
        con = sqlite3.connect(self.ruta)
        con.row_factory = sqlite3.Row
        con.execute('PRAGMA foreign_keys = ON')
        try:
            yield con
            con.commit()
        except Exception:
            con.rollback()
            raise
        finally:
            con.close()

    # ---------- Respaldos ----------

    def respaldar(self, conservar=30):
        """Copia diaria: respaldos/subliapp_AAAA-MM-DD.db (solo la primera vez del día).
        Conserva las últimas `conservar` copias diarias y borra las más antiguas."""
        destino = self.carpeta / 'respaldos' / f'subliapp_{hoy()}.db'
        if not destino.exists():
            self.copiar_base(destino)
        diarios = sorted((self.carpeta / 'respaldos').glob('subliapp_????-??-??.db'))
        for viejo in diarios[:-conservar]:
            viejo.unlink()

    def respaldar_antes_de_borrar(self):
        """Copia con fecha y hora que no se borra automáticamente."""
        destino = self.carpeta / 'respaldos' / f'antes_de_borrar_{datetime.now():%Y-%m-%d_%H%M%S}.db'
        self.copiar_base(destino)
        return destino

    def copiar_base(self, destino: Path):
        destino.parent.mkdir(exist_ok=True)
        origen = sqlite3.connect(self.ruta)
        copia = sqlite3.connect(destino)
        with copia:
            origen.backup(copia)
        origen.close()
        copia.close()

    # ---------- Configuración ----------

    def config(self, con=None):
        def leer(c):
            guardado = {r['clave']: r['valor'] for r in c.execute('SELECT clave, valor FROM configuracion')}
            config = {k: guardado.get(k, v) for k, v in CONFIG_DEFECTO.items()}
            # Logo: si nunca se eligió uno, va el de fábrica. Si el usuario lo quitó, queda vacío ('').
            if 'logo' not in guardado:
                config['logo'] = logo_predeterminado()
            return config
        if con is not None:
            return leer(con)
        with self.conexion() as c:
            return leer(c)

    def guardar_config(self, datos):
        with self.conexion() as con:
            for clave, valor in datos.items():
                if clave not in CONFIG_DEFECTO:
                    continue
                if valor is None:
                    # null = volver al valor de fábrica (p. ej. restaurar el logo predeterminado)
                    con.execute('DELETE FROM configuracion WHERE clave = ?', (clave,))
                    continue
                con.execute('INSERT INTO configuracion (clave, valor) VALUES (?, ?) '
                            'ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor',
                            (clave, '' if valor is None else str(valor)))

    # ---------- Tasa de cambio ----------

    def tasa_vigente(self, con):
        valor = self.config(con).get('tasa_dia')
        try:
            tasa = float(valor)
            return tasa if tasa > 0 else None
        except (TypeError, ValueError):
            return None

    def guardar_tasa(self, datos):
        """Registra la tasa (Bs por $) de una fecha. Si es la más reciente, pasa a ser la tasa del día."""
        tasa = numero(datos.get('tasa'), 'Tasa', 0.000001)
        fecha = datos.get('fecha') or hoy()
        with self.conexion() as con:
            con.execute('INSERT INTO tasas (fecha, tasa) VALUES (?, ?) ON CONFLICT(fecha) DO UPDATE SET tasa = excluded.tasa',
                        (fecha, tasa))
            ultima = con.execute('SELECT fecha, tasa FROM tasas ORDER BY fecha DESC LIMIT 1').fetchone()
        self.guardar_config({'tasa_dia': f"{ultima['tasa']:g}", 'tasa_fecha': ultima['fecha']})

    def borrar_tasa(self, fecha):
        with self.conexion() as con:
            con.execute('DELETE FROM tasas WHERE fecha = ?', (fecha,))
            ultima = con.execute('SELECT fecha, tasa FROM tasas ORDER BY fecha DESC LIMIT 1').fetchone()
        self.guardar_config({'tasa_dia': f"{ultima['tasa']:g}" if ultima else '', 'tasa_fecha': ultima['fecha'] if ultima else ''})

    # ---------- Lectura completa (lo que el frontend carga en memoria) ----------

    def estado(self):
        with self.conexion() as con:
            q = lambda sql: [dict(r) for r in con.execute(sql)]
            insumos = q('SELECT * FROM insumos ORDER BY nombre COLLATE NOCASE')
            productos = q('SELECT * FROM productos_finales ORDER BY nombre COLLATE NOCASE')
            recetas = q('SELECT * FROM recetas_detalle')
            clientes = q('SELECT * FROM clientes ORDER BY nombre COLLATE NOCASE')
            ventas = q('SELECT * FROM ventas ORDER BY fecha DESC, folio DESC')
            ventas_detalle = q('SELECT * FROM ventas_detalle ORDER BY rowid')
            adjuntos = q('SELECT * FROM venta_adjuntos ORDER BY created_at')
            pagos = q('SELECT * FROM pagos ORDER BY fecha, created_at')
            compras = q('SELECT * FROM compras ORDER BY fecha DESC, folio DESC')
            compras_detalle = q('SELECT * FROM compras_detalle ORDER BY rowid')
            cotizaciones = q('SELECT * FROM cotizaciones ORDER BY fecha DESC, folio DESC')
            cotizaciones_detalle = q('SELECT * FROM cotizaciones_detalle ORDER BY rowid')
            gastos = q('SELECT * FROM gastos ORDER BY fecha DESC, created_at DESC')
            tasas = q('SELECT * FROM tasas ORDER BY fecha DESC LIMIT 60')
            config = self.config(con)

        def agrupar(filas, clave):
            grupos = {}
            for f in filas:
                grupos.setdefault(f[clave], []).append(f)
            return grupos

        recetas_por = agrupar(recetas, 'producto_id')
        vdet_por = agrupar(ventas_detalle, 'venta_id')
        adj_por = agrupar(adjuntos, 'venta_id')
        pagos_por = agrupar(pagos, 'venta_id')
        cdet_por = agrupar(compras_detalle, 'compra_id')
        cotdet_por = agrupar(cotizaciones_detalle, 'cotizacion_id')

        return {
            'config': config,
            'tasas': tasas,
            'insumos': insumos,
            'clientes': clientes,
            'gastos': gastos,
            'productos': [{
                **p,
                'receta': [{'insumo_id': r['insumo_id'], 'cantidad': r['cantidad_usada'], 'merma_pct': r['porcentaje_merma']}
                           for r in recetas_por.get(p['id'], [])],
            } for p in productos],
            'ventas': [{
                'id': v['id'],
                'folio': v['folio'],
                'cliente_id': v['cliente_id'],
                'fecha': v['fecha'],
                'fecha_entrega': v['fecha_entrega'],
                'entregado_en': v['entregado_en'],
                'notas': v['notas'] or '',
                'tasa': v['tasa'],
                'estado': v['estado_produccion'],
                'detalle': [{'producto_id': d['producto_id'], 'producto_nombre': d['producto_nombre'],
                             'cantidad': d['cantidad'], 'precio_unitario': d['precio_unitario'],
                             'costo_unitario': d['costo_unitario']}
                            for d in vdet_por.get(v['id'], [])],
                'adjuntos': [{'id': a['id'], 'tipo': a['tipo'], 'url': a['url'], 'nombre': a['nombre']}
                             for a in adj_por.get(v['id'], [])],
                'pagos': [{'id': p['id'], 'fecha': p['fecha'], 'monto': p['monto'], 'metodo': p['metodo'], 'nota': p['nota'],
                           'moneda': p['moneda'], 'monto_original': p['monto_original'], 'tasa': p['tasa']}
                          for p in pagos_por.get(v['id'], [])],
            } for v in ventas],
            'compras': [{
                'id': c['id'],
                'folio': c['folio'],
                'proveedor': c['proveedor'],
                'fecha': c['fecha'],
                'items': [{'insumo_id': i['insumo_id'], 'insumo_nombre': i['insumo_nombre'],
                           'cantidad': i['cantidad'], 'costo_unitario': i['costo_unitario']}
                          for i in cdet_por.get(c['id'], [])],
            } for c in compras],
            'cotizaciones': [{
                **c,
                'items': [{'producto_id': d['producto_id'], 'producto_nombre': d['producto_nombre'],
                           'cantidad': d['cantidad'], 'precio_unitario': d['precio_unitario']}
                          for d in cotdet_por.get(c['id'], [])],
            } for c in cotizaciones],
        }

    # ---------- Utilidades internas ----------

    def _insertar(self, con, tabla, campos_permitidos, datos):
        fila = {k: datos.get(k) for k in campos_permitidos if k in datos}
        fila['id'] = nuevo_id()
        columnas = ', '.join(fila)
        marcas = ', '.join('?' for _ in fila)
        con.execute(f'INSERT INTO {tabla} ({columnas}) VALUES ({marcas})', list(fila.values()))
        return fila['id']

    def _actualizar(self, con, tabla, campos_permitidos, id_, datos):
        fila = {k: datos[k] for k in campos_permitidos if k in datos}
        if not fila:
            return
        asignaciones = ', '.join(f'{k} = ?' for k in fila)
        con.execute(f'UPDATE {tabla} SET {asignaciones} WHERE id = ?', [*fila.values(), id_])

    def _siguiente_folio(self, con, nombre):
        con.execute('UPDATE contadores SET valor = valor + 1 WHERE nombre = ?', (nombre,))
        return con.execute('SELECT valor FROM contadores WHERE nombre = ?', (nombre,)).fetchone()['valor']

    def _texto_requerido(self, valor, nombre):
        valor = (valor or '').strip()
        if not valor:
            raise ErrorDeDatos(f'Falta {nombre}.')
        return valor

    # ---------- Kárdex (movimientos de inventario) ----------

    def _mover_stock(self, con, insumo_id, cantidad, tipo, fecha, referencia='', ref_tipo=None, ref_id=None,
                     nota='', costo_unitario=None, nuevo_costo=None):
        """Suma `cantidad` (positiva o negativa) al stock del insumo y lo registra en el kárdex.
        Si se pasa `nuevo_costo`, también actualiza el costo unitario del insumo."""
        insumo = con.execute('SELECT stock_actual, costo_unitario FROM insumos WHERE id = ?', (insumo_id,)).fetchone()
        if not insumo:
            return
        stock = r4(insumo['stock_actual'] + cantidad)
        costo = r4(nuevo_costo) if nuevo_costo is not None else insumo['costo_unitario']
        con.execute('UPDATE insumos SET stock_actual = ?, costo_unitario = ? WHERE id = ?', (stock, costo, insumo_id))
        con.execute(
            'INSERT INTO movimientos_inventario (id, insumo_id, fecha, tipo, cantidad, costo_unitario, stock_resultante, '
            'referencia, ref_tipo, ref_id, nota) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (nuevo_id(), insumo_id, fecha or hoy(), tipo, r4(cantidad),
             r4(costo_unitario if costo_unitario is not None else costo), stock, referencia, ref_tipo, ref_id, nota or ''),
        )

    def _revertir_movimientos(self, con, ref_tipo, ref_id, tipo, referencia):
        """Deshace el efecto neto en stock de todos los movimientos de una venta/compra."""
        netos = con.execute(
            'SELECT insumo_id, SUM(cantidad) AS neto FROM movimientos_inventario '
            'WHERE ref_tipo = ? AND ref_id = ? GROUP BY insumo_id', (ref_tipo, ref_id)).fetchall()
        for n in netos:
            if abs(n['neto']) > 1e-9:
                self._mover_stock(con, n['insumo_id'], -n['neto'], tipo, hoy(), referencia, ref_tipo, ref_id)

    def movimientos(self, insumo_id):
        with self.conexion() as con:
            return [dict(r) for r in con.execute(
                'SELECT * FROM movimientos_inventario WHERE insumo_id = ? ORDER BY created_at DESC, rowid DESC',
                (insumo_id,))]

    def movimientos_todos(self):
        with self.conexion() as con:
            return [dict(r) for r in con.execute(
                'SELECT m.*, i.nombre AS insumo_nombre FROM movimientos_inventario m '
                'JOIN insumos i ON i.id = m.insumo_id ORDER BY m.fecha, m.created_at, m.rowid')]

    # ---------- Insumos ----------

    def _validar_insumo(self, datos):
        if datos.get('categoria') not in CATEGORIAS_INSUMO:
            raise ErrorDeDatos('Categoría de insumo inválida.')
        return {
            'nombre': self._texto_requerido(datos.get('nombre'), 'el nombre'),
            'categoria': datos['categoria'],
            'unidad_medida': self._texto_requerido(datos.get('unidad_medida'), 'la unidad de medida'),
            'costo_unitario': numero(datos.get('costo_unitario', 0), 'Costo unitario', 0),
            'stock_actual': numero(datos.get('stock_actual', 0), 'Stock actual'),
            'stock_minimo': numero(datos.get('stock_minimo', 0), 'Stock mínimo', 0),
        }

    def crear_insumo(self, datos):
        d = self._validar_insumo(datos)
        with self.conexion() as con:
            insumo_id = nuevo_id()
            con.execute('INSERT INTO insumos (id, nombre, categoria, unidad_medida, costo_unitario, stock_actual, stock_minimo) '
                        'VALUES (?, ?, ?, ?, ?, 0, ?)',
                        (insumo_id, d['nombre'], d['categoria'], d['unidad_medida'], r4(d['costo_unitario']), d['stock_minimo']))
            if d['stock_actual']:
                self._mover_stock(con, insumo_id, d['stock_actual'], 'Stock inicial', hoy())
            return insumo_id

    def actualizar_insumo(self, id_, datos):
        d = self._validar_insumo(datos)
        with self.conexion() as con:
            actual = con.execute('SELECT * FROM insumos WHERE id = ?', (id_,)).fetchone()
            if not actual:
                raise ErrorDeDatos('El insumo no existe.')
            con.execute('UPDATE insumos SET nombre = ?, categoria = ?, unidad_medida = ?, stock_minimo = ? WHERE id = ?',
                        (d['nombre'], d['categoria'], d['unidad_medida'], d['stock_minimo'], id_))
            if abs(d['costo_unitario'] - actual['costo_unitario']) > 1e-9:
                self._mover_stock(con, id_, 0, 'Cambio de costo', hoy(), nuevo_costo=d['costo_unitario'],
                                  nota=f"Antes: {actual['costo_unitario']:g}")
            diferencia = d['stock_actual'] - actual['stock_actual']
            if abs(diferencia) > 1e-9:
                self._mover_stock(con, id_, diferencia, 'Ajuste manual', hoy(), nota='Editado desde Inventario')

    def ajustar_stock(self, id_, datos):
        """Merma o ajuste de inventario registrado como movimiento propio."""
        tipo = datos.get('tipo')
        if tipo not in ('Merma', 'Ajuste'):
            raise ErrorDeDatos('Tipo de ajuste inválido.')
        cantidad = numero(datos.get('cantidad'), 'Cantidad')
        if cantidad == 0:
            raise ErrorDeDatos('La cantidad no puede ser cero.')
        if tipo == 'Merma':
            cantidad = -abs(cantidad)
        with self.conexion() as con:
            if not con.execute('SELECT 1 FROM insumos WHERE id = ?', (id_,)).fetchone():
                raise ErrorDeDatos('El insumo no existe.')
            self._mover_stock(con, id_, cantidad, tipo, datos.get('fecha') or hoy(), nota=datos.get('nota', ''))

    def borrar_insumo(self, id_):
        with self.conexion() as con:
            usados = [r['nombre'] for r in con.execute(
                'SELECT DISTINCT p.nombre FROM recetas_detalle r JOIN productos_finales p ON p.id = r.producto_id '
                'WHERE r.insumo_id = ? ORDER BY p.nombre', (id_,))]
            if usados:
                raise ErrorDeDatos('No se puede eliminar: se usa en la receta de ' + ', '.join(usados) +
                                   '. Quítalo primero de esas recetas.')
            con.execute('DELETE FROM insumos WHERE id = ?', (id_,))

    # ---------- Productos (con su receta) ----------

    def _guardar_receta(self, con, producto_id, receta):
        con.execute('DELETE FROM recetas_detalle WHERE producto_id = ?', (producto_id,))
        con.executemany(
            'INSERT INTO recetas_detalle (id, producto_id, insumo_id, cantidad_usada, porcentaje_merma) VALUES (?, ?, ?, ?, ?)',
            [(nuevo_id(), producto_id, r['insumo_id'], numero(r['cantidad'], 'Cantidad de receta', 0),
              numero(r.get('merma_pct') or 0, 'Merma', 0)) for r in receta],
        )

    def _validar_producto(self, datos):
        return {
            'nombre': self._texto_requerido(datos.get('nombre'), 'el nombre'),
            'categoria': (datos.get('categoria') or '').strip() or 'General',
            'precio_venta': numero(datos.get('precio_venta', 0), 'Precio de venta', 0),
        }

    def crear_producto(self, datos):
        with self.conexion() as con:
            producto_id = self._insertar(con, 'productos_finales', CAMPOS_PRODUCTO, self._validar_producto(datos))
            self._guardar_receta(con, producto_id, datos.get('receta', []))
            return producto_id

    def actualizar_producto(self, id_, datos):
        with self.conexion() as con:
            self._actualizar(con, 'productos_finales', CAMPOS_PRODUCTO, id_, self._validar_producto(datos))
            self._guardar_receta(con, id_, datos.get('receta', []))

    def borrar_producto(self, id_):
        # Las ventas y cotizaciones conservan el nombre del producto (columna producto_nombre).
        with self.conexion() as con:
            con.execute('DELETE FROM productos_finales WHERE id = ?', (id_,))

    def _costo_produccion(self, con, producto_id):
        fila = con.execute(
            'SELECT COALESCE(SUM(i.costo_unitario * r.cantidad_usada * (1 + r.porcentaje_merma / 100.0)), 0) AS costo '
            'FROM recetas_detalle r JOIN insumos i ON i.id = r.insumo_id WHERE r.producto_id = ?', (producto_id,)).fetchone()
        return r4(fila['costo'])

    # ---------- Clientes ----------

    def _validar_cliente(self, datos):
        d = {}
        for campo in CAMPOS_CLIENTE:
            valor = datos.get(campo)
            d[campo] = valor.strip() if isinstance(valor, str) else valor
        d['nombre'] = self._texto_requerido(d['nombre'], 'el nombre')
        d['fecha_especial'] = d['fecha_especial'] or None
        return d

    def crear_cliente(self, datos):
        with self.conexion() as con:
            return self._insertar(con, 'clientes', CAMPOS_CLIENTE, self._validar_cliente(datos))

    def actualizar_cliente(self, id_, datos):
        with self.conexion() as con:
            self._actualizar(con, 'clientes', CAMPOS_CLIENTE, id_, self._validar_cliente(datos))

    def borrar_cliente(self, id_):
        with self.conexion() as con:
            n = con.execute('SELECT COUNT(*) AS n FROM ventas WHERE cliente_id = ?', (id_,)).fetchone()['n']
            if n:
                raise ErrorDeDatos(f'No se puede eliminar: el cliente tiene {n} venta{"s" if n > 1 else ""} registrada{"s" if n > 1 else ""}.')
            con.execute('DELETE FROM clientes WHERE id = ?', (id_,))

    # ---------- Ventas ----------

    def _validar_detalle_venta(self, con, detalle):
        if not detalle:
            raise ErrorDeDatos('La venta no tiene productos.')
        lineas = []
        for item in detalle:
            producto = con.execute('SELECT id, nombre FROM productos_finales WHERE id = ?', (item.get('producto_id'),)).fetchone()
            if not producto:
                raise ErrorDeDatos('Uno de los productos ya no existe.')
            lineas.append({
                'producto_id': producto['id'],
                'producto_nombre': producto['nombre'],
                'cantidad': numero(item.get('cantidad'), 'Cantidad', 0.0001),
                'precio_unitario': numero(item.get('precio_unitario'), 'Precio', 0),
                'costo_unitario': self._costo_produccion(con, producto['id']),
            })
        return lineas

    def _guardar_detalle_venta(self, con, venta_id, folio, fecha, lineas):
        """Inserta las líneas y descuenta del stock los insumos de cada receta."""
        con.execute('DELETE FROM ventas_detalle WHERE venta_id = ?', (venta_id,))
        referencia = folio_txt('VEN', folio)
        for l in lineas:
            con.execute(
                'INSERT INTO ventas_detalle (id, venta_id, producto_id, producto_nombre, cantidad, precio_unitario, costo_unitario) '
                'VALUES (?, ?, ?, ?, ?, ?, ?)',
                (nuevo_id(), venta_id, l['producto_id'], l['producto_nombre'], l['cantidad'], l['precio_unitario'], l['costo_unitario']),
            )
            receta = con.execute(
                'SELECT insumo_id, cantidad_usada, porcentaje_merma FROM recetas_detalle WHERE producto_id = ?',
                (l['producto_id'],)).fetchall()
            for r in receta:
                consumo = r['cantidad_usada'] * (1 + r['porcentaje_merma'] / 100) * l['cantidad']
                self._mover_stock(con, r['insumo_id'], -consumo, 'Venta', fecha, referencia, 'venta', venta_id,
                                  nota=f"{l['cantidad']:g} x {l['producto_nombre']}")

    def _validar_cabecera_venta(self, con, datos):
        cliente_id = datos.get('cliente_id') or None
        if cliente_id and not con.execute('SELECT 1 FROM clientes WHERE id = ?', (cliente_id,)).fetchone():
            raise ErrorDeDatos('El cliente no existe.')
        tasa = datos.get('tasa')
        return {
            'cliente_id': cliente_id,
            'fecha': datos.get('fecha') or hoy(),
            'fecha_entrega': datos.get('fecha_entrega') or None,
            'notas': (datos.get('notas') or '').strip(),
            # Si no se indica, se guarda la tasa del día vigente.
            'tasa': numero(tasa, 'Tasa', 0.000001) if tasa not in (None, '') else self.tasa_vigente(con),
        }

    def registrar_venta(self, datos):
        estado = datos.get('estado') or 'Por Diseñar'
        if estado not in ESTADOS_PRODUCCION:
            raise ErrorDeDatos(f'Estado de producción inválido: {estado}')
        with self.conexion() as con:
            cab = self._validar_cabecera_venta(con, datos)
            lineas = self._validar_detalle_venta(con, datos.get('detalle'))
            venta_id = nuevo_id()
            folio = self._siguiente_folio(con, 'ventas')
            con.execute(
                'INSERT INTO ventas (id, folio, cliente_id, fecha, fecha_entrega, notas, estado_produccion, entregado_en, tasa) '
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (venta_id, folio, cab['cliente_id'], cab['fecha'], cab['fecha_entrega'], cab['notas'], estado,
                 hoy() if estado == 'Entregado' else None, cab['tasa']),
            )
            self._guardar_detalle_venta(con, venta_id, folio, cab['fecha'], lineas)

            abono = datos.get('abono') or {}
            # El abono puede venir en $ (monto) o en Bs (monto_original).
            if numero(abono.get('monto') or abono.get('monto_original') or 0, 'Abono', 0) > 0:
                self._registrar_pago(con, venta_id, {'fecha': cab['fecha'], **abono})

            if datos.get('cotizacion_id'):
                con.execute("UPDATE cotizaciones SET estado = 'Convertida', venta_id = ? WHERE id = ?",
                            (venta_id, datos['cotizacion_id']))
            return venta_id

    def actualizar_venta(self, id_, datos):
        """Edita cabecera y productos. El stock se corrige: se revierte lo que la venta
        había descontado y se descuenta de nuevo según los productos actuales."""
        with self.conexion() as con:
            venta = con.execute('SELECT * FROM ventas WHERE id = ?', (id_,)).fetchone()
            if not venta:
                raise ErrorDeDatos('La venta no existe.')
            cab = self._validar_cabecera_venta(con, datos)
            lineas = self._validar_detalle_venta(con, datos.get('detalle'))
            total = sum(l['cantidad'] * l['precio_unitario'] for l in lineas)
            pagado = con.execute('SELECT COALESCE(SUM(monto), 0) AS p FROM pagos WHERE venta_id = ?', (id_,)).fetchone()['p']
            if pagado > total + 0.005:
                raise ErrorDeDatos('El nuevo total es menor que lo ya abonado. Elimina primero algún abono.')
            con.execute('UPDATE ventas SET cliente_id = ?, fecha = ?, fecha_entrega = ?, notas = ?, tasa = ? WHERE id = ?',
                        (cab['cliente_id'], cab['fecha'], cab['fecha_entrega'], cab['notas'],
                         cab['tasa'] if datos.get('tasa') not in (None, '') else venta['tasa'], id_))
            referencia = folio_txt('VEN', venta['folio'])
            self._revertir_movimientos(con, 'venta', id_, 'Edición de venta', referencia)
            self._guardar_detalle_venta(con, id_, venta['folio'], cab['fecha'], lineas)

    def actualizar_estado_venta(self, id_, estado):
        if estado not in ESTADOS_PRODUCCION:
            raise ErrorDeDatos(f'Estado de producción inválido: {estado}')
        with self.conexion() as con:
            con.execute('UPDATE ventas SET estado_produccion = ?, '
                        'entregado_en = CASE WHEN ? = \'Entregado\' THEN COALESCE(entregado_en, ?) ELSE NULL END '
                        'WHERE id = ?', (estado, estado, hoy(), id_))

    def borrar_venta(self, id_):
        """Anula la venta: devuelve al stock lo que había descontado y la elimina."""
        with self.conexion() as con:
            venta = con.execute('SELECT folio FROM ventas WHERE id = ?', (id_,)).fetchone()
            if not venta:
                return
            self._revertir_movimientos(con, 'venta', id_, 'Anulación de venta', folio_txt('VEN', venta['folio']))
            con.execute("UPDATE cotizaciones SET estado = 'Pendiente', venta_id = NULL WHERE venta_id = ?", (id_,))
            con.execute('DELETE FROM ventas WHERE id = ?', (id_,))
        shutil.rmtree(self.carpeta_adjuntos / id_, ignore_errors=True)

    # ---------- Pagos / abonos ----------

    def _registrar_pago(self, con, venta_id, datos):
        moneda = datos.get('moneda') or 'USD'
        if moneda not in MONEDAS_PAGO:
            raise ErrorDeDatos('Moneda de pago inválida.')
        monto_original = None
        tasa = None
        if moneda == 'VES':
            # El cliente pagó en bolívares: se convierte a $ con la tasa indicada (o la del día).
            monto_original = numero(datos.get('monto_original'), 'Monto en Bs', 0)
            tasa = numero(datos.get('tasa') or self.tasa_vigente(con) or 0, 'Tasa', 0)
            if tasa <= 0:
                raise ErrorDeDatos('Para registrar un pago en bolívares carga primero la tasa del día.')
            monto = round(monto_original / tasa, 2)
        else:
            monto = numero(datos.get('monto'), 'Monto', 0)
        if monto <= 0:
            raise ErrorDeDatos('El monto debe ser mayor que cero.')
        metodo = datos.get('metodo') or 'Efectivo'
        if metodo not in METODOS_PAGO:
            raise ErrorDeDatos('Método de pago inválido.')
        total = con.execute('SELECT COALESCE(SUM(cantidad * precio_unitario), 0) AS t FROM ventas_detalle WHERE venta_id = ?',
                            (venta_id,)).fetchone()['t']
        pagado = con.execute('SELECT COALESCE(SUM(monto), 0) AS p FROM pagos WHERE venta_id = ?', (venta_id,)).fetchone()['p']
        saldo = round(total - pagado, 2)
        if moneda == 'VES' and monto > saldo and monto - saldo <= 0.01:
            monto = saldo  # diferencia de redondeo al convertir de Bs
        if monto > saldo + 0.005:
            raise ErrorDeDatos(f'El abono supera el saldo pendiente ({saldo:.2f}).')
        pago_id = nuevo_id()
        con.execute('INSERT INTO pagos (id, venta_id, fecha, monto, metodo, nota, moneda, monto_original, tasa) '
                    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    (pago_id, venta_id, datos.get('fecha') or hoy(), round(monto, 2), metodo, (datos.get('nota') or '').strip(),
                     moneda, monto_original, tasa))
        return pago_id

    def registrar_pago(self, venta_id, datos):
        with self.conexion() as con:
            if not con.execute('SELECT 1 FROM ventas WHERE id = ?', (venta_id,)).fetchone():
                raise ErrorDeDatos('La venta no existe.')
            return self._registrar_pago(con, venta_id, datos)

    def borrar_pago(self, id_):
        with self.conexion() as con:
            con.execute('DELETE FROM pagos WHERE id = ?', (id_,))

    # ---------- Adjuntos ----------

    def crear_adjunto(self, venta_id, tipo, url, nombre):
        with self.conexion() as con:
            adjunto_id = nuevo_id()
            con.execute(
                'INSERT INTO venta_adjuntos (id, venta_id, tipo, url, nombre) VALUES (?, ?, ?, ?, ?)',
                (adjunto_id, venta_id, tipo, url, nombre),
            )
            return adjunto_id

    def guardar_imagen_adjunta(self, venta_id, contenido: bytes, nombre_original):
        """Guarda la imagen en datos/adjuntos/<venta_id>/ y registra el adjunto."""
        with self.conexion() as con:
            if not con.execute('SELECT 1 FROM ventas WHERE id = ?', (venta_id,)).fetchone():
                raise ErrorDeDatos('La venta no existe.')
        carpeta = self.carpeta_adjuntos / venta_id
        carpeta.mkdir(parents=True, exist_ok=True)
        archivo = f'{nuevo_id()}.jpg'
        (carpeta / archivo).write_bytes(contenido)
        return self.crear_adjunto(venta_id, 'imagen', f'adjuntos/{venta_id}/{archivo}', nombre_original)

    def borrar_adjunto(self, id_):
        with self.conexion() as con:
            fila = con.execute('SELECT tipo, url FROM venta_adjuntos WHERE id = ?', (id_,)).fetchone()
            con.execute('DELETE FROM venta_adjuntos WHERE id = ?', (id_,))
        if fila and fila['tipo'] == 'imagen' and fila['url'].startswith('adjuntos/'):
            ruta = (self.carpeta / fila['url']).resolve()
            if self.carpeta_adjuntos.resolve() in ruta.parents:
                ruta.unlink(missing_ok=True)

    # ---------- Compras ----------

    def _validar_compra(self, con, datos):
        items = datos.get('items') or []
        if not items:
            raise ErrorDeDatos('La compra no tiene insumos.')
        lineas = []
        for item in items:
            insumo = con.execute('SELECT id, nombre FROM insumos WHERE id = ?', (item.get('insumo_id'),)).fetchone()
            if not insumo:
                raise ErrorDeDatos('Uno de los insumos ya no existe.')
            lineas.append({'insumo_id': insumo['id'], 'insumo_nombre': insumo['nombre'],
                           'cantidad': numero(item.get('cantidad'), 'Cantidad', 0.0001),
                           'costo_unitario': numero(item.get('costo_unitario'), 'Costo', 0)})
        return {
            'proveedor': self._texto_requerido(datos.get('proveedor'), 'el proveedor'),
            'fecha': datos.get('fecha') or hoy(),
            'lineas': lineas,
        }

    def _aplicar_compra(self, con, compra_id, folio, c):
        """Inserta las líneas, suma stock y recalcula el costo promedio ponderado."""
        con.execute('DELETE FROM compras_detalle WHERE compra_id = ?', (compra_id,))
        for l in c['lineas']:
            con.execute(
                'INSERT INTO compras_detalle (id, compra_id, insumo_id, insumo_nombre, cantidad, costo_unitario) VALUES (?, ?, ?, ?, ?, ?)',
                (nuevo_id(), compra_id, l['insumo_id'], l['insumo_nombre'], l['cantidad'], l['costo_unitario']))
            insumo = con.execute('SELECT costo_unitario, stock_actual FROM insumos WHERE id = ?', (l['insumo_id'],)).fetchone()
            stock_total = insumo['stock_actual'] + l['cantidad']
            if insumo['stock_actual'] > 0 and stock_total > 0:
                nuevo_costo = (insumo['costo_unitario'] * insumo['stock_actual'] + l['costo_unitario'] * l['cantidad']) / stock_total
            else:
                # Sin stock previo (o stock negativo), el costo de la compra es el nuevo costo.
                nuevo_costo = l['costo_unitario']
            self._mover_stock(con, l['insumo_id'], l['cantidad'], 'Compra', c['fecha'], folio_txt('COM', folio),
                              'compra', compra_id, nota=c['proveedor'], costo_unitario=l['costo_unitario'],
                              nuevo_costo=nuevo_costo)

    def _revertir_compra(self, con, compra_id, folio, tipo):
        """Quita del stock lo que entró con la compra y deshace el promedio ponderado."""
        lineas = con.execute('SELECT insumo_id, cantidad, costo_unitario FROM compras_detalle WHERE compra_id = ?',
                             (compra_id,)).fetchall()
        for l in lineas:
            insumo = con.execute('SELECT costo_unitario, stock_actual FROM insumos WHERE id = ?', (l['insumo_id'],)).fetchone()
            if not insumo:
                continue
            stock_previo = insumo['stock_actual'] - l['cantidad']
            costo_previo = insumo['costo_unitario']
            if stock_previo > 0:
                calculado = (insumo['costo_unitario'] * insumo['stock_actual'] - l['costo_unitario'] * l['cantidad']) / stock_previo
                if calculado > 0:
                    costo_previo = calculado
            self._mover_stock(con, l['insumo_id'], -l['cantidad'], tipo, hoy(), folio_txt('COM', folio),
                              'compra', compra_id, costo_unitario=l['costo_unitario'], nuevo_costo=costo_previo)

    def registrar_compra(self, datos):
        with self.conexion() as con:
            c = self._validar_compra(con, datos)
            compra_id = nuevo_id()
            folio = self._siguiente_folio(con, 'compras')
            con.execute('INSERT INTO compras (id, folio, proveedor, fecha) VALUES (?, ?, ?, ?)',
                        (compra_id, folio, c['proveedor'], c['fecha']))
            self._aplicar_compra(con, compra_id, folio, c)
            return compra_id

    def actualizar_compra(self, id_, datos):
        with self.conexion() as con:
            compra = con.execute('SELECT folio FROM compras WHERE id = ?', (id_,)).fetchone()
            if not compra:
                raise ErrorDeDatos('La compra no existe.')
            c = self._validar_compra(con, datos)
            self._revertir_compra(con, id_, compra['folio'], 'Edición de compra')
            con.execute('UPDATE compras SET proveedor = ?, fecha = ? WHERE id = ?', (c['proveedor'], c['fecha'], id_))
            self._aplicar_compra(con, id_, compra['folio'], c)

    def borrar_compra(self, id_):
        with self.conexion() as con:
            compra = con.execute('SELECT folio FROM compras WHERE id = ?', (id_,)).fetchone()
            if not compra:
                return
            self._revertir_compra(con, id_, compra['folio'], 'Anulación de compra')
            con.execute('DELETE FROM compras WHERE id = ?', (id_,))

    # ---------- Cotizaciones ----------

    def _validar_cotizacion(self, con, datos):
        items = datos.get('items') or []
        if not items:
            raise ErrorDeDatos('La cotización no tiene productos.')
        lineas = []
        for item in items:
            producto = con.execute('SELECT id, nombre FROM productos_finales WHERE id = ?', (item.get('producto_id'),)).fetchone()
            nombre = (item.get('producto_nombre') or (producto['nombre'] if producto else '')).strip()
            if not nombre:
                raise ErrorDeDatos('Falta la descripción de un producto.')
            lineas.append((producto['id'] if producto else None, nombre,
                           numero(item.get('cantidad'), 'Cantidad', 0.0001), numero(item.get('precio_unitario'), 'Precio', 0)))
        cliente_id = datos.get('cliente_id') or None
        cliente_nombre = (datos.get('cliente_nombre') or '').strip()
        if cliente_id:
            cliente = con.execute('SELECT nombre FROM clientes WHERE id = ?', (cliente_id,)).fetchone()
            if not cliente:
                raise ErrorDeDatos('El cliente no existe.')
            cliente_nombre = cliente['nombre']
        tasa = datos.get('tasa')
        return {
            'tasa': numero(tasa, 'Tasa', 0.000001) if tasa not in (None, '') else self.tasa_vigente(con),
            'cliente_id': cliente_id, 'cliente_nombre': cliente_nombre,
            'fecha': datos.get('fecha') or hoy(),
            'validez_dias': int(numero(datos.get('validez_dias') or 15, 'Validez', 1)),
            'notas': (datos.get('notas') or '').strip(),
            'lineas': lineas,
        }

    def _guardar_lineas_cotizacion(self, con, cot_id, lineas):
        con.execute('DELETE FROM cotizaciones_detalle WHERE cotizacion_id = ?', (cot_id,))
        con.executemany(
            'INSERT INTO cotizaciones_detalle (id, cotizacion_id, producto_id, producto_nombre, cantidad, precio_unitario) '
            'VALUES (?, ?, ?, ?, ?, ?)', [(nuevo_id(), cot_id, *l) for l in lineas])

    def crear_cotizacion(self, datos):
        with self.conexion() as con:
            c = self._validar_cotizacion(con, datos)
            cot_id = nuevo_id()
            folio = self._siguiente_folio(con, 'cotizaciones')
            con.execute('INSERT INTO cotizaciones (id, folio, cliente_id, cliente_nombre, fecha, validez_dias, notas, tasa) '
                        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                        (cot_id, folio, c['cliente_id'], c['cliente_nombre'], c['fecha'], c['validez_dias'], c['notas'], c['tasa']))
            self._guardar_lineas_cotizacion(con, cot_id, c['lineas'])
            return cot_id

    def actualizar_cotizacion(self, id_, datos):
        with self.conexion() as con:
            c = self._validar_cotizacion(con, datos)
            con.execute('UPDATE cotizaciones SET cliente_id = ?, cliente_nombre = ?, fecha = ?, validez_dias = ?, notas = ?, tasa = ? WHERE id = ?',
                        (c['cliente_id'], c['cliente_nombre'], c['fecha'], c['validez_dias'], c['notas'], c['tasa'], id_))
            self._guardar_lineas_cotizacion(con, id_, c['lineas'])

    def borrar_cotizacion(self, id_):
        with self.conexion() as con:
            con.execute('DELETE FROM cotizaciones WHERE id = ?', (id_,))

    # ---------- Gastos generales ----------

    def _validar_gasto(self, datos):
        return {
            'fecha': datos.get('fecha') or hoy(),
            'categoria': self._texto_requerido(datos.get('categoria'), 'la categoría'),
            'descripcion': (datos.get('descripcion') or '').strip(),
            'monto': numero(datos.get('monto'), 'Monto', 0.01),
        }

    def crear_gasto(self, datos):
        with self.conexion() as con:
            return self._insertar(con, 'gastos', CAMPOS_GASTO, self._validar_gasto(datos))

    def actualizar_gasto(self, id_, datos):
        with self.conexion() as con:
            self._actualizar(con, 'gastos', CAMPOS_GASTO, id_, self._validar_gasto(datos))

    def borrar_gasto(self, id_):
        with self.conexion() as con:
            con.execute('DELETE FROM gastos WHERE id = ?', (id_,))

    # ---------- Mantenimiento ----------

    def borrar_todos_los_datos(self):
        """Deja la base vacía y los folios en cero. Conserva la configuración del negocio."""
        with self.conexion() as con:
            for tabla in ('pagos', 'ventas_detalle', 'venta_adjuntos', 'ventas', 'compras_detalle', 'compras',
                          'cotizaciones_detalle', 'cotizaciones', 'gastos', 'movimientos_inventario',
                          'recetas_detalle', 'productos_finales', 'clientes', 'insumos'):
                con.execute(f'DELETE FROM {tabla}')
            con.execute('UPDATE contadores SET valor = 0')
        shutil.rmtree(self.carpeta_adjuntos, ignore_errors=True)
        self.carpeta_adjuntos.mkdir(exist_ok=True)
