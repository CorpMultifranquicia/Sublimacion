# SubliApp.spec — receta de PyInstaller para generar el ejecutable.
# Uso (en Windows, desde la carpeta del proyecto):  pyinstaller SubliApp.spec
# Resultado: dist/SubliApp/ con SubliApp.exe adentro (modo carpeta: arranca
# rápido y los antivirus lo marcan mucho menos que el modo "un solo archivo").

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
    console=True,  # la ventana negra es el interruptor: cerrarla apaga el programa
)
coll = COLLECT(exe, a.binaries, a.datas, name='SubliApp')
