// ========================================
// ONBOARDING CAROUSEL - GeoIPT
// ========================================

/**
 * Inicializa el carousel de onboarding
 * Se ejecuta automáticamente al cargar la página
 */
(function() {
  'use strict';

  // ========================================
  // CONFIGURACIÓN
  // ========================================
  const CONFIG = {
    storageKey: 'geoipt_onboarding_completed',
    autoShowOnFirstVisit: true,
    slides: [
      {
        image: 'fotos_intro/01_portada_geoipt.png',
        title: '¡Bienvenido a GeoIPT! 🗺️',
        description: 'Selecciona la <strong>región</strong> y el <strong>instrumento de planificación</strong> (PRC o SCC) que deseas consultar.',
        subdescription: 'Utiliza los menús desplegables en la parte superior del mapa.'
      },
      {
        image: 'fotos_intro/02_reporte_geoipt.png',
        title: 'Consulta cualquier punto 📍',
        description: 'Haz <strong>clic en el mapa</strong> para abrir el motor BBOX y visualizar la zona correspondiente al punto consultado.',
        subdescription: 'El área visible se resaltará automáticamente en el mapa.'
      },
      {
        image: 'fotos_intro/02_reporte_geoipt.png',
        title: 'Revisa la información 📋',
        description: 'Consulta la <strong>metadata completa</strong> de la zona: región, comuna, localidad, zonificación, usos permitidos y prohibidos.',
        subdescription: 'Toda la información aparece en una tabla clara y organizada.'
      },
      {
        image: 'fotos_intro/03_descarga_geoipt.png',
        title: 'Descarga archivos KML 💾',
        description: 'Descarga el archivo <strong>KML de la zona consultada</strong> para utilizarlo en otras aplicaciones GIS.',
        subdescription: '🔒 Requiere iniciar sesión y verificar tu correo electrónico.'
      }
    ]
  };

  // ========================================
  // ESTADO
  // ========================================
  let currentSlide = 0;
  let overlay = null;
  let slidesElements = null;
  let indicators = null;

  // ========================================
  // VERIFICAR SI DEBE MOSTRARSE
  // ========================================
  function shouldShowOnboarding() {
    if (!CONFIG.autoShowOnFirstVisit) return false;
    const hasCompleted = localStorage.getItem(CONFIG.storageKey);
    return hasCompleted !== 'true';
  }

  // ========================================
  // CREAR HTML DEL CAROUSEL
  // ========================================
  function createCarouselHTML() {
    const slidesHTML = CONFIG.slides.map((slide, index) => `
      <div class="slide ${index === 0 ? 'active' : ''}" data-step="${index + 1}">
        <div class="slide-image">
          <img src="${slide.image}" alt="${slide.title}">
        </div>
        <h2 class="slide-title">${slide.title}</h2>
        <p class="slide-description">${slide.description}</p>
        <p class="slide-subdescription">${slide.subdescription}</p>
      </div>
    `).join('');

    const indicatorsHTML = CONFIG.slides.map((_, index) => `
      <div class="indicator ${index === 0 ? 'active' : ''}" data-slide="${index}"></div>
    `).join('');

    return `
      <div class="onboarding-overlay" id="onboardingOverlay">
        <div class="carousel-container">
          
          <!-- Badge de paso actual -->
          <div class="step-badge">
            Paso <span id="currentStep">1</span> de <span id="totalSteps">${CONFIG.slides.length}</span>
          </div>

          <!-- Botón cerrar -->
          <button class="btn-close" id="btnClose" aria-label="Cerrar tutorial">×</button>

          <!-- Slides -->
          <div class="carousel-slides">
            ${slidesHTML}
          </div>

          <!-- Indicadores -->
          <div class="carousel-indicators">
            ${indicatorsHTML}
          </div>

          <!-- Controles -->
          <div class="carousel-controls">
            <button class="btn btn-skip" id="btnSkip">Saltar tutorial</button>
            <button class="btn btn-next" id="btnNext">Siguiente →</button>
            <button class="btn btn-finish" id="btnFinish" style="display: none;">¡Comenzar! 🚀</button>
          </div>

        </div>
      </div>
    `;
  }

  // ========================================
  // MOSTRAR SLIDE
  // ========================================
  function showSlide(index) {
    if (!slidesElements || !indicators) return;

    // Ocultar todas las slides
    slidesElements.forEach(slide => slide.classList.remove('active'));
    indicators.forEach(ind => ind.classList.remove('active'));

    // Mostrar slide actual
    slidesElements[index].classList.add('active');
    indicators[index].classList.add('active');

    // Actualizar badge de paso
    const currentStepSpan = document.getElementById('currentStep');
    if (currentStepSpan) {
      currentStepSpan.textContent = index + 1;
    }

    // Mostrar/ocultar botones según slide
    const btnNext = document.getElementById('btnNext');
    const btnFinish = document.getElementById('btnFinish');
    
    if (index === CONFIG.slides.length - 1) {
      if (btnNext) btnNext.style.display = 'none';
      if (btnFinish) btnFinish.style.display = 'block';
    } else {
      if (btnNext) btnNext.style.display = 'block';
      if (btnFinish) btnFinish.style.display = 'none';
    }
  }

  // ========================================
  // NAVEGACIÓN
  // ========================================
  function nextSlide() {
    if (currentSlide < CONFIG.slides.length - 1) {
      currentSlide++;
      showSlide(currentSlide);
    }
  }

  function previousSlide() {
    if (currentSlide > 0) {
      currentSlide--;
      showSlide(currentSlide);
    }
  }

  function goToSlide(index) {
    currentSlide = index;
    showSlide(currentSlide);
  }

  // ========================================
  // CERRAR ONBOARDING
  // ========================================
  function closeOnboarding() {
    if (!overlay) return;
    
    overlay.classList.add('closing');
    setTimeout(() => {
      if (overlay && overlay.parentNode) {
        overlay.remove();
      }
      // Guardar en localStorage que completó el tutorial
      localStorage.setItem(CONFIG.storageKey, 'true');
    }, 300);
  }

  // ========================================
  // AGREGAR EVENT LISTENERS
  // ========================================
  function attachEventListeners() {
    const btnNext = document.getElementById('btnNext');
    const btnFinish = document.getElementById('btnFinish');
    const btnSkip = document.getElementById('btnSkip');
    const btnClose = document.getElementById('btnClose');

    if (btnNext) btnNext.addEventListener('click', nextSlide);
    if (btnFinish) btnFinish.addEventListener('click', closeOnboarding);
    if (btnSkip) btnSkip.addEventListener('click', closeOnboarding);
    if (btnClose) btnClose.addEventListener('click', closeOnboarding);

    // Click en indicadores
    indicators.forEach((indicator, index) => {
      indicator.addEventListener('click', () => goToSlide(index));
    });

    // Navegación con teclado
    document.addEventListener('keydown', handleKeyboard);
  }

  // ========================================
  // MANEJO DE TECLADO
  // ========================================
  function handleKeyboard(e) {
    if (!overlay) return;

    if (e.key === 'ArrowRight') {
      nextSlide();
    } else if (e.key === 'ArrowLeft') {
      previousSlide();
    } else if (e.key === 'Escape') {
      closeOnboarding();
    }
  }

  // ========================================
  // INICIALIZAR
  // ========================================
  function init() {
    // Verificar si debe mostrarse
    if (!shouldShowOnboarding()) {
      console.log('✓ Onboarding ya completado');
      return;
    }

    // Crear e insertar HTML
    const container = document.createElement('div');
    container.innerHTML = createCarouselHTML();
    document.body.appendChild(container.firstElementChild);

    // Obtener referencias a elementos
    overlay = document.getElementById('onboardingOverlay');
    slidesElements = document.querySelectorAll('.slide');
    indicators = document.querySelectorAll('.indicator');

    // Agregar event listeners
    attachEventListeners();

    // Mostrar primera slide
    showSlide(0);

    console.log('✓ Onboarding carousel inicializado');
  }

  // ========================================
  // API PÚBLICA
  // ========================================
  window.GeoIPTOnboarding = {
    show: function() {
      // Remover flag de completado para forzar mostrar
      localStorage.removeItem(CONFIG.storageKey);
      init();
    },
    
    hide: closeOnboarding,
    
    reset: function() {
      localStorage.removeItem(CONFIG.storageKey);
      console.log('✓ Onboarding reseteado');
    }
  };

  // ========================================
  // AUTO-INICIALIZAR AL CARGAR PÁGINA
  // ========================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();