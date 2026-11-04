/* Modelo fisiológico de Fase G1: metabólico (Pandolf) + cardiovascular (proxy) + O2 PLSS.
 * Ninguna dependencia de DOM. Todas las entradas/salidas en SI (kg, m, s, W, bpm, L).
 * Dimensiones no modeladas se reportan como null + flag `not_modeled`. */

export function slopeToGradePercent(slope_deg) {
    return Math.tan(slope_deg * Math.PI / 180) * 100;
}

export function calculateMetabolicRateW({ body_mass_kg, suit_mass_kg, walk_speed_ms, signed_slope_deg, terrain_factor }) {
    const W = body_mass_kg, L = suit_mass_kg, V = walk_speed_ms;
    const G = slopeToGradePercent(signed_slope_deg);
    const baseline = 1.5 * W + 2.0 * (W + L) * (L / W) ** 2;
    const effort = terrain_factor * (W + L) * (1.5 * V * V + 0.35 * V * G);
    const raw = baseline + effort;
    const clamped = Math.max(raw, 0.5 * baseline);
    return {
        baseline_w: baseline,
        effort_w: effort,
        metabolic_rate_raw_w: raw,
        metabolic_rate_w: clamped,
        grade_percent: G,
    };
}

export function metabolicToVO2Lmin(M_w, rer = 0.82) {
    const rerC = Math.max(0.7, Math.min(1.0, rer));
    const kJPerL = 19.6 + (rerC - 0.7) / 0.3 * 1.5;
    return M_w * 60 / (kJPerL * 1000);
}

export function estimateHeartRateBpm(M_w, cfg) {
    const m_th = cfg.hr_m_threshold_w, m_max = cfg.hr_m_max_w;
    if (M_w <= m_th) {
        const t = Math.max(0, M_w / m_th);
        return cfg.hr_rest_bpm + (cfg.hr_walk_target_bpm - cfg.hr_rest_bpm) * t;
    }
    const t = Math.min(1, (M_w - m_th) / (m_max - m_th));
    return cfg.hr_walk_target_bpm + (cfg.hr_max_bpm - cfg.hr_walk_target_bpm) * t;
}

export function estimateStrokeVolumeMl(M_w, cfg) {
    const m_th = cfg.hr_m_threshold_w, m_max = cfg.hr_m_max_w;
    if (M_w <= m_th) {
        const t = Math.max(0, M_w / m_th);
        return cfg.sv_rest_ml + (cfg.sv_max_ml - cfg.sv_rest_ml) * t;
    }
    const t = Math.min(1, (M_w - m_th) / (m_max - m_th));
    return cfg.sv_rest_ml + (cfg.sv_max_ml - cfg.sv_rest_ml) * (0.5 + 0.5 * t);
}

/**
 * Avanza un miembro a través de un segmento.
 * @param segment { walking_time_h, slope_deg, delta_elev_m, surface_distance_m }
 * @param prevState estado previo del miembro (o estado inicial de initMember)
 * @param member { body_mass_kg, age_years, ... }
 * @param cfg configuración resuelta
 */
export function advanceMemberState(segment, prevState, member, cfg) {
    const t_h = Math.max(0, segment.walking_time_h || 0);
    const slope = Math.max(0, Math.min(90, segment.slope_deg || 0));
    const delta = segment.delta_elev_m || 0;
    const signedSlope = delta >= 0 ? slope : -slope;

    const effectiveSpeed = segment.walk_speed_ms ?? cfg.walk_speed_ms;
    const metab = calculateMetabolicRateW({
        body_mass_kg: member.body_mass_kg,
        suit_mass_kg: cfg.suit_mass_kg,
        walk_speed_ms: effectiveSpeed,
        signed_slope_deg: signedSlope,
        terrain_factor: cfg.terrain_factor,
    });
    const vo2 = metabolicToVO2Lmin(metab.metabolic_rate_w, cfg.rer_assumed);
    const vco2 = vo2 * cfg.rer_assumed;
    const hr = estimateHeartRateBpm(metab.metabolic_rate_w, cfg);
    const sv = estimateStrokeVolumeMl(metab.metabolic_rate_w, cfg);
    const co = hr * sv / 1000;
    const energy_kj = metab.metabolic_rate_w * t_h * 3.6;

    const o2_consumed_l = vo2 * 60 * t_h;
    const o2_remaining_l = Math.max(0, (prevState.o2_remaining_l ?? member.o2_capacity_l_equiv) - o2_consumed_l);

    return {
        member_id: member.id,
        o2_remaining_l,
        o2_consumed_l_total: (prevState.o2_consumed_l_total || 0) + o2_consumed_l,
        energy_kj_total: (prevState.energy_kj_total || 0) + energy_kj,
        metabolic_rate_w: metab.metabolic_rate_w,
        metabolic_fraction_of_max: metab.metabolic_rate_w / cfg.max_sustainable_m_w,
        vo2_l_min: vo2,
        vco2_l_min: vco2,
        heart_rate_bpm: hr,
        hr_fraction_of_max: hr / cfg.hr_max_bpm,
        stroke_volume_ml: sv,
        cardiac_output_l_min: co,
        total_time_h: (prevState.total_time_h || 0) + t_h,
        total_distance_m: (prevState.total_distance_m || 0) + (segment.surface_distance_m || 0),

        /* Dimensiones no modeladas (Fase G2/G3) */
        t_core_c: null,
        hydration_deficit_l: null,
        dose_usv: null,
        time_to_incapacitation_min: null,

        flags: {
            over_sustainable_metabolic: metab.metabolic_rate_w > cfg.max_sustainable_m_w,
            hr_above_85pct_max: hr > 0.85 * cfg.hr_max_bpm,
            o2_low: o2_remaining_l < cfg.o2_critical_threshold_l,
            o2_depleted: o2_remaining_l <= 0,
        },
    };
}

export function initMemberState(member, cfg) {
    return {
        member_id: member.id,
        o2_remaining_l: member.o2_capacity_l_equiv,
        o2_consumed_l_total: 0,
        energy_kj_total: 0,
        metabolic_rate_w: 0,
        metabolic_fraction_of_max: 0,
        vo2_l_min: 0,
        vco2_l_min: 0,
        heart_rate_bpm: cfg.hr_rest_bpm,
        hr_fraction_of_max: cfg.hr_rest_bpm / cfg.hr_max_bpm,
        stroke_volume_ml: cfg.sv_rest_ml,
        cardiac_output_l_min: 0,
        total_time_h: 0,
        total_distance_m: 0,
        t_core_c: null,
        hydration_deficit_l: null,
        dose_usv: null,
        time_to_incapacitation_min: null,
        flags: { over_sustainable_metabolic: false, hr_above_85pct_max: false, o2_low: false, o2_depleted: false },
    };
}