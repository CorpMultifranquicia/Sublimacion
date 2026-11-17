/**
 * configuracion.js — Datos del negocio (salen en recibos y cotizaciones), logo,
 * preferencias (moneda, margen objetivo, validez de cotizaciones) y respaldos.
 */

import { Store } from '../store.js';
import { esc, fmtFecha, fmtTasa, diasEntre, hoyISO } from '../util.js';
import { toast, handleError } from '../ui.js';
import { refrescar, tarjeta, etiqueta, claseInput } from './comun.js';
import { vistaPreviaRecibo, vistaPreviaCotizacion } from '../pdf.js';

const LOGO_MAX_PX = 500;
const LOGO_MAX_BYTES = 5 * 1024 * 1024;
let logoPendiente = null; // data URL elegido pero aún no guardado ('' = quitar)

/** Reduce el logo a 500px como máximo, conservando la transparencia (PNG). */
async function prepararLogo(file) {
    if (!file.type.startsWith('image/')) throw new Error('El logo debe ser una imagen (PNG o JPG).');
    if (file.size > LOGO_MAX_BYTES) throw new Error('El logo pesa más de 5MB. Usa una versión más liviana.');
    const bitmap = await createImageBitmap(file);
    const escala = Math.min(1, LOGO_MAX_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
}

/** Lee el formulario; las casillas desmarcadas no viajan en FormData, por eso se agregan aparte. */
function datosFormulario(form) {
    const datos = Object.fromEntries(new FormData(form).entries());
    datos.bs_activo = form.querySelector('[name=bs_activo]').checked ? '1' : '0';
    return datos;
}

function campo(nombre, titulo, valor, extra = '') {
    return `<div>${etiqueta(titulo, 'cfg-' + nombre)}<input id="cfg-${nombre}" name="${nombre}" value="${esc(valor)}" class="${claseInput}" ${extra}></div>`;
}

function render(el) {
    const c = Store.state.config;
    const logo = logoPendiente !== null ? logoPendiente : c.logo;
    const dias = c.ultimo_respaldo ? diasEntre(c.ultimo_respaldo, hoyISO()) : null;
    el.innerHTML = `<form id="form-config" class="grid grid-cols-1 xl:grid-cols-3 gap-6" novalidate>
        <div class="xl:col-span-2 space-y-6">
            ${tarjeta(`<div class="p-6 space-y-4">
                <h3 class="font-bold text-slate-800">Datos del negocio <span class="font-normal text-xs text-slate-400">· aparecen en recibos y cotizaciones</span></h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    ${campo('negocio_nombre', 'Nombre comercial', c.negocio_nombre, 'required')}
                    ${campo('negocio_eslogan', 'Eslogan', c.negocio_eslogan, 'placeholder="Sublimación y personalización"')}
                    ${campo('negocio_rif', 'RIF / Identificación fiscal', c.negocio_rif, 'placeholder="J-12345678-9"')}
                    ${campo('negocio_telefono', 'Teléfono / WhatsApp', c.negocio_telefono)}
                    ${campo('negocio_email', 'Email', c.negocio_email, 'type="email"')}
                    ${campo('negocio_redes', 'Instagram / redes', c.negocio_redes, 'placeholder="@zafirolab"')}
                    ${campo('negocio_direccion', 'Dirección', c.negocio_direccion)}
                </div>
                <div class="flex items-center gap-4 pt-2">
                    <div class="w-36 h-20 rounded-xl border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center overflow-hidden">
                        ${logo ? `<img src="${esc(logo)}" alt="Logo" class="max-w-full max-h-full object-contain">` : '<span class="text-xs text-slate-400">Sin logo</span>'}
                    </div>
                    <div class="space-y-2">
                        <label class="inline-block px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
                            <i class="fa-solid fa-upload mr-1"></i>${logo ? 'Cambiar logo' : 'Subir logo'}<input id="cfg-logo" type="file" accept="image/png,image/jpeg,image/webp" class="hidden">
                        </label>
                        ${logo ? '<button type="button" id="cfg-quitar-logo" class="block text-xs text-rose-500 hover:underline">Quitar logo</button>'
                               : '<button type="button" id="cfg-restaurar-logo" class="block text-xs text-indigo-600 hover:underline">Restaurar logo de Zafiro Lab</button>'}
                        <p class="text-xs text-slate-400">PNG con fondo transparente se ve mejor. Se usa en el menú y en los PDF.</p>
                    </div>
                </div>
            </div>`)}
            ${tarjeta(`<div class="p-6 space-y-4">
                <h3 class="font-bold text-slate-800">Preferencias</h3>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>${etiqueta('Símbolo de moneda', 'cfg-moneda')}<input id="cfg-moneda" name="moneda" list="monedas" value="${esc(c.moneda)}" required class="${claseInput}">
                        <datalist id="monedas"><option value="$"><option value="Bs"><option value="€"><option value="USD"></datalist></div>
                    ${campo('margen_objetivo', 'Margen objetivo (%)', c.margen_objetivo, 'type="number" min="0" max="95" step="1" required')}
                    ${campo('cotizacion_validez_dias', 'Validez de cotizaciones (días)', c.cotizacion_validez_dias, 'type="number" min="1" step="1" required')}
                </div>
                <p class="text-xs text-slate-400 -mt-2">El margen objetivo se usa para calcular el "precio sugerido" de cada producto: costo ÷ (1 − margen).</p>
                <div>${etiqueta('Condiciones de las cotizaciones', 'cfg-cond')}<textarea id="cfg-cond" name="cotizacion_condiciones" rows="3" class="${claseInput}">${esc(c.cotizacion_condiciones)}</textarea></div>
                <div>${etiqueta('Mensaje al pie del recibo', 'cfg-pie')}<input id="cfg-pie" name="recibo_pie" value="${esc(c.recibo_pie)}" class="${claseInput}"></div>
            </div>`)}
            ${tarjeta(`<div class="p-6 space-y-4">
                <div class="flex items-center justify-between gap-3">
                    <h3 class="font-bold text-slate-800"><i class="fa-solid fa-coins text-amber-500 mr-2"></i>Bolívares y tasa del día</h3>
                    <label class="flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" name="bs_activo" value="1" ${c.bs_activo === '1' ? 'checked' : ''} class="w-4 h-4 accent-indigo-600"> Activado</label>
                </div>
                <p class="text-sm text-slate-600">Los precios se guardan en <b>${esc(c.moneda || '$')}</b>. Con la tasa del día, SubliApp muestra los equivalentes en bolívares, permite registrar pagos en bolívares y genera presupuestos y recibos en bolívares o en ambas monedas.</p>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                    ${campo('moneda_local', 'Símbolo moneda local', c.moneda_local, 'required')}
                    <div>${etiqueta('Moneda de los PDF (por defecto)', 'cfg-docmon')}<select id="cfg-docmon" name="documentos_moneda" class="${claseInput}">
                        ${[['ambas', 'Ambas monedas'], ['base', `Solo ${esc(c.moneda || '$')}`], ['local', `Solo ${esc(c.moneda_local || 'Bs')}`]].map(([v, t]) => `<option value="${v}" ${c.documentos_moneda === v ? 'selected' : ''}>${t}</option>`).join('')}
                    </select></div>
                    <div><p class="text-xs font-bold text-slate-500 uppercase mb-1">Tasa del día</p>
                        <button type="button" onclick="App.openTasaModal()" class="w-full px-3 py-2 rounded-lg border ${Store.tasaEsDeHoy() ? 'border-slate-200' : 'border-amber-300 bg-amber-50'} text-sm text-left hover:bg-slate-50">
                            ${Store.tasaDia() ? `<b>${esc(c.moneda_local || 'Bs')} ${fmtTasa(Store.tasaDia())}</b> <span class="text-xs text-slate-400">(${fmtFecha(c.tasa_fecha)})</span>` : '<span class="text-amber-700">Cargar tasa</span>'}
                            <i class="fa-solid fa-pen float-right mt-1 text-slate-400"></i></button></div>
                </div>
                <p class="text-xs text-slate-400">Al descargar un PDF siempre puedes elegir la moneda y la tasa; aquí defines la opción que viene marcada.</p>
            </div>`)}
            <div class="flex flex-wrap gap-3 justify-end">
                <button type="button" id="cfg-prev-recibo" class="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 hover:bg-slate-50"><i class="fa-solid fa-eye mr-1"></i>Vista previa del recibo</button>
                <button type="button" id="cfg-prev-cot" class="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 hover:bg-slate-50"><i class="fa-solid fa-eye mr-1"></i>Vista previa de cotización</button>
                <button type="submit" class="px-6 py-2 rounded-lg bg-indigo-600 text-white text-sm font-bold shadow-md shadow-indigo-200 hover:bg-indigo-700">Guardar configuración</button>
            </div>
        </div>
        <div class="space-y-6">
            ${tarjeta(`<div class="p-6 space-y-3">
                <h3 class="font-bold text-slate-800"><i class="fa-solid fa-shield-halved text-indigo-500 mr-2"></i>Respaldo de datos</h3>
                <p class="text-sm text-slate-600">SubliApp guarda una copia automática cada día en la carpeta <b>respaldos</b> de esta PC. Si la PC se daña, esas copias se pierden: descarga un respaldo y guárdalo en un pendrive o en Drive al menos una vez por semana.</p>
                <p class="text-sm ${dias === null || dias >= 7 ? 'text-amber-700' : 'text-emerald-700'}"><i class="fa-solid fa-clock-rotate-left mr-1"></i>Último respaldo descargado: <b>${c.ultimo_respaldo ? `${fmtFecha(c.ultimo_respaldo)} (hace ${dias} día${dias !== 1 ? 's' : ''})` : 'nunca'}</b></p>
                <a href="/api/respaldo" id="cfg-respaldo" class="block text-center px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"><i class="fa-solid fa-download mr-1"></i>Descargar respaldo</a>
                <button type="button" id="cfg-carpeta" class="w-full px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50"><i class="fa-regular fa-folder-open mr-1"></i>Abrir carpeta de datos</button>
                <p class="text-xs text-slate-400">Para restaurar un respaldo, sigue las instrucciones de LEEME.txt.</p>
            </div>`)}
            ${tarjeta(`<div class="p-6 space-y-2 text-sm text-slate-600">
                <h3 class="font-bold text-slate-800">Sobre los documentos</h3>
                <p>Los recibos y cotizaciones de SubliApp son <b>documentos no fiscales</b>. Si tu cliente necesita factura fiscal, debe emitirse con una imprenta o máquina fiscal autorizada.</p>
            </div>`)}
        </div>
    </form>`;

    const form = el.querySelector('#form-config');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!form.checkValidity()) { toast('Revisa los campos obligatorios.', 'aviso'); form.querySelector(':invalid')?.focus(); return; }
        const datos = datosFormulario(form);
        if (logoPendiente !== null) datos.logo = logoPendiente;
        try {
            await Store.guardarConfig(datos);
            logoPendiente = null;
            refrescar();
            toast('Configuración guardada.');
        } catch (err) { handleError(err); }
    });
    el.querySelector('#cfg-logo').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            logoPendiente = await prepararLogo(file);
            // Se guarda también lo escrito en el formulario para no perderlo al redibujar.
            await Store.guardarConfig({ ...datosFormulario(form), logo: logoPendiente });
            logoPendiente = null;
            refrescar();
            toast('Logo actualizado.');
        } catch (err) { handleError(err); }
    });
    el.querySelector('#cfg-restaurar-logo')?.addEventListener('click', async () => {
        try { await Store.guardarConfig({ ...datosFormulario(form), logo: null }); refrescar(); toast('Logo de Zafiro Lab restaurado.'); } catch (err) { handleError(err); }
    });
    el.querySelector('#cfg-quitar-logo')?.addEventListener('click', async () => {
        try { await Store.guardarConfig({ ...datosFormulario(form), logo: '' }); refrescar(); toast('Logo quitado.'); } catch (err) { handleError(err); }
    });
    // Las vistas previas usan lo que está escrito en el formulario aunque no se haya guardado.
    const configFormulario = () => ({ ...Store.state.config, ...datosFormulario(form) });
    el.querySelector('#cfg-prev-recibo').addEventListener('click', () => vistaPreviaRecibo(configFormulario()).catch(handleError));
    el.querySelector('#cfg-prev-cot').addEventListener('click', () => vistaPreviaCotizacion(configFormulario()).catch(handleError));
    el.querySelector('#cfg-respaldo').addEventListener('click', () => setTimeout(() => Store.load().then(refrescar), 1500));
    el.querySelector('#cfg-carpeta').addEventListener('click', () => Store.abrirCarpetaDatos()
        .then(r => toast(`Carpeta: ${r.carpeta}`, 'info')).catch(handleError));
}

export const vista = {
    id: 'configuracion',
    titulo: 'Configuración',
    subtitulo: 'Datos del negocio, documentos y respaldos',
    icono: 'fa-gear',
    grupo: 'Sistema',
    render,
};
