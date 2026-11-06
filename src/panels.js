/* Paneles plegables de la vista orbital.
   - Barra superior de cada panel (.panel-top-bar) para ocultar/mostrar el panel entero sin confundirse con las secciones.
   - Cada sección (.layers-header + su contenido) se pliega/despliega al pulsar su encabezado.
   - "Dataset & Incertidumbre", "Planificador de Ruta" y "Capas Multi-Misión" inician abiertas por defecto.
   - El dock del astronauta y el planificador de ruta quedan siempre a la vista en la columna izquierda. */

const STORE_KEY = 'marswalk.ui.panels.v2';

/* Secciones abiertas por defecto */
const DEFAULT_OPEN = new Set([
  'Planificador de Ruta',
  'Dataset & Incertidumbre',
  'Capas Multi-Misión (Layered View)',
]);

function loadStore() {
  try {
    localStorage.removeItem('marswalk.ui.panels.v1');
    return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  } catch (_) {
    return {};
  }
}

function saveStore(s) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch (_) {
    /* modo privado */
  }
}

function headerKey(h) {
  const clone = h.cloneNode(true);
  clone.querySelectorAll('button, .panel-hide-btn, .copilot-hdr-btns').forEach((n) => n.remove());
  return clone.textContent.replace(/\s+/g, ' ').trim();
}

/* Agrupa cada .layers-header y los hermanos siguientes hasta el próximo header en un .panel-section */
function makeSectionsCollapsible(panel, store) {
  const kids = Array.from(panel.children);
  let section = null;
  let body = null;

  kids.forEach((el) => {
    if (el.classList && el.classList.contains('panel-top-bar')) return;

    if (el.classList && el.classList.contains('layers-header')) {
      const key = headerKey(el);
      section = document.createElement('section');
      section.className = 'panel-section';
      body = document.createElement('div');
      body.className = 'panel-section-body';

      panel.insertBefore(section, el);
      section.appendChild(el);
      section.appendChild(body);

      el.classList.add('collapsible');
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');

      const stored = store.sections?.[key];
      const open = stored === undefined ? DEFAULT_OPEN.has(key) : Boolean(stored);
      section.classList.toggle('collapsed', !open);
      el.setAttribute('aria-expanded', String(open));

      const toggle = (e) => {
        if (e.target.closest('button, a, input, select') && e.target !== el) return;
        const nowCollapsed = section.classList.toggle('collapsed');
        el.setAttribute('aria-expanded', String(!nowCollapsed));
        const st = loadStore();
        st.sections = st.sections || {};
        st.sections[key] = !nowCollapsed;
        saveStore(st);
      };

      el.addEventListener('click', toggle);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle(e);
        }
      });
    } else if (body) {
      body.appendChild(el);
    }
  });
}

/* Barra superior para ocultar el panel completo + pestaña flotante para recuperarlo */
function makePanelHideable(panel, { side, label, tabHost }, store) {
  const topBar = document.createElement('div');
  topBar.className = 'panel-top-bar';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'panel-top-title';
  titleSpan.textContent = side === 'left' ? '🧭 Navegación EVA' : '🛰️ Control & Datos';

  const hideBtn = document.createElement('button');
  hideBtn.type = 'button';
  hideBtn.className = 'panel-hide-btn';
  hideBtn.title = `Minimizar panel (${side === 'left' ? '[' : ']'})`;
  hideBtn.setAttribute('aria-label', hideBtn.title);
  hideBtn.textContent = side === 'left' ? '◂ Minimizar' : 'Minimizar ▸';

  topBar.appendChild(titleSpan);
  topBar.appendChild(hideBtn);
  panel.insertBefore(topBar, panel.firstChild);

  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = `panel-tab panel-tab-${side}`;
  tab.title = `Mostrar panel de ${label}`;
  tab.textContent = side === 'left' ? `▸ ${label}` : `${label} ◂`;
  (tabHost || document.body).insertBefore(tab, (tabHost || document.body).firstChild);

  const apply = (hidden) => {
    panel.classList.toggle('panel-hidden', hidden);
    tab.classList.toggle('visible', hidden);
    const st = loadStore();
    st.hidden = st.hidden || {};
    st.hidden[side] = hidden;
    saveStore(st);
  };

  hideBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    apply(true);
  });
  tab.addEventListener('click', () => apply(false));
  apply(Boolean(store.hidden?.[side]));
}

export function initPanels() {
  const store = loadStore();
  const route = document.getElementById('route-panel');
  const layers = document.getElementById('layers-panel');

  if (route) {
    makePanelHideable(route, { side: 'left', label: 'Planificador de Ruta', tabHost: route.parentElement }, store);
    makeSectionsCollapsible(route, store);
  }
  if (layers) {
    makePanelHideable(layers, { side: 'right', label: 'Dataset, Capas y Clima' }, store);
    makeSectionsCollapsible(layers, store);
  }

  /* Atajos: [ oculta/muestra el panel izquierdo, ] el derecho (ignorados al escribir en un campo) */
  window.addEventListener('keydown', (e) => {
    if (document.body.classList.contains('fp')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === '[') {
      document.querySelector(route?.classList.contains('panel-hidden') ? '.panel-tab-left' : '#route-panel .panel-hide-btn')?.click();
    }
    if (e.key === ']') {
      document.querySelector(layers?.classList.contains('panel-hidden') ? '.panel-tab-right' : '#layers-panel .panel-hide-btn')?.click();
    }
  });
}
