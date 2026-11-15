/**
 * ayuda.js — Muestra el instructivo (docs/instructivo/index.html) dentro de la app.
 */

const URL_INSTRUCTIVO = 'docs/instructivo/index.html';
const URL_PDF = 'docs/Instructivo_SubliApp.pdf';

function montar(el) {
    el.innerHTML = `
        <div class="flex flex-wrap gap-3 justify-end mb-4">
            <a href="${URL_INSTRUCTIVO}" target="_blank" class="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 hover:bg-slate-50"><i class="fa-solid fa-up-right-from-square mr-1"></i>Abrir en otra pestaña</a>
            <a href="${URL_PDF}" download="Instructivo_SubliApp.pdf" class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"><i class="fa-solid fa-file-pdf mr-1"></i>Descargar instructivo (PDF)</a>
        </div>
        <iframe src="${URL_INSTRUCTIVO}" title="Instructivo" class="w-full bg-white rounded-2xl border border-slate-100 shadow-sm" style="height: calc(100vh - 11rem)"></iframe>`;
}

export const vista = {
    id: 'ayuda',
    titulo: 'Ayuda',
    subtitulo: 'Instructivo de uso',
    icono: 'fa-circle-question',
    grupo: 'Sistema',
    montar,
    render() {},
};
