"""
esquema.py — Estructura de la base de datos y sus migraciones.

La versión del esquema se guarda en `PRAGMA user_version`.
  - Base nueva: se crea directamente con la versión actual (ESQUEMA).
  - Base vieja: se aplican en orden las migraciones pendientes (MIGRACIONES).

Para cambiar la estructura en el futuro:
  1. Actualiza ESQUEMA (así quedan las bases nuevas).
  2. Agrega una función migrar_a_N al final y súmala a MIGRACIONES
     (así se actualizan las bases que ya tienen datos). Sube VERSION.
Antes de migrar se guarda una copia en respaldos/antes_de_migrar_vN.db.
"""

import sqlite3
from pathlib import Path

VERSION = 2

ESQUEMA = """
CREATE TABLE insumos (
    id              TEXT PRIMARY KEY,
    nombre          TEXT NOT NULL,
    categoria       TEXT NOT NULL,
    unidad_medida   TEXT NOT NULL,
    costo_unitario  REAL NOT NULL DEFAULT 0,
    stock_actual    REAL NOT NULL DEFAULT 0,
    stock_minimo    REAL NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE productos_finales (
    id            TEXT PRIMARY KEY,
    nombre        TEXT NOT NULL,
    categoria     TEXT NOT NULL,
    precio_venta  REAL NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE recetas_detalle (
    id                TEXT PRIMARY KEY,
    producto_id       TEXT NOT NULL REFERENCES productos_finales(id) ON DELETE CASCADE,
    insumo_id         TEXT NOT NULL REFERENCES insumos(id) ON DELETE CASCADE,
    cantidad_usada    REAL NOT NULL,
    porcentaje_merma  REAL NOT NULL DEFAULT 0
);

CREATE TABLE clientes (
    id              TEXT PRIMARY KEY,
    nombre          TEXT NOT NULL,
    telefono        TEXT,
    email           TEXT,
    fecha_especial  TEXT,
    tipo_fecha      TEXT,
    notas           TEXT,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ventas (
    id                 TEXT PRIMARY KEY,
    folio              INTEGER NOT NULL,
    cliente_id         TEXT REFERENCES clientes(id) ON DELETE SET NULL,  -- NULL = venta de mostrador
    fecha              TEXT NOT NULL,
    fecha_entrega      TEXT,          -- fecha comprometida con el cliente
    entregado_en       TEXT,          -- cuándo pasó a "Entregado"
    notas              TEXT,
    estado_produccion  TEXT NOT NULL DEFAULT 'Por Diseñar',
    created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ventas_detalle (
    id               TEXT PRIMARY KEY,
    venta_id         TEXT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
    producto_id      TEXT REFERENCES productos_finales(id) ON DELETE SET NULL,
    producto_nombre  TEXT NOT NULL DEFAULT '',   -- copia del nombre al momento de vender
    cantidad         REAL NOT NULL,
    precio_unitario  REAL NOT NULL,
    costo_unitario   REAL NOT NULL DEFAULT 0     -- costo de producción al momento de vender
);

CREATE TABLE pagos (
    id          TEXT PRIMARY KEY,
    venta_id    TEXT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
    fecha       TEXT NOT NULL,
    monto       REAL NOT NULL,
    metodo      TEXT NOT NULL,
    nota        TEXT,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE venta_adjuntos (
    id          TEXT PRIMARY KEY,
    venta_id    TEXT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
    tipo        TEXT NOT NULL CHECK (tipo IN ('imagen', 'enlace')),
    url         TEXT NOT NULL,
    nombre      TEXT,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE compras (
    id          TEXT PRIMARY KEY,
    folio       INTEGER NOT NULL,
    proveedor   TEXT NOT NULL,
    fecha       TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE compras_detalle (
    id              TEXT PRIMARY KEY,
    compra_id       TEXT NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
    insumo_id       TEXT REFERENCES insumos(id) ON DELETE SET NULL,
    insumo_nombre   TEXT NOT NULL DEFAULT '',
    cantidad        REAL NOT NULL,
    costo_unitario  REAL NOT NULL
);

-- Kárdex: cada cambio de stock o de costo de un insumo, con su motivo.
CREATE TABLE movimientos_inventario (
    id                TEXT PRIMARY KEY,
    insumo_id         TEXT NOT NULL REFERENCES insumos(id) ON DELETE CASCADE,
    fecha             TEXT NOT NULL,
    tipo              TEXT NOT NULL,   -- Stock inicial, Venta, Compra, Merma, Ajuste, Ajuste manual, Anulación..., Cambio de costo
    cantidad          REAL NOT NULL,   -- positiva entra, negativa sale
    costo_unitario    REAL NOT NULL DEFAULT 0,
    stock_resultante  REAL NOT NULL,
    referencia        TEXT,            -- VEN-0001, COM-0003...
    ref_tipo          TEXT,            -- 'venta' / 'compra'
    ref_id            TEXT,
    nota              TEXT,
    created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_mov_insumo ON movimientos_inventario(insumo_id);
CREATE INDEX idx_mov_ref ON movimientos_inventario(ref_tipo, ref_id);

CREATE TABLE cotizaciones (
    id              TEXT PRIMARY KEY,
    folio           INTEGER NOT NULL,
    cliente_id      TEXT REFERENCES clientes(id) ON DELETE SET NULL,
    cliente_nombre  TEXT NOT NULL DEFAULT '',  -- puede ser un prospecto que aún no es cliente
    fecha           TEXT NOT NULL,
    validez_dias    INTEGER NOT NULL DEFAULT 15,
    notas           TEXT,
    estado          TEXT NOT NULL DEFAULT 'Pendiente',  -- Pendiente / Convertida
    venta_id        TEXT REFERENCES ventas(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cotizaciones_detalle (
    id               TEXT PRIMARY KEY,
    cotizacion_id    TEXT NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
    producto_id      TEXT REFERENCES productos_finales(id) ON DELETE SET NULL,
    producto_nombre  TEXT NOT NULL,
    cantidad         REAL NOT NULL,
    precio_unitario  REAL NOT NULL
);

-- Gastos que no son compra de insumos: alquiler, luz, internet, sueldos...
CREATE TABLE gastos (
    id           TEXT PRIMARY KEY,
    fecha        TEXT NOT NULL,
    categoria    TEXT NOT NULL,
    descripcion  TEXT,
    monto        REAL NOT NULL,
    created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE configuracion (
    clave  TEXT PRIMARY KEY,
    valor  TEXT
);

-- Folios correlativos. Nunca se reutilizan, aunque se borre el último documento.
CREATE TABLE contadores (
    nombre  TEXT PRIMARY KEY,
    valor   INTEGER NOT NULL
);
INSERT INTO contadores (nombre, valor) VALUES ('ventas', 0), ('compras', 0), ('cotizaciones', 0);
"""


# ---------- Migraciones ----------

def _definicion(tabla):
    """Extrae de ESQUEMA el CREATE TABLE de una tabla (para no duplicar definiciones)."""
    inicio = ESQUEMA.index(f'CREATE TABLE {tabla} (')
    fin = ESQUEMA.index(');', inicio) + 2
    return ESQUEMA[inicio:fin]


def migrar_a_2():
    """Versión 1 (primera versión local) -> 2.
    Abonos, kárdex, cotizaciones guardadas, gastos, configuración, fecha de entrega,
    estados Listo/Entregado separados y costo/nombre guardados en cada venta."""
    tablas_nuevas = '\n'.join(_definicion(t) for t in
                               ('pagos', 'movimientos_inventario', 'cotizaciones', 'cotizaciones_detalle', 'gastos', 'configuracion'))
    return """
        -- ventas: se reconstruye para quitar el CHECK de estados y agregar columnas
        CREATE TABLE ventas_nueva (
            id                 TEXT PRIMARY KEY,
            folio              INTEGER NOT NULL,
            cliente_id         TEXT REFERENCES clientes(id) ON DELETE SET NULL,
            fecha              TEXT NOT NULL,
            fecha_entrega      TEXT,
            entregado_en       TEXT,
            notas              TEXT,
            estado_produccion  TEXT NOT NULL DEFAULT 'Por Diseñar',
            created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO ventas_nueva (id, folio, cliente_id, fecha, estado_produccion, entregado_en, created_at)
            SELECT id, folio, cliente_id, fecha,
                   CASE estado_produccion WHEN 'Listo/Entregado' THEN 'Entregado' ELSE estado_produccion END,
                   CASE estado_produccion WHEN 'Listo/Entregado' THEN fecha END,
                   created_at
            FROM ventas;
        DROP TABLE ventas;
        ALTER TABLE ventas_nueva RENAME TO ventas;

        ALTER TABLE ventas_detalle ADD COLUMN producto_nombre TEXT NOT NULL DEFAULT '';
        ALTER TABLE ventas_detalle ADD COLUMN costo_unitario REAL NOT NULL DEFAULT 0;
        UPDATE ventas_detalle SET producto_nombre = COALESCE(
            (SELECT nombre FROM productos_finales p WHERE p.id = ventas_detalle.producto_id), 'Producto');
        UPDATE ventas_detalle SET costo_unitario = COALESCE((
            SELECT SUM(i.costo_unitario * r.cantidad_usada * (1 + r.porcentaje_merma / 100.0))
            FROM recetas_detalle r JOIN insumos i ON i.id = r.insumo_id
            WHERE r.producto_id = ventas_detalle.producto_id), 0);

        ALTER TABLE compras_detalle ADD COLUMN insumo_nombre TEXT NOT NULL DEFAULT '';
        UPDATE compras_detalle SET insumo_nombre = COALESCE(
            (SELECT nombre FROM insumos i WHERE i.id = compras_detalle.insumo_id), 'Insumo');

        ALTER TABLE clientes ADD COLUMN notas TEXT;
    """ + tablas_nuevas + """
        CREATE INDEX idx_mov_insumo ON movimientos_inventario(insumo_id);
        CREATE INDEX idx_mov_ref ON movimientos_inventario(ref_tipo, ref_id);
        INSERT OR IGNORE INTO contadores (nombre, valor) VALUES ('cotizaciones', 0);

        -- Las ventas anteriores no tenían control de abonos: se registran como pagadas.
        INSERT INTO pagos (id, venta_id, fecha, monto, metodo, nota)
            SELECT lower(hex(randomblob(16))), v.id, v.fecha, SUM(d.cantidad * d.precio_unitario), 'Otro',
                   'Registrada antes del control de abonos'
            FROM ventas v JOIN ventas_detalle d ON d.venta_id = v.id
            GROUP BY v.id HAVING SUM(d.cantidad * d.precio_unitario) > 0;

        -- El kárdex arranca con el stock que había al momento de actualizar.
        INSERT INTO movimientos_inventario (id, insumo_id, fecha, tipo, cantidad, costo_unitario, stock_resultante, nota)
            SELECT lower(hex(randomblob(16))), id, date('now', 'localtime'), 'Stock inicial', stock_actual,
                   costo_unitario, stock_actual, 'Saldo al activar el kárdex'
            FROM insumos;
    """


# Cada migración devuelve el SQL que lleva la base de la versión N-1 a la N.
MIGRACIONES = {2: migrar_a_2}


def _ejecutar(con, sql, version):
    """Corre el script completo en una sola transacción (todo o nada)."""
    try:
        con.executescript(f'BEGIN;\n{sql}\nPRAGMA user_version = {version};\nCOMMIT;')
    except Exception:
        if con.in_transaction:
            con.execute('ROLLBACK')
        raise


def preparar_base(ruta: Path):
    """Crea la base si no existe o la lleva a la versión actual."""
    con = sqlite3.connect(ruta, isolation_level=None)
    try:
        version = con.execute('PRAGMA user_version').fetchone()[0]
        tiene_tablas = con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ventas'").fetchone()

        if not tiene_tablas:
            _ejecutar(con, ESQUEMA, VERSION)
            return

        version = max(version, 1)  # la primera versión local no marcaba user_version
        if version >= VERSION:
            return

        _respaldo_previo(con, ruta, version)
        con.execute('PRAGMA foreign_keys = OFF')  # necesario para reconstruir tablas
        for destino in range(version + 1, VERSION + 1):
            _ejecutar(con, MIGRACIONES[destino](), destino)
        problemas = con.execute('PRAGMA foreign_key_check').fetchall()
        if problemas:
            raise RuntimeError(f'La migración dejó referencias rotas: {problemas[:5]}')
    finally:
        con.close()


def _respaldo_previo(con, ruta: Path, version):
    destino = ruta.parent / 'respaldos' / f'antes_de_migrar_v{version}.db'
    destino.parent.mkdir(exist_ok=True)
    if destino.exists():
        return
    copia = sqlite3.connect(destino)
    con.backup(copia)
    copia.close()
