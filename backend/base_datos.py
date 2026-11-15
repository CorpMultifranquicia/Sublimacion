"""
base_datos.py — Todo el acceso a SQLite de SubliApp.

Un solo archivo de base de datos (subliapp.db) dentro de la carpeta de datos.
Aquí viven:
  - el esquema de tablas (se crea solo la primera vez),
  - la lectura completa del estado que consume el frontend,
  - las operaciones de escritura, incluidas las dos con lógica de negocio:
      registrar_venta  -> descuenta stock según la receta de cada producto
      registrar_compra -> suma stock y recalcula el costo promedio ponderado
    Ambas corren dentro de una transacción: o se guarda todo, o nada.
"""

import shutil
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path

ESTADOS_PRODUCCION = ('Por Diseñar', 'Imprimiendo', 'Listo/Entregado')
CATEGORIAS_INSUMO = ('Consumible', 'Sustrato')

ESQUEMA = """
CREATE TABLE IF NOT EXISTS insumos (
    id              TEXT PRIMARY KEY,
    nombre          TEXT NOT NULL,
    categoria       TEXT NOT NULL CHECK (categoria IN ('Consumible', 'Sustrato')),
    unidad_medida   TEXT NOT NULL,
    costo_unitario  REAL NOT NULL DEFAULT 0,
    stock_actual    REAL NOT NULL DEFAULT 0,
    stock_minimo    REAL NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS productos_finales (
    id            TEXT PRIMARY KEY,
    nombre        TEXT NOT NULL,
    categoria     TEXT NOT NULL,
    precio_venta  REAL NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recetas_detalle (
    id                TEXT PRIMARY KEY,
    producto_id       TEXT NOT NULL REFERENCES productos_finales(id) ON DELETE CASCADE,
    insumo_id         TEXT NOT NULL REFERENCES insumos(id) ON DELETE CASCADE,
    cantidad_usada    REAL NOT NULL,
    porcentaje_merma  REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS clientes (
    id              TEXT PRIMARY KEY,
    nombre          TEXT NOT NULL,
    telefono        TEXT,
    email           TEXT,
    fecha_especial  TEXT,
    tipo_fecha      TEXT,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ventas (
    id                 TEXT PRIMARY KEY,
    folio              INTEGER NOT NULL,
    cliente_id         TEXT REFERENCES clientes(id) ON DELETE SET NULL,
    fecha              TEXT NOT NULL,
    estado_produccion  TEXT NOT NULL DEFAULT 'Por Diseñar'
        CHECK (estado_produccion IN ('Por Diseñar', 'Imprimiendo', 'Listo/Entregado')),
    created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ventas_detalle (
    id               TEXT PRIMARY KEY,
    venta_id         TEXT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
    producto_id      TEXT REFERENCES productos_finales(id) ON DELETE SET NULL,
    cantidad         REAL NOT NULL,
    precio_unitario  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS venta_adjuntos (
    id          TEXT PRIMARY KEY,
    venta_id    TEXT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
    tipo        TEXT NOT NULL CHECK (tipo IN ('imagen', 'enlace')),
    url         TEXT NOT NULL,
    nombre      TEXT,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS compras (
    id          TEXT PRIMARY KEY,
    folio       INTEGER NOT NULL,
    proveedor   TEXT NOT NULL,
    fecha       TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS compras_detalle (
    id              TEXT PRIMARY KEY,
    compra_id       TEXT NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
    insumo_id       TEXT REFERENCES insumos(id) ON DELETE SET NULL,
    cantidad        REAL NOT NULL,
    costo_unitario  REAL NOT NULL
);

-- Folios correlativos de ventas y compras. Nunca se reutilizan,
-- aunque se borre la última venta/compra.
CREATE TABLE IF NOT EXISTS contadores (
    nombre  TEXT PRIMARY KEY,
    valor   INTEGER NOT NULL
);
INSERT OR IGNORE INTO contadores (nombre, valor) VALUES ('ventas', 0), ('compras', 0);
"""

# Campos que el frontend puede escribir en cada tabla (todo lo demás se ignora).
CAMPOS_INSUMO = ('nombre', 'categoria', 'unidad_medida', 'costo_unitario', 'stock_actual', 'stock_minimo')
CAMPOS_PRODUCTO = ('nombre', 'categoria', 'precio_venta')
CAMPOS_CLIENTE = ('nombre', 'telefono', 'email', 'fecha_especial', 'tipo_fecha')


class ErrorDeDatos(ValueError):
    """Error de validación que se le muestra tal cual al usuario."""


def nuevo_id():
    return str(uuid.uuid4())


class BaseDatos:
    def __init__(self, carpeta_datos: Path):
        self.carpeta = Path(carpeta_datos)
        self.carpeta.mkdir(parents=True, exist_ok=True)
        self.ruta = self.carpeta / 'subliapp.db'
        self.carpeta_adjuntos = self.carpeta / 'adjuntos'
        self.carpeta_adjuntos.mkdir(exist_ok=True)
        with self.conexion() as con:
            con.executescript(ESQUEMA)

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

    # ---------- Respaldo automático ----------

    def respaldar(self, conservar=30):
        """Copia diaria: respaldos/subliapp_AAAA-MM-DD.db (solo la primera vez del día).
        Conserva las últimas `conservar` copias diarias y borra las más antiguas."""
        destino = self.carpeta / 'respaldos' / f'subliapp_{date.today().isoformat()}.db'
        if not destino.exists():
            self._copiar_base(destino)
        diarios = sorted((self.carpeta / 'respaldos').glob('subliapp_????-??-??.db'))
        for viejo in diarios[:-conservar]:
            viejo.unlink()

    def respaldar_antes_de_borrar(self):
        """Copia con fecha y hora que no se borra automáticamente."""
        destino = self.carpeta / 'respaldos' / f'antes_de_borrar_{datetime.now():%Y-%m-%d_%H%M%S}.db'
        self._copiar_base(destino)
        return destino

    def _copiar_base(self, destino: Path):
        destino.parent.mkdir(exist_ok=True)
        origen = sqlite3.connect(self.ruta)
        copia = sqlite3.connect(destino)
        with copia:
            origen.backup(copia)
        origen.close()
        copia.close()

    # ---------- Lectura completa (lo que el frontend carga en memoria) ----------

    def estado(self):
        with self.conexion() as con:
            q = lambda sql: [dict(r) for r in con.execute(sql)]
            insumos = q('SELECT * FROM insumos ORDER BY nombre COLLATE NOCASE')
            productos = q('SELECT * FROM productos_finales ORDER BY nombre COLLATE NOCASE')
            recetas = q('SELECT * FROM recetas_detalle')
            clientes = q('SELECT * FROM clientes ORDER BY nombre COLLATE NOCASE')
            ventas = q('SELECT * FROM ventas ORDER BY fecha DESC, folio DESC')
            ventas_detalle = q('SELECT * FROM ventas_detalle')
            adjuntos = q('SELECT * FROM venta_adjuntos ORDER BY created_at')
            compras = q('SELECT * FROM compras ORDER BY fecha DESC, folio DESC')
            compras_detalle = q('SELECT * FROM compras_detalle')

        return {
            'insumos': insumos,
            'clientes': clientes,
            'productos': [{
                **p,
                'receta': [{'insumo_id': r['insumo_id'], 'cantidad': r['cantidad_usada'], 'merma_pct': r['porcentaje_merma']}
                           for r in recetas if r['producto_id'] == p['id']],
            } for p in productos],
            'ventas': [{
                'id': v['id'],
                'folio': v['folio'],
                'cliente_id': v['cliente_id'],
                'fecha': v['fecha'],
                'estado': v['estado_produccion'],
                'detalle': [{'producto_id': d['producto_id'], 'cantidad': d['cantidad'], 'precio_unitario': d['precio_unitario']}
                            for d in ventas_detalle if d['venta_id'] == v['id']],
                'adjuntos': [{'id': a['id'], 'tipo': a['tipo'], 'url': a['url'], 'nombre': a['nombre']}
                             for a in adjuntos if a['venta_id'] == v['id']],
            } for v in ventas],
            'compras': [{
                'id': c['id'],
                'folio': c['folio'],
                'proveedor': c['proveedor'],
                'fecha': c['fecha'],
                'items': [{'insumo_id': i['insumo_id'], 'cantidad': i['cantidad'], 'costo_unitario': i['costo_unitario']}
                          for i in compras_detalle if i['compra_id'] == c['id']],
            } for c in compras],
        }

    # ---------- CRUD genérico para tablas simples ----------

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

    def _borrar(self, con, tabla, id_):
        con.execute(f'DELETE FROM {tabla} WHERE id = ?', (id_,))

    # ---------- Insumos ----------

    def crear_insumo(self, datos):
        with self.conexion() as con:
            return self._insertar(con, 'insumos', CAMPOS_INSUMO, datos)

    def actualizar_insumo(self, id_, datos):
        with self.conexion() as con:
            self._actualizar(con, 'insumos', CAMPOS_INSUMO, id_, datos)

    def borrar_insumo(self, id_):
        with self.conexion() as con:
            self._borrar(con, 'insumos', id_)

    # ---------- Productos (con su receta) ----------

    def _guardar_receta(self, con, producto_id, receta):
        con.execute('DELETE FROM recetas_detalle WHERE producto_id = ?', (producto_id,))
        con.executemany(
            'INSERT INTO recetas_detalle (id, producto_id, insumo_id, cantidad_usada, porcentaje_merma) VALUES (?, ?, ?, ?, ?)',
            [(nuevo_id(), producto_id, r['insumo_id'], r['cantidad'], r.get('merma_pct') or 0) for r in receta],
        )

    def crear_producto(self, datos):
        with self.conexion() as con:
            producto_id = self._insertar(con, 'productos_finales', CAMPOS_PRODUCTO, datos)
            self._guardar_receta(con, producto_id, datos.get('receta', []))
            return producto_id

    def actualizar_producto(self, id_, datos):
        with self.conexion() as con:
            self._actualizar(con, 'productos_finales', CAMPOS_PRODUCTO, id_, datos)
            self._guardar_receta(con, id_, datos.get('receta', []))

    def borrar_producto(self, id_):
        with self.conexion() as con:
            self._borrar(con, 'productos_finales', id_)

    # ---------- Clientes ----------

    def crear_cliente(self, datos):
        with self.conexion() as con:
            return self._insertar(con, 'clientes', CAMPOS_CLIENTE, datos)

    def actualizar_cliente(self, id_, datos):
        with self.conexion() as con:
            self._actualizar(con, 'clientes', CAMPOS_CLIENTE, id_, datos)

    def borrar_cliente(self, id_):
        with self.conexion() as con:
            self._borrar(con, 'clientes', id_)

    # ---------- Folios ----------

    def _siguiente_folio(self, con, nombre):
        con.execute('UPDATE contadores SET valor = valor + 1 WHERE nombre = ?', (nombre,))
        return con.execute('SELECT valor FROM contadores WHERE nombre = ?', (nombre,)).fetchone()['valor']

    # ---------- Ventas ----------

    def registrar_venta(self, cliente_id, fecha, estado, detalle):
        """Crea la venta y descuenta del stock los insumos de la receta de cada
        producto vendido (cantidad usada x (1 + merma%) x unidades vendidas)."""
        estado = estado or 'Por Diseñar'
        if estado not in ESTADOS_PRODUCCION:
            raise ErrorDeDatos(f'Estado de producción inválido: {estado}')
        if not detalle:
            raise ErrorDeDatos('La venta no tiene productos.')

        with self.conexion() as con:
            venta_id = nuevo_id()
            folio = self._siguiente_folio(con, 'ventas')
            con.execute(
                'INSERT INTO ventas (id, folio, cliente_id, fecha, estado_produccion) VALUES (?, ?, ?, ?, ?)',
                (venta_id, folio, cliente_id or None, fecha or date.today().isoformat(), estado),
            )
            for item in detalle:
                cantidad = float(item['cantidad'])
                con.execute(
                    'INSERT INTO ventas_detalle (id, venta_id, producto_id, cantidad, precio_unitario) VALUES (?, ?, ?, ?, ?)',
                    (nuevo_id(), venta_id, item['producto_id'], cantidad, float(item['precio_unitario'])),
                )
                receta = con.execute(
                    'SELECT insumo_id, cantidad_usada, porcentaje_merma FROM recetas_detalle WHERE producto_id = ?',
                    (item['producto_id'],),
                ).fetchall()
                for r in receta:
                    consumo = r['cantidad_usada'] * (1 + r['porcentaje_merma'] / 100) * cantidad
                    con.execute('UPDATE insumos SET stock_actual = ROUND(stock_actual - ?, 4) WHERE id = ?', (consumo, r['insumo_id']))
            return venta_id

    def actualizar_estado_venta(self, id_, estado):
        if estado not in ESTADOS_PRODUCCION:
            raise ErrorDeDatos(f'Estado de producción inválido: {estado}')
        with self.conexion() as con:
            con.execute('UPDATE ventas SET estado_produccion = ? WHERE id = ?', (estado, id_))

    def borrar_venta(self, id_):
        with self.conexion() as con:
            self._borrar(con, 'ventas', id_)
        # Las filas de adjuntos se van solas (ON DELETE CASCADE); las imágenes en disco, aquí.
        shutil.rmtree(self.carpeta_adjuntos / id_, ignore_errors=True)

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
            self._borrar(con, 'venta_adjuntos', id_)
        if fila and fila['tipo'] == 'imagen' and fila['url'].startswith('adjuntos/'):
            ruta = (self.carpeta / fila['url']).resolve()
            if self.carpeta_adjuntos.resolve() in ruta.parents:
                ruta.unlink(missing_ok=True)

    # ---------- Compras ----------

    def registrar_compra(self, proveedor, fecha, items):
        """Crea la compra, suma el stock y recalcula el costo unitario de cada
        insumo como promedio ponderado entre lo que había y lo que entra."""
        if not (proveedor or '').strip():
            raise ErrorDeDatos('Falta el proveedor.')
        if not items:
            raise ErrorDeDatos('La compra no tiene insumos.')

        with self.conexion() as con:
            compra_id = nuevo_id()
            folio = self._siguiente_folio(con, 'compras')
            con.execute(
                'INSERT INTO compras (id, folio, proveedor, fecha) VALUES (?, ?, ?, ?)',
                (compra_id, folio, proveedor, fecha or date.today().isoformat()),
            )
            for item in items:
                cantidad = float(item['cantidad'])
                costo = float(item['costo_unitario'])
                con.execute(
                    'INSERT INTO compras_detalle (id, compra_id, insumo_id, cantidad, costo_unitario) VALUES (?, ?, ?, ?, ?)',
                    (nuevo_id(), compra_id, item['insumo_id'], cantidad, costo),
                )
                insumo = con.execute('SELECT costo_unitario, stock_actual FROM insumos WHERE id = ?', (item['insumo_id'],)).fetchone()
                if insumo:
                    stock_total = insumo['stock_actual'] + cantidad
                    if stock_total > 0:
                        nuevo_costo = (insumo['costo_unitario'] * insumo['stock_actual'] + costo * cantidad) / stock_total
                    else:
                        nuevo_costo = insumo['costo_unitario']
                    con.execute('UPDATE insumos SET costo_unitario = ?, stock_actual = ? WHERE id = ?',
                                (round(nuevo_costo, 4), round(stock_total, 4), item['insumo_id']))
            return compra_id

    # ---------- Mantenimiento ----------

    def borrar_todos_los_datos(self):
        """Deja la base vacía y los folios en cero (equivale al antiguo reset_datos_prueba.sql)."""
        with self.conexion() as con:
            for tabla in ('ventas_detalle', 'venta_adjuntos', 'ventas', 'compras_detalle', 'compras',
                          'recetas_detalle', 'productos_finales', 'clientes', 'insumos'):
                con.execute(f'DELETE FROM {tabla}')
            con.execute('UPDATE contadores SET valor = 0')
        shutil.rmtree(self.carpeta_adjuntos, ignore_errors=True)
        self.carpeta_adjuntos.mkdir(exist_ok=True)
