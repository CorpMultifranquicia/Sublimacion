/**
 * util.js — Formatos y utilidades compartidas por todas las vistas.
 *
 * FECHAS: en la base se guardan como texto 'AAAA-MM-DD' (fecha local, sin hora).
 * Nunca usar `new Date('2026-11-01')`: JavaScript lo interpreta en UTC y en
 * Venezuela (UTC-4) termina siendo el 31 de octubre. Usar siempre estas funciones.
 */

// ---------- Texto seguro en HTML ----------

/** Escapa texto del usuario antes de meterlo en HTML (evita que comillas o < rompan la página). */
export function esc(valor) {
    return String(valor ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Minúsculas y sin acentos, para búsquedas ("Pérez" encuentra "perez"). */
export function normalizar(texto) {
    return String(texto ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ---------- Números y dinero ----------

const nf2 = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfCosto = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const nfCant = new Intl.NumberFormat('es-VE', { maximumFractionDigits: 2 });

let simboloMoneda = '$';
let simboloLocal = 'Bs';

/** Lo llama store.js al cargar la configuración del negocio. */
export function configurarMoneda(simbolo, local) {
    simboloMoneda = simbolo || '$';
    if (local) simboloLocal = local;
}

function conMoneda(texto) {
    const simbolo = simboloMoneda;
    return simbolo.length === 1 ? `${simbolo}${texto}` : `${simbolo} ${texto}`;
}

/** Dinero con 2 decimales: $12.500,00 */
export function fmt(n) {
    const v = Number(n) || 0;
    return (v < 0 ? '-' : '') + conMoneda(nf2.format(Math.abs(v)));
}

/** Bolívares (moneda local): Bs 3.650,00 */
export function fmtBs(n) {
    const v = Number(n) || 0;
    return `${v < 0 ? '-' : ''}${simboloLocal} ${nf2.format(Math.abs(v))}`;
}

/** Tasa de cambio: 36,50 (hasta 4 decimales) */
export function fmtTasa(n) {
    return nfCosto.format(Number(n) || 0);
}

/** Costos unitarios con hasta 4 decimales: $0,004 (para tinta por ml, papel por hoja...). */
export function fmtCosto(n) {
    return conMoneda(nfCosto.format(Number(n) || 0));
}

/** Cantidades: 1.250,5 */
export function fmtNum(n) {
    return nfCant.format(Number(n) || 0);
}

export function fmtPct(n) {
    return `${(Number(n) || 0).toFixed(0)}%`;
}

// ---------- Fechas (siempre locales) ----------

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function isoDe(fecha) {
    const y = fecha.getFullYear();
    const m = String(fecha.getMonth() + 1).padStart(2, '0');
    const d = String(fecha.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** Fecha de hoy en hora local: '2026-11-15'. */
export function hoyISO() {
    return isoDe(new Date());
}

/** '2026-11-01' -> Date local (medianoche del 1 de noviembre, no del 31 de octubre). */
export function parseISO(iso) {
    if (!iso) return null;
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
}

export function sumarDias(iso, dias) {
    const f = parseISO(iso);
    f.setDate(f.getDate() + dias);
    return isoDe(f);
}

/** Días desde `desde` hasta `hasta` (positivo si hasta es posterior). */
export function diasEntre(desde, hasta) {
    return Math.round((parseISO(hasta) - parseISO(desde)) / 86400000);
}

/** 15/11/2026 */
export function fmtFecha(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
}

/** 15 nov */
export function fmtFechaCorta(iso) {
    if (!iso) return '—';
    const f = parseISO(iso);
    return `${f.getDate()} ${MESES_CORTOS[f.getMonth()]}`;
}

/** 20 de noviembre (para cumpleaños: sin año) */
export function fmtDiaMes(iso) {
    if (!iso) return '—';
    const f = parseISO(iso);
    return `${f.getDate()} de ${MESES[f.getMonth()]}`;
}

export function nombreMes(y, m) {
    return `${MESES[m]} ${y}`;
}

export function mesCorto(m) {
    return MESES_CORTOS[m];
}

/** Primer y último día del mes que contiene `iso` (o del mes desplazado `offset` meses). */
export function rangoMes(iso = hoyISO(), offset = 0) {
    const f = parseISO(iso);
    const inicio = new Date(f.getFullYear(), f.getMonth() + offset, 1);
    const fin = new Date(f.getFullYear(), f.getMonth() + offset + 1, 0);
    return { desde: isoDe(inicio), hasta: isoDe(fin) };
}

export function enRango(iso, desde, hasta) {
    return !!iso && iso >= desde && iso <= hasta;
}

// ---------- Folios y WhatsApp ----------

export const folio = (prefijo, n) => `${prefijo}-${String(n).padStart(4, '0')}`;
export const folioVenta = (v) => folio('VEN', v.folio);
export const folioCompra = (c) => folio('COM', c.folio);
export const folioCotizacion = (c) => folio('COT', c.folio);

export function waLink(telefono, mensaje) {
    let numero = String(telefono || '').replace(/\D/g, '');
    // Números venezolanos escritos en formato local (0414...) -> 58414...
    if (numero.length === 11 && numero.startsWith('0')) numero = '58' + numero.slice(1);
    return `https://wa.me/${numero}${mensaje ? `?text=${encodeURIComponent(mensaje)}` : ''}`;
}

export function abrirWhatsApp(telefono, mensaje) {
    window.open(waLink(telefono, mensaje), '_blank');
}

/** Iniciales para avatares: "Subli Arte" -> "SA" */
export function iniciales(texto) {
    return String(texto || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
}
