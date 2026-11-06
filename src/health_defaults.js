/* Defaults del contrato 4.5 para MarsWalk. Fuente por variable. */

export const DEFAULT_HEALTH = {
    /* --- Antropometría --- */
    body_mass_kg: 80,
    body_height_m: 1.80,
    age_years: 40,
    sex: 'unspecified',
    fitness_level: 'nominal',
    acclimatization_day: 30,
    suit_mass_kg: 60,
    terrain_factor: 1.1,

    /* --- Locomoción (Pandolf requiere V en m/s) --- */
    walk_speed_ms: 1.2,
    run_speed_ms: 2.5,
    max_safe_slope_deg: 25,       // deg — umbral de seguridad para marcha EVA

    /* --- Suavizado del HUD --- */
    health_smoothing_alpha: 0.12,

    /* --- Metabólico --- */
    rer_assumed: 0.82,
    max_sustainable_m_w: 900,

    /* --- Cardiovascular (proxy lineal) --- */
    hr_rest_bpm: 70,
    hr_walk_target_bpm: 110,
    hr_max_bpm: null, // = 220 - age_years
    hr_m_threshold_w: 300,
    hr_m_max_w: 900,
    sv_rest_ml: 70,
    sv_max_ml: 120,

    /* --- O2 --- */
    o2_capacity_l_equiv: 580,
    o2_critical_threshold_l: 58,

    /* --- G2.1: Corrección gravitatoria (Pandolf Earth-calibrado → Marte) --- */
    gravity_ms2: 3.71,
    gravity_earth_ms2: 9.81,
    gravity_correction_mode: 'empirical', // 'none' | 'linear_vertical' | 'empirical'
    gravity_empirical_factor: 0.80,       // factor empírico neto (incl. gait adaptation)

    /* --- G2.2: Overhead de presión del traje --- */
    suit_pressure_kpa: 30.0,
    suit_pressure_overhead_mode: 'percent_overhead', // 'none' | 'percent_overhead' | 'newman_barratt'
    suit_pressure_overhead_fraction: 0.30,           // 30% overhead (conservador)

    /* --- G2.3: Térmico (Gagge simplificado) --- */
    t_core_initial_c: 37.0,
    t_core_warning_c: 38.5,
    t_core_critical_c: 39.5,
    body_c_p_kj_kg_k: 3.5,
    thermal_mode: 'nominal',       // 'nominal' | 'failure'
    thermal_lcvg_efficiency: 0.85, // nominal

    /* --- G2.4: Hidratación --- */
    potable_water_provision_l_h: 0.240,
    potable_water_capacity_l: 2.0,
    dehydration_warning_pct_body_mass: 2.0,
    dehydration_critical_pct_body_mass: 4.0,

    /* --- G2.5: Pesos de ruta (suman 1.0) --- */
    route_weights: {
        slope: 0.15,
        oxygen: 0.25,
        metabolic: 0.20,
        heart_rate: 0.15,
        thermal: 0.10,
        hydration: 0.10,
        radiation: 0.05,       // placeholder, sin modelo hasta G3
        contingency: 0.00,     // placeholder, sin modelo hasta G3
    },

    /* --- Grupo --- */
    group_size: 3,
    coupling_policy: 'coupled',
    max_separation_m: 50,
    link_distance_max_m: 200,
    formation: 'column',
    leader_rotation_interval_min: 20,
    leader_terrain_factor: 1.2,
    follower_terrain_factor: 1.05,
    leader_extra_hr_bpm: 5,
    rotation_overhead_s: 30,
    rotation_overhead_m_w: 150,
    comm_nominal_range_m: 200,
    comm_degraded_range_m: 500,
    group_cognitive_hr_bump_bpm: 8,
    resource_topology: 'per_suit',
    abort_threshold_min: 5,

    /* --- Explícitamente no modelado --- */
    not_modeled: {
        radiation: 'Fase G3 · requiere surface_dose_rate por sitio y SPE',
        contingency: 'Fase G3 · requiere leak_rate por miembro',
        co2: 'Fase G3 · requiere cartucho LiOH y VCO2 acumulado',
        fatigue: 'Sin fuente canónica · proxy exponencial no defendible',
        cognitive: 'Sin modelo cuantitativo validado',
        gravity_gait_adaptation: 'Factor empírico 0.80 sin validación experimental',
        suit_joint_resistance_per_articulation: 'Modelo Newman-Barratt requiere geometría y cinemática; fuera de alcance MVP',
        mars_atmospheric_pressure: 'Afecta térmico/contingencia/comunicaciones, no metabolismo (traje a 30 kPa)',
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
    return 220 - age_years;
}