"""
api.py — Servidor web local de SubliApp (Flask).

Sirve dos cosas:
  1. La interfaz (index.html, css/, js/, vendor/) y las imágenes adjuntas.
  2. Una API JSON en /api/... que el frontend (js/store.js) usa para leer y guardar.

Solo escucha en 127.0.0.1: nadie fuera de esta PC puede conectarse.
"""

import os
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

from flask import Flask, jsonify, request, send_file, send_from_directory

from .base_datos import BaseDatos, ErrorDeDatos
from .exportar import libro_excel

MAX_IMAGEN_BYTES = 8 * 1024 * 1024


def crear_app(carpeta_web: Path, carpeta_datos: Path) -> Flask:
    carpeta_web = Path(carpeta_web).resolve()
    db = BaseDatos(carpeta_datos)

    app = Flask(__name__, static_folder=None)
    app.config['MAX_CONTENT_LENGTH'] = MAX_IMAGEN_BYTES + 1024 * 1024
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

    @app.after_request
    def sin_cache(resp):
        # La interfaz se actualiza con cada versión nueva: que el navegador no use copias viejas.
        resp.headers['Cache-Control'] = 'no-store'
        return resp

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

    # ---------- Lectura ----------

    @app.get('/api/ping')
    def ping():
        return ok(app='SubliApp')

    @app.get('/api/estado')
    def estado():
        return jsonify(db.estado())

    # ---------- CRUD simple: (ruta, crear, actualizar, borrar) ----------

    def registrar_crud(ruta, crear, actualizar, borrar):
        app.add_url_rule(f'/api/{ruta}', f'crear_{ruta}', lambda: ok(id=crear(cuerpo())), methods=['POST'])

        def _actualizar(id_):
            actualizar(id_, cuerpo())
            return ok()

        def _borrar(id_):
            borrar(id_)
            return ok()
        app.add_url_rule(f'/api/{ruta}/<id_>', f'actualizar_{ruta}', _actualizar, methods=['PUT'])
        app.add_url_rule(f'/api/{ruta}/<id_>', f'borrar_{ruta}', _borrar, methods=['DELETE'])

    registrar_crud('insumos', db.crear_insumo, db.actualizar_insumo, db.borrar_insumo)
    registrar_crud('productos', db.crear_producto, db.actualizar_producto, db.borrar_producto)
    registrar_crud('clientes', db.crear_cliente, db.actualizar_cliente, db.borrar_cliente)
    registrar_crud('ventas', db.registrar_venta, db.actualizar_venta, db.borrar_venta)
    registrar_crud('compras', db.registrar_compra, db.actualizar_compra, db.borrar_compra)
    registrar_crud('cotizaciones', db.crear_cotizacion, db.actualizar_cotizacion, db.borrar_cotizacion)
    registrar_crud('gastos', db.crear_gasto, db.actualizar_gasto, db.borrar_gasto)

    # ---------- Inventario ----------

    @app.get('/api/insumos/<id_>/movimientos')
    def movimientos(id_):
        return jsonify(db.movimientos(id_))

    @app.post('/api/insumos/<id_>/ajuste')
    def ajuste(id_):
        db.ajustar_stock(id_, cuerpo())
        return ok()

    # ---------- Ventas: estado, pagos y adjuntos ----------

    @app.put('/api/ventas/<id_>/estado')
    def actualizar_estado_venta(id_):
        db.actualizar_estado_venta(id_, cuerpo().get('estado'))
        return ok()

    @app.post('/api/ventas/<venta_id>/pagos')
    def crear_pago(venta_id):
        return ok(id=db.registrar_pago(venta_id, cuerpo()))

    @app.delete('/api/pagos/<id_>')
    def borrar_pago(id_):
        db.borrar_pago(id_)
        return ok()

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

    # ---------- Configuración, respaldo y exportación ----------

    @app.put('/api/config')
    def guardar_config():
        db.guardar_config(cuerpo())
        return ok()

    @app.get('/api/respaldo')
    def descargar_respaldo():
        """Descarga una copia completa de la base de datos."""
        temporal = Path(tempfile.mkdtemp()) / 'subliapp.db'
        db.copiar_base(temporal)
        db.guardar_config({'ultimo_respaldo': date.today().isoformat()})
        return send_file(temporal, as_attachment=True,
                         download_name=f'SubliApp_respaldo_{date.today().isoformat()}.db')

    @app.post('/api/abrir-carpeta')
    def abrir_carpeta():
        """Abre la carpeta de datos en el explorador de archivos (solo en la PC local)."""
        carpeta = str(db.carpeta)
        try:
            if sys.platform.startswith('win'):
                os.startfile(carpeta)  # noqa: S606 — carpeta propia, no viene del usuario
            elif sys.platform == 'darwin':
                subprocess.Popen(['open', carpeta])
            else:
                subprocess.Popen(['xdg-open', carpeta])
        except OSError:
            raise ErrorDeDatos(f'No se pudo abrir el explorador. La carpeta es: {carpeta}')
        return ok(carpeta=carpeta)

    @app.get('/api/exportar')
    def exportar():
        desde = request.args.get('desde') or '0000-01-01'
        hasta = request.args.get('hasta') or '9999-12-31'
        archivo = libro_excel(db.estado(), desde, hasta, db.movimientos_todos())
        nombre = f'SubliApp_{desde}_a_{hasta}.xlsx' if request.args.get('desde') else 'SubliApp_todo.xlsx'
        return send_file(archivo, as_attachment=True, download_name=nombre,
                         mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

    app.db = db
    return app
