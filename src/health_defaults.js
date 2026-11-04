/* Defaults del contrato 4.5 para MarsWalk. Todas las variables con fuente y nota de incertidumbre.
 * Fase G1: metabólico + cardiovascular + O2. Resto marcado `not_modeled` para Fase G2/G3. */

export const DEFAULT_HEALTH = {
    /* --- Antropometría y traje (NASA-STD-3001 design reference) --- */
    body_mass_kg: 80,             // kg — masa corporal de diseño NASA-STD-3001
    body_height_m: 1.80,          // m
    age_years: 40,                // años
    sex: 'unspecified',           // 'female' | 'male' | 'unspecified'
    fitness_level: 'nominal',     // 'nominal' | 'fit' | 'deconditioned'
    acclimatization_day: 30,      // días — aclimatación completa
    suit_mass_kg: 60,             // kg — xEMU-class (input L de Pandolf)
    terrain_factor: 1.1,          // η Pandolf; 1.1 ~ asfalto. Regolito real ≥1.2 (calibrar)
    walk_speed_ms: 1.2,           // velocidad de caminata típica
    run_speed_ms: 2.5,

    /* --- Suavizado del HUD (EMA sobre inputs de movimiento) --- */
    health_smoothing_alpha: 0.12, // 0 < α ≤ 1; α pequeño = más suave (α=0.12 ≈ 20 frames para converger)
    /* --- Metabólico (Pandolf 1977) --- */
    rer_assumed: 0.82,            // RER caminando típico
    max_sustainable_m_w: 900,     // W — sostenible ~1 h adulto sano (referencia diseño)

    /* --- Cardiovascular (proxy lineal por tramos; no modelo fisiológico) --- */
    hr_rest_bpm: 70,
    hr_walk_target_bpm: 110,
    hr_max_bpm: null,             // null = derivar 220 − age_years (Fox 1971)
    hr_m_threshold_w: 300,        // W — umbral aeróbico ~50% VO2max
    hr_m_max_w: 900,              // W — VO2max nominal (45 mL/kg/min)
    sv_rest_ml: 70,               // mL — volumen sistólico en reposo
    sv_max_ml: 120,               // mL — VS máximo ejercicio

    /* --- O2 / PLSS --- */
    o2_capacity_l_equiv: 580,     // L — capacidad útil PLSS (heredado config_fisio)
    o2_critical_threshold_l: 58,  // L — 10% de reserva

    /* --- Grupo: estructura (contrato 4.5) --- */
    group_size: 3,                // miembros por defecto en modo "group"
    coupling_policy: 'coupled',   // 'coupled' | 'independent' (emergencia no simulada en G1)
    max_separation_m: 50,         // m — separación máxima antes de romper acoplamiento
    link_distance_max_m: 200,     // m — rango de radio operativo
    formation: 'column',          // 'column' | 'line' | 'wedge'
    leader_rotation_interval_min: 20, // 0 = sin rotación
    leader_terrain_factor: 1.2,   // η para quien rompe sendero
    follower_terrain_factor: 1.05, // η para quien pisa huella
    leader_extra_hr_bpm: 5,       // sobrecarga cognitiva del líder
    rotation_overhead_s: 30,      // s por rotación
    rotation_overhead_m_w: 150,   // W de coste de reacomodo (informativo en G1)
    comm_nominal_range_m: 200,    // m
    comm_degraded_range_m: 500,   // m
    group_cognitive_hr_bump_bpm: 8, // sobrecarga de coordinación grupal
    resource_topology: 'per_suit',// 'per_suit' | 'shared_cache' | 'hybrid'

    /* --- Contingencia (básica, Fase G3 completa) --- */
    abort_threshold_min: 5,       // min — umbral de decisión aborto

    /* --- Dimensiones explícitamente no modeladas en G1 --- */
    not_modeled: {
        thermal: { reason: 'Fase G2 · requiere ODE T_core con LCVG nominal vs fallo' },
        hydration: { reason: 'Fase G2 · requiere sudoración de modelo térmico' },
        radiation: { reason: 'Fase G3 · requiere surface_dose_rate por sitio y SPE' },
        contingency: { reason: 'Fase G3 · requiere leak_rate por miembro' },
        co2: { reason: 'Fase G3 · requiere cartucho LiOH y VCO2 acumulado' },
        fatigue: { reason: 'Sin fuente canónica · proxy exponencial no defendible' },
        cognitive: { reason: 'Sin modelo cuantitativo validado' },
    },
};

export const DEFAULT_MEMBER = {
    id: 'astronaut',
    role: 'leader',
    body_mass_kg: 80,
    age_years: 40,
    sex: 'unspecified',
    fitness_level: 'nominal',
    cumulative_career_dose_mgy: 0,
    o2_capacity_l_equiv: 580,
};

export function deriveHRMax(age_years) {
    return 220 - age_years; // Fox 1971 — proxy aceptado en ausencia de prueba de esfuerzo
}