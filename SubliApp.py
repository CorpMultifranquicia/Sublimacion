"""
SubliApp.py — Punto de entrada. Doble clic en SubliApp.exe (o `python SubliApp.py`).

1. Si SubliApp ya está abierto, solo abre el navegador y sale.
2. Si no, hace un respaldo diario de la base de datos, levanta el servidor local
   y abre el navegador en http://127.0.0.1:8765.
Cerrar la ventana negra apaga el programa.

Opciones:
  python SubliApp.py --borrar-datos   Deja la base vacía (pide confirmación).
  python SubliApp.py --sin-navegador  No abre el navegador automáticamente.
"""

import argparse
import json
import os
import sys
import threading
import urllib.request
import webbrowser
from pathlib import Path

PUERTO = 8765
URL = f'http://127.0.0.1:{PUERTO}'


def carpeta_programa() -> Path:
    """Dónde están index.html, css/, js/ y vendor/ (dentro del .exe o en el repo)."""
    if getattr(sys, 'frozen', False):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent


def carpeta_datos() -> Path:
    """Dónde se guarda la base de datos, las imágenes y los respaldos.
    Junto al .exe (carpeta SubliApp_datos) para que sea fácil de encontrar y copiar.
    Se puede cambiar con la variable de entorno SUBLIAPP_DATOS."""
    if os.environ.get('SUBLIAPP_DATOS'):
        return Path(os.environ['SUBLIAPP_DATOS'])
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).resolve().parent / 'SubliApp_datos'
    return Path(__file__).resolve().parent / 'datos'


def ya_esta_corriendo() -> bool:
    try:
        with urllib.request.urlopen(f'{URL}/api/ping', timeout=1) as r:
            return json.load(r).get('app') == 'SubliApp'
    except Exception:
        return False


def main():
    parser = argparse.ArgumentParser(description='SubliApp — sistema de gestión para sublimación')
    parser.add_argument('--borrar-datos', action='store_true', help='borra todos los datos (pide confirmación)')
    parser.add_argument('--sin-navegador', action='store_true', help='no abrir el navegador al iniciar')
    args = parser.parse_args()

    from backend.api import crear_app

    if args.borrar_datos:
        respuesta = input('Esto BORRA todos los insumos, productos, clientes, ventas y compras. '
                          'Escribe BORRAR para confirmar: ')
        if respuesta.strip() == 'BORRAR':
            app = crear_app(carpeta_programa(), carpeta_datos())
            copia = app.db.respaldar_antes_de_borrar()
            app.db.borrar_todos_los_datos()
            print(f'Listo. Copia de lo que había antes de borrar: {copia}')
        else:
            print('Cancelado. No se borró nada.')
        return

    if ya_esta_corriendo():
        print('SubliApp ya estaba abierto. Abriendo el navegador...')
        webbrowser.open(URL)
        return

    app = crear_app(carpeta_programa(), carpeta_datos())
    app.db.respaldar()

    print('=' * 60)
    print('  SubliApp está funcionando')
    print(f'  Abre en el navegador: {URL}')
    print(f'  Datos guardados en:   {app.db.carpeta}')
    print('  Para cerrar el programa, cierra esta ventana.')
    print('=' * 60)

    if not args.sin_navegador:
        threading.Timer(1.0, webbrowser.open, args=(URL,)).start()

    from waitress import serve
    serve(app, host='127.0.0.1', port=PUERTO, threads=4, _quiet=True)


if __name__ == '__main__':
    main()
