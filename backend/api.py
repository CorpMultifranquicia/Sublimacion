"""
api.py — Servidor web local de SubliApp (Flask).

Sirve dos cosas:
  1. La interfaz (index.html, css/, js/, vendor/) y las imágenes adjuntas.
  2. Una API JSON en /api/... que el frontend (js/store.js) usa para leer y guardar.

Solo escucha en 127.0.0.1: nadie fuera de esta PC puede conectarse.
"""

from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

from .base_datos import BaseDatos, ErrorDeDatos

MAX_IMAGEN_BYTES = 8 * 1024 * 1024


def crear_app(carpeta_web: Path, carpeta_datos: Path) -> Flask:
    carpeta_web = Path(carpeta_web).resolve()
    db = BaseDatos(carpeta_datos)

    app = Flask(__name__, static_folder=None)
    app.config['MAX_CONTENT_LENGTH'] = MAX_IMAGEN_BYTES + 1024 * 1024
    app.config['JSON_AS_ASCII'] = False
    app.json.ensure_ascii = False

    def ok(**extra):
        return jsonify({'ok': True, **extra})

    def cuerpo():
        return request.get_json(silent=True) or {}

    @app.errorhandler(ErrorDeDatos)
    def error_de_datos(e):
        return jsonify({'error': str(e)}), 400

    @app.errorhandler(Exception)
    def error_general(e):
        if hasattr(e, 'code') and hasattr(e, 'description'):  # errores HTTP (404, 413...)
            return jsonify({'error': e.description}), e.code
        app.logger.exception(e)
        return jsonify({'error': f'Error interno: {e}'}), 500

    # ---------- Interfaz ----------

    @app.get('/')
    def inicio():
        return send_from_directory(carpeta_web, 'index.html')

    @app.get('/<any(css, js, vendor):carpeta>/<path:archivo>')
    def estaticos(carpeta, archivo):
        return send_from_directory(carpeta_web / carpeta, archivo)

    @app.get('/adjuntos/<path:archivo>')
    def adjuntos(archivo):
        return send_from_directory(db.carpeta_adjuntos, archivo)

    # ---------- API ----------

    @app.get('/api/ping')
    def ping():
        return ok(app='SubliApp')

    @app.get('/api/estado')
    def estado():
        return jsonify(db.estado())

    # Insumos
    @app.post('/api/insumos')
    def crear_insumo():
        return ok(id=db.crear_insumo(cuerpo()))

    @app.put('/api/insumos/<id_>')
    def actualizar_insumo(id_):
        db.actualizar_insumo(id_, cuerpo())
        return ok()

    @app.delete('/api/insumos/<id_>')
    def borrar_insumo(id_):
        db.borrar_insumo(id_)
        return ok()

    # Productos
    @app.post('/api/productos')
    def crear_producto():
        return ok(id=db.crear_producto(cuerpo()))

    @app.put('/api/productos/<id_>')
    def actualizar_producto(id_):
        db.actualizar_producto(id_, cuerpo())
        return ok()

    @app.delete('/api/productos/<id_>')
    def borrar_producto(id_):
        db.borrar_producto(id_)
        return ok()

    # Clientes
    @app.post('/api/clientes')
    def crear_cliente():
        return ok(id=db.crear_cliente(cuerpo()))

    @app.put('/api/clientes/<id_>')
    def actualizar_cliente(id_):
        db.actualizar_cliente(id_, cuerpo())
        return ok()

    @app.delete('/api/clientes/<id_>')
    def borrar_cliente(id_):
        db.borrar_cliente(id_)
        return ok()

    # Ventas
    @app.post('/api/ventas')
    def crear_venta():
        d = cuerpo()
        return ok(id=db.registrar_venta(d.get('cliente_id'), d.get('fecha'), d.get('estado'), d.get('detalle', [])))

    @app.put('/api/ventas/<id_>/estado')
    def actualizar_estado_venta(id_):
        db.actualizar_estado_venta(id_, cuerpo().get('estado'))
        return ok()

    @app.delete('/api/ventas/<id_>')
    def borrar_venta(id_):
        db.borrar_venta(id_)
        return ok()

    # Adjuntos
    @app.post('/api/ventas/<venta_id>/adjuntos/enlace')
    def crear_adjunto_enlace(venta_id):
        d = cuerpo()
        if not d.get('url'):
            raise ErrorDeDatos('Falta el enlace.')
        return ok(id=db.crear_adjunto(venta_id, 'enlace', d['url'], d.get('nombre')))

    @app.post('/api/ventas/<venta_id>/adjuntos/imagen')
    def crear_adjunto_imagen(venta_id):
        archivo = request.files.get('archivo')
        if not archivo or not (archivo.mimetype or '').startswith('image/'):
            raise ErrorDeDatos('Selecciona una imagen.')
        nombre = request.form.get('nombre') or archivo.filename
        return ok(id=db.guardar_imagen_adjunta(venta_id, archivo.read(), nombre))

    @app.delete('/api/adjuntos/<id_>')
    def borrar_adjunto(id_):
        db.borrar_adjunto(id_)
        return ok()

    # Compras
    @app.post('/api/compras')
    def crear_compra():
        d = cuerpo()
        return ok(id=db.registrar_compra(d.get('proveedor'), d.get('fecha'), d.get('items', [])))

    app.db = db
    return app
