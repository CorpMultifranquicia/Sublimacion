# SubliApp.spec — receta de PyInstaller para generar el ejecutable.
# Uso (en Windows, desde la carpeta del proyecto):  pyinstaller SubliApp.spec
# Resultado: dist/SubliApp/ con SubliApp.exe adentro.
#
# Medidas para que Windows y los antivirus desconfíen menos del .exe:
#   - modo carpeta (no "un solo archivo", que se descomprime en temporales);
#   - sin compresión UPX (los antivirus la asocian con malware);
#   - ícono propio y datos de versión/editor (Propiedades > Detalles);
#   - en GitHub Actions el cargador de PyInstaller se compila desde el código
#     fuente, así no comparte la "huella" del cargador genérico.

import os
import sys

# Versión: la pone GitHub Actions (SUBLIAPP_VERSION=2.<n>); en compilaciones locales, 2.0.
VERSION = os.environ.get('SUBLIAPP_VERSION', '2.0')
numeros = tuple(int(x) for x in (VERSION.split('.') + ['0', '0', '0', '0'])[:4])

info_version = None
if sys.platform.startswith('win'):
    from PyInstaller.utils.win32.versioninfo import (
        FixedFileInfo, StringFileInfo, StringStruct, StringTable, VarFileInfo, VarStruct, VSVersionInfo,
    )
    info_version = VSVersionInfo(
        ffi=FixedFileInfo(filevers=numeros, prodvers=numeros),
        kids=[
            StringFileInfo([StringTable('0C0A04B0', [  # español, Unicode
                StringStruct('CompanyName', 'Zafiro Lab'),
                StringStruct('FileDescription', 'SubliApp - Sistema de gestión de Zafiro Lab'),
                StringStruct('FileVersion', VERSION),
                StringStruct('InternalName', 'SubliApp'),
                StringStruct('LegalCopyright', 'Zafiro Lab'),
                StringStruct('OriginalFilename', 'SubliApp.exe'),
                StringStruct('ProductName', 'SubliApp'),
                StringStruct('ProductVersion', VERSION),
            ])]),
            VarFileInfo([VarStruct('Translation', [0x0C0A, 1200])]),
        ],
    )

a = Analysis(
    ['SubliApp.py'],
    datas=[
        ('index.html', '.'),
        ('css', 'css'),
        ('js', 'js'),
        ('vendor', 'vendor'),
        ('backend/logo_predeterminado.png', 'backend'),
        ('docs/instructivo/index.html', 'docs/instructivo'),
        ('docs/instructivo/img', 'docs/instructivo/img'),
        ('docs/Instructivo_SubliApp.pdf', 'docs'),
    ],
    hiddenimports=['waitress', 'openpyxl'],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='SubliApp',
    icon='assets/subliapp.ico',
    version=info_version,
    upx=False,
    console=True,  # la ventana negra es el interruptor: cerrarla apaga el programa
)
coll = COLLECT(exe, a.binaries, a.datas, upx=False, name='SubliApp')
